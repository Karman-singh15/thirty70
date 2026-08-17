import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { isRoomMemberCached } from "@/lib/rooms";
import {
  casSetCode,
  getLiveState,
  publishEditorEvent,
  type CursorPosition,
  type DocChange,
} from "@/lib/roomState";

// Writes to the shared editor document. Readers don't use this — they receive
// everything over /stream. This is only the writing end.

// Generous enough for any interview problem, small enough that nobody can use
// the room as free object storage.
const MAX_DOC_CHARS = 200_000;
const MAX_CHANGES = 500;

function parseChanges(input: unknown): DocChange[] | null {
  if (!Array.isArray(input) || input.length > MAX_CHANGES) return null;

  const changes: DocChange[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { offset, length, text } = raw as Record<string, unknown>;
    if (
      !Number.isInteger(offset) ||
      (offset as number) < 0 ||
      !Number.isInteger(length) ||
      (length as number) < 0 ||
      typeof text !== "string"
    ) {
      return null;
    }
    changes.push({ offset: offset as number, length: length as number, text });
  }
  return changes;
}

function parseCursor(input: unknown): CursorPosition | null {
  if (!input || typeof input !== "object") return null;
  const { lineNumber, column } = input as Record<string, unknown>;
  if (!Number.isInteger(lineNumber) || !Number.isInteger(column)) return null;
  return { lineNumber: lineNumber as number, column: column as number };
}

// The current document, for a client that has drifted or whose event stream
// never came up.
//
// This is a recovery path, so it wants to be fast: the membership check comes
// from the cached room meta rather than Postgres, and is issued together with
// the document read rather than before it. Measured against this project's own
// Neon instance, the Postgres version of this check costs ~263ms warm, spikes
// past 1.2s, and takes ~3s on a cold connection — which is where the 4.6s
// responses in the dev log were coming from. From the cache it's ~28ms, and
// overlapping the two reads takes one of those out of the critical path.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [isMember, live] = await Promise.all([
    isRoomMemberCached(id, userId),
    getLiveState(id),
  ]);
  if (!isMember) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  return NextResponse.json({
    code: live.code,
    language: live.language,
    version: live.docVersion,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const origin = typeof body.origin === "string" ? body.origin : "";

  // One read serves both the permission check and the current language. This
  // runs on nearly every keystroke, so each avoided round trip is ~30ms off
  // how long it takes an edit to show up on everyone else's screen.
  const live = await getLiveState(id);

  // Same gate as everywhere else: whoever holds the turn. Before any turn has
  // started there's nobody to compare against, so it falls back to a
  // membership check — and since that's on the write path it runs on every
  // keystroke for as long as the room has no turn, which is emphatically not
  // somewhere to be spending a ~263ms Postgres round trip. Cached, like the
  // same check on every other hot path.
  const allowed = live.currentTurnUserId
    ? live.currentTurnUserId === userId
    : await isRoomMemberCached(id, userId);
  if (!allowed) {
    return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  }

  // Cursor-only movement. Ephemeral: broadcast, never stored, so it can't
  // desync anything if it's dropped.
  if (body.type === "cursor") {
    await publishEditorEvent(id, {
      type: "cursor",
      from: userId,
      origin,
      cursor: parseCursor(body.cursor),
    });
    return NextResponse.json({ ok: true });
  }

  const isLanguageChange = body.type === "language";
  if (body.type !== "edit" && !isLanguageChange) {
    return NextResponse.json({ error: "Unknown update type" }, { status: 400 });
  }

  if (typeof body.text !== "string" || body.text.length > MAX_DOC_CHARS) {
    return NextResponse.json({ error: "Invalid document text" }, { status: 400 });
  }
  if (!Number.isInteger(body.baseVersion) || body.baseVersion < 0) {
    return NextResponse.json({ error: "Invalid baseVersion" }, { status: 400 });
  }

  const language = isLanguageChange
    ? typeof body.language === "string" && body.language
      ? body.language
      : live.language
    : live.language;

  const changes = isLanguageChange ? [] : parseChanges(body.changes);
  if (changes === null) {
    return NextResponse.json({ error: "Invalid changes" }, { status: 400 });
  }

  const result = await casSetCode(id, body.baseVersion, body.text, language);

  // Someone else's write landed first (a turn changed hands mid-keystroke, or
  // a second tab). Hand back the truth; the client resets onto it rather than
  // both sides drifting.
  if (!result.ok) {
    return NextResponse.json({ ok: false, stale: true, doc: result.doc });
  }

  // Typing is proof of life, so the writer's presence is refreshed in the
  // same pipeline as the broadcast rather than costing its own round trip.
  if (isLanguageChange) {
    // The language swap also swaps in that language's starter code, so this
    // is a whole-document replacement rather than an incremental edit.
    await publishEditorEvent(
      id,
      { type: "doc", version: result.version, code: body.text, language },
      userId
    );
  } else {
    await publishEditorEvent(
      id,
      {
        type: "delta",
        version: result.version,
        from: userId,
        origin,
        changes,
        length: body.text.length,
        cursor: parseCursor(body.cursor),
      },
      userId
    );
  }

  return NextResponse.json({ ok: true, version: result.version, language });
}
