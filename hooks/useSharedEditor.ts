"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type {
  CursorPosition,
  EditorDoc,
  EditorEvent,
  RoomEvent,
  RoomSnapshot,
  SignalEvent,
} from "@/lib/editorDoc";

// One document, shared by everyone in the room.
//
// The editor is not driven by a React `value` prop — it can't be, if remote
// edits are to land without throwing away the reader's scroll position,
// selection and undo history every time someone types. Instead this hook owns
// the Monaco model directly: local keystrokes are captured as ranges and sent
// up, remote ranges are patched in, and React state carries only the things
// that genuinely belong in the UI (language, connection status, whose cursor
// is where).
//
// Incoming edits arrive over a server-sent event stream, so they show up in
// about the time of one round trip rather than waiting out a poll interval.

type MonacoEditor = Parameters<OnMount>[0];

// Coalesce a burst of typing into one request, without being long enough to
// feel like lag on the far side.
const EDIT_FLUSH_MS = 60;
// Cursor movement is cosmetic — it can afford to be lazier than the text.
const CURSOR_FLUSH_MS = 200;
const RESYNC_DEBOUNCE_MS = 150;
// Only used while the event stream is down; the stream is the normal path.
const FALLBACK_POLL_MS = 1500;

export interface RemoteCursor extends CursorPosition {
  userId: string;
}

interface UseSharedEditorOptions {
  roomId: string;
  myUserId: string | null;
  // Whether this client is allowed to write right now (i.e. holds the turn).
  canEdit: boolean;
  // Whoever currently holds the turn. Only their cursor is broadcast, so a
  // change here means the old cursor is stale and should go.
  writerId: string | null;
  // Room-level events (turn/participants/presence/media) ride the same
  // connection as the editor's own events — one EventSource, one Redis
  // subscriber per client — so they're handed off here rather than opening a
  // second stream just to receive them.
  onRoomEvent?: (room: RoomSnapshot) => void;
  // Same deal for WebRTC handshake messages — useWebRTC has no connection of
  // its own to receive them on.
  onSignal?: (event: SignalEvent) => void;
}

export function useSharedEditor({
  roomId,
  myUserId,
  canEdit,
  writerId,
  onRoomEvent,
  onSignal,
}: UseSharedEditorOptions) {
  const [language, setLanguage] = useState("javascript");
  const [connected, setConnected] = useState(false);
  const [receivedCursor, setReceivedCursor] = useState<RemoteCursor | null>(null);
  // Only the turn holder broadcasts a cursor, so one belonging to anybody else
  // is left over from a turn that has since changed hands. Derived rather than
  // cleared in an effect, so it can never be shown for even one frame.
  const remoteCursor =
    receivedCursor && receivedCursor.userId === writerId ? receivedCursor : null;
  // Bumped when the editor mounts, purely so effects that need the editor
  // instance re-run once it exists.
  const [attachedAt, setAttachedAt] = useState(0);

  const editorRef = useRef<MonacoEditor | null>(null);
  const disposablesRef = useRef<{ dispose: () => void }[]>([]);
  const decorationsRef = useRef<ReturnType<MonacoEditor["createDecorationsCollection"]> | null>(
    null
  );

  // The version of the document our buffer currently represents. Everything
  // downstream — whether an incoming delta is the next one, whether our write
  // is still valid — is decided against this.
  const versionRef = useRef(0);
  const textRef = useRef("");
  // Set while we're writing a remote change into the model, so our own change
  // listener doesn't mistake it for something the user typed and echo it back.
  const suppressRef = useRef(false);

  const pendingRef = useRef<{ offset: number; length: number; text: string }[]>([]);
  const cursorDirtyRef = useRef(false);
  const inflightRef = useRef(false);
  const flushAgainRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While a resync is in flight our buffer is known-wrong, so incoming deltas
  // would only compound the drift.
  const resyncPendingRef = useRef(false);

  const canEditRef = useRef(canEdit);
  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  // Ref'd so a caller passing a fresh closure each render doesn't force
  // handleEvent (and the effect that re-subscribes it) to recreate too.
  const onRoomEventRef = useRef(onRoomEvent);
  useEffect(() => {
    onRoomEventRef.current = onRoomEvent;
  }, [onRoomEvent]);

  const onSignalRef = useRef(onSignal);
  useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal]);

  // Distinguishes this page load from any other, including a second tab of
  // the same account — that's what lets us ignore the echo of our own edits
  // without ignoring genuine edits from elsewhere.
  const originRef = useRef<string | null>(null);
  const getOrigin = useCallback(() => {
    if (originRef.current === null) {
      // randomUUID needs a secure context, which a plain-http LAN address
      // isn't — same fallback as the WebRTC signaling ids.
      originRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return originRef.current;
  }, []);

  // --- Applying the document ---

  // A wholesale replacement: first load, a new problem, a language switch, or
  // recovering from drift.
  const applyDoc = useCallback((doc: EditorDoc) => {
    if (doc.version < versionRef.current) return; // older than what we hold

    versionRef.current = doc.version;
    textRef.current = doc.code;
    resyncPendingRef.current = false;
    // Anything unsent was written against a document that no longer exists.
    pendingRef.current = [];
    setLanguage(doc.language);

    const model = editorRef.current?.getModel();
    if (!model || model.getValue() === doc.code) return;

    suppressRef.current = true;
    try {
      // A full-range edit rather than setValue: setValue discards the undo
      // stack and resets the viewport, which is jarring when the cause was a
      // background resync rather than anything the user did.
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: doc.code }],
        () => null
      );
    } finally {
      suppressRef.current = false;
    }
  }, []);

  const scheduleResync = useCallback(() => {
    if (resyncTimerRef.current) return;
    resyncPendingRef.current = true;
    resyncTimerRef.current = setTimeout(async () => {
      resyncTimerRef.current = null;
      if (!roomId) return;
      try {
        const res = await fetch(`/api/rooms/${roomId}/editor`);
        if (res.ok) applyDoc((await res.json()) as EditorDoc);
      } catch {
        // Try again on the next trigger — the stream or the fallback poll.
      }
    }, RESYNC_DEBOUNCE_MS);
  }, [roomId, applyDoc]);

  // An incremental edit. Each change's offsets are relative to the document
  // as it stands after the changes before it, so they're applied in order.
  const applyDelta = useCallback(
    (event: Extract<EditorEvent, { type: "delta" }>) => {
      const model = editorRef.current?.getModel();
      if (!model) {
        // No buffer to patch yet; pick the document up whole instead.
        scheduleResync();
        return;
      }

      suppressRef.current = true;
      try {
        for (const change of event.changes) {
          const start = model.getPositionAt(change.offset);
          const end = model.getPositionAt(change.offset + change.length);
          model.applyEdits([
            {
              range: {
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column,
              },
              text: change.text,
            },
          ]);
        }
      } finally {
        suppressRef.current = false;
      }

      versionRef.current = event.version;
      textRef.current = model.getValue();

      // If replaying the edits didn't reproduce the writer's document, stop
      // trusting this buffer and fetch the real one.
      if (textRef.current.length !== event.length) scheduleResync();
    },
    [scheduleResync]
  );

  const handleEvent = useCallback(
    (event: EditorEvent | RoomEvent | SignalEvent) => {
      if (event.type === "room") {
        onRoomEventRef.current?.(event.room);
        return;
      }

      if (event.type === "signal") {
        onSignalRef.current?.(event);
        return;
      }

      if (event.type === "doc") {
        applyDoc(event);
        return;
      }

      // Our own edit, relayed back to us. We already have it.
      if (event.origin === getOrigin()) return;

      if (event.type === "cursor") {
        setReceivedCursor(
          event.cursor && event.from !== myUserId
            ? { userId: event.from, ...event.cursor }
            : null
        );
        return;
      }

      if (event.cursor && event.from !== myUserId) {
        setReceivedCursor({ userId: event.from, ...event.cursor });
      }

      if (resyncPendingRef.current) return; // buffer is known-wrong
      if (event.version <= versionRef.current) return; // already applied
      if (event.version !== versionRef.current + 1) {
        // We missed something in between — patching would corrupt the buffer.
        scheduleResync();
        return;
      }

      applyDelta(event);
    },
    [applyDoc, applyDelta, scheduleResync, getOrigin, myUserId]
  );

  // --- Sending our own changes ---

  // Held in a ref so the flush timer always calls the current closure without
  // the timer itself having to be a dependency of anything.
  const flushRef = useRef<() => void>(() => {});

  const scheduleFlush = useCallback((delayMs: number) => {
    // An already-scheduled flush wins; text edits schedule sooner than
    // cursor movement, and shouldn't be pushed back by it.
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushRef.current();
    }, delayMs);
  }, []);

  const flush = useCallback(async () => {
    if (inflightRef.current) {
      // Keep exactly one request in flight: edits are a sequence, and two
      // requests racing could reach the server out of order.
      flushAgainRef.current = true;
      return;
    }

    const model = editorRef.current?.getModel();
    if (!model || !roomId) return;

    const changes = pendingRef.current;
    const cursorOnly = changes.length === 0;
    if (cursorOnly && !cursorDirtyRef.current) return;

    if (!canEditRef.current) {
      pendingRef.current = [];
      cursorDirtyRef.current = false;
      return;
    }

    pendingRef.current = [];
    cursorDirtyRef.current = false;

    const position = editorRef.current?.getPosition() ?? null;
    const cursor = position
      ? { lineNumber: position.lineNumber, column: position.column }
      : null;
    const text = model.getValue();

    const body = cursorOnly
      ? { type: "cursor", origin: getOrigin(), cursor }
      : {
          type: "edit",
          origin: getOrigin(),
          baseVersion: versionRef.current,
          text,
          changes,
          cursor,
        };

    inflightRef.current = true;
    try {
      const res = await fetch(`/api/rooms/${roomId}/editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.ok && typeof data.version === "number") {
          versionRef.current = data.version;
          if (!cursorOnly) textRef.current = text;
        } else if (data.stale && data.doc) {
          // Someone else's write landed first — theirs is the document now.
          applyDoc(data.doc as EditorDoc);
        }
      } else if (!cursorOnly) {
        // Rejected outright (the turn moved on mid-edit). Take the server's
        // version of events.
        scheduleResync();
      }
    } catch {
      // Network blip. Put the edits back at the front so the next attempt
      // replays the same sequence — the far side patches by range, so a hole
      // in that sequence is what would corrupt it.
      if (!cursorOnly) pendingRef.current = [...changes, ...pendingRef.current];
    } finally {
      inflightRef.current = false;
      if (flushAgainRef.current || pendingRef.current.length > 0 || cursorDirtyRef.current) {
        flushAgainRef.current = false;
        scheduleFlush(EDIT_FLUSH_MS);
      }
    }
  }, [roomId, applyDoc, scheduleResync, scheduleFlush, getOrigin]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // --- Wiring the editor ---

  const attach = useCallback(
    (editor: MonacoEditor) => {
      editorRef.current = editor;

      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [
        editor.onDidChangeModelContent((e) => {
          if (suppressRef.current) return;
          if (!canEditRef.current) return;
          for (const change of e.changes) {
            pendingRef.current.push({
              offset: change.rangeOffset,
              length: change.rangeLength,
              text: change.text,
            });
          }
          scheduleFlush(EDIT_FLUSH_MS);
        }),
        editor.onDidChangeCursorPosition(() => {
          if (!canEditRef.current) return;
          cursorDirtyRef.current = true;
          scheduleFlush(CURSOR_FLUSH_MS);
        }),
      ];

      // The stream may well have delivered the document before the editor
      // finished mounting.
      const model = editor.getModel();
      if (model && model.getValue() !== textRef.current) {
        suppressRef.current = true;
        model.setValue(textRef.current);
        suppressRef.current = false;
      }

      setAttachedAt(Date.now());
    },
    [scheduleFlush]
  );

  useEffect(() => {
    const disposables = disposablesRef.current;
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, []);

  // --- The event stream ---

  const handlerRef = useRef<(event: EditorEvent | RoomEvent | SignalEvent) => void>(handleEvent);
  useEffect(() => {
    handlerRef.current = handleEvent;
  }, [handleEvent]);

  useEffect(() => {
    if (!roomId) return;

    // EventSource reconnects on its own after a drop, and the server opens
    // every connection with a full snapshot — so a reconnect is also a
    // resync, and there's nothing extra to do here.
    const source = new EventSource(`/api/rooms/${roomId}/stream`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      try {
        handlerRef.current(JSON.parse(e.data) as EditorEvent | RoomEvent | SignalEvent);
      } catch {
        // Malformed frame — skip it; the next snapshot puts us right.
      }
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [roomId]);

  // Degraded mode: if the stream can't be established at all, fall back to
  // pulling the document. Slower and lossier, but not broken.
  useEffect(() => {
    if (!roomId || connected) return;
    const interval = setInterval(scheduleResync, FALLBACK_POLL_MS);
    return () => clearInterval(interval);
  }, [roomId, connected, scheduleResync]);

  // --- Remote cursor ---

  useEffect(() => {
    const editor = editorRef.current;
    if (!attachedAt || !editor) return;

    const collection =
      decorationsRef.current ?? (decorationsRef.current = editor.createDecorationsCollection());

    if (!remoteCursor) {
      collection.clear();
      return;
    }

    const { lineNumber, column } = remoteCursor;
    collection.set([
      {
        range: {
          startLineNumber: lineNumber,
          startColumn: column,
          endLineNumber: lineNumber,
          endColumn: column,
        },
        options: { className: "collab-caret" },
      },
      {
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1,
        },
        options: { isWholeLine: true, className: "collab-caret-line" },
      },
    ]);
  }, [attachedAt, remoteCursor]);

  // --- Whole-document writes from the UI ---

  // Switching language also swaps in that language's starter code, so it
  // replaces the document rather than editing it.
  const setDocument = useCallback(
    async (code: string, nextLanguage: string) => {
      if (!roomId || !canEditRef.current) return;

      // Apply locally first so the switch is instant, then confirm.
      pendingRef.current = [];
      setLanguage(nextLanguage);
      const model = editorRef.current?.getModel();
      if (model && model.getValue() !== code) {
        suppressRef.current = true;
        try {
          model.pushEditOperations(
            [],
            [{ range: model.getFullModelRange(), text: code }],
            () => null
          );
        } finally {
          suppressRef.current = false;
        }
      }
      textRef.current = code;

      try {
        const res = await fetch(`/api/rooms/${roomId}/editor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "language",
            origin: getOrigin(),
            baseVersion: versionRef.current,
            text: code,
            language: nextLanguage,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ok && typeof data.version === "number") versionRef.current = data.version;
          else if (data.stale && data.doc) applyDoc(data.doc as EditorDoc);
        } else {
          scheduleResync();
        }
      } catch {
        scheduleResync();
      }
    },
    [roomId, applyDoc, scheduleResync, getOrigin]
  );

  const getCode = useCallback(
    () => editorRef.current?.getModel()?.getValue() ?? textRef.current,
    []
  );

  return {
    language,
    connected,
    remoteCursor,
    attach,
    setDocument,
    getCode,
  };
}
