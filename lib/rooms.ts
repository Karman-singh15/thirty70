import { nanoid } from "nanoid";

export interface Participant {
  userId: string;
  name: string;
  imageUrl: string;
  joinedAt: number;
}

export interface RoomProblem {
  titleSlug: string;
  title: string;
  difficulty: string;
  frontendQuestionId: string;
}

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  inviteCode: string;
  participants: Participant[];
  problem: RoomProblem | null;
  code: string;
  language: string;
  createdAt: number;
  updatedAt: number;
}

const rooms = new Map<string, Room>();

export function createRoom(
  name: string,
  ownerId: string,
  ownerName: string,
  ownerImageUrl: string
): Room {
  const id = nanoid(10);
  const inviteCode = nanoid(12);

  const room: Room = {
    id,
    name,
    ownerId,
    ownerName,
    inviteCode,
    participants: [
      {
        userId: ownerId,
        name: ownerName,
        imageUrl: ownerImageUrl,
        joinedAt: Date.now(),
      },
    ],
    problem: null,
    code: "",
    language: "javascript",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  rooms.set(id, room);
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function getRoomByInviteCode(code: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.inviteCode === code) return room;
  }
  return undefined;
}

export function getRoomsForUser(userId: string): Room[] {
  return Array.from(rooms.values()).filter((r) =>
    r.participants.some((p) => p.userId === userId)
  );
}

export function joinRoom(
  roomId: string,
  userId: string,
  name: string,
  imageUrl: string
): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const existing = room.participants.find((p) => p.userId === userId);
  if (!existing) {
    room.participants.push({ userId, name, imageUrl, joinedAt: Date.now() });
    room.updatedAt = Date.now();
  }

  return room;
}

export function setRoomProblem(roomId: string, problem: RoomProblem): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.problem = problem;
  room.code = "";
  room.updatedAt = Date.now();
  return room;
}

export function updateRoomCode(
  roomId: string,
  code: string,
  language: string,
  userId: string
): Room | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (!room.participants.some((p) => p.userId === userId)) return null;

  room.code = code;
  room.language = language;
  room.updatedAt = Date.now();
  return room;
}

export function leaveRoom(roomId: string, userId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.participants = room.participants.filter((p) => p.userId !== userId);

  if (room.participants.length === 0) {
    rooms.delete(roomId);
  }
}
