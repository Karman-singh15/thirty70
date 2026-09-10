import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getRoomMeta, isRoomMember } from "@/lib/rooms";
import { areFriends, getProfile } from "@/lib/social";
import { isUserOnline, publishUserEvent, putRoomInvite } from "@/lib/userState";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

// Invites a friend into the room you're already in — the other half of the
// invite dropdown, next to copying the link.
//
// The invite carries the room's invite code, so accepting it is the same
// POST /api/rooms/join that pasting a link performs. That keeps one path into
// a room: capacity, leaving whatever room you were in, and presence are all
// enforced in exactly one place regardless of how you were asked.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`room-invite:${userId}`, 20, 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const { id: roomId } = await params;
  const body = await req.json().catch(() => ({}));
  const toUserId = typeof body.userId === "string" ? body.userId : "";

  if (!toUserId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // You can only invite people into a room you're actually in — otherwise a
  // leaked room id would be enough to push a card onto someone's dashboard.
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member of this room" }, { status: 403 });
  }

  // And only friends. This is the whole point of the friends system: an
  // invite is a notification that lands on someone's dashboard uninvited, so
  // it takes a relationship they agreed to.
  if (!(await areFriends(userId, toUserId))) {
    return NextResponse.json(
      { error: "You can only invite friends" },
      { status: 403 }
    );
  }

  const [room, sender] = await Promise.all([
    getRoomMeta(roomId),
    getProfile(userId),
  ]);

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (!sender) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (room.participants.some((p) => p.userId === toUserId)) {
    return NextResponse.json(
      { error: "They're already in this room" },
      { status: 409 }
    );
  }

  const invite = await putRoomInvite(toUserId, {
    roomId: room.id,
    roomName: room.name,
    inviteCode: room.inviteCode,
    from: {
      userId: sender.userId,
      username: sender.username,
      name: sender.name,
      imageUrl: sender.imageUrl,
    },
    problemTitle: room.problem?.title ?? null,
  });

  await publishUserEvent(toUserId, { type: "invite", invite });

  // Reported back so the button can say "Invited" for someone who's here to
  // see it and "Invite sent" for someone who isn't — the same action, but
  // only one of them is going to be answered in the next minute.
  const online = await isUserOnline(toUserId);

  return NextResponse.json({ invite, delivered: online });
}
