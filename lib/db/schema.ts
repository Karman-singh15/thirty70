import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Users mirror Clerk identities so rooms/sessions/turns can have real FKs.
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const problems = pgTable("problems", {
  titleSlug: text("title_slug").primaryKey(),
  title: text("title").notNull(),
  difficulty: text("difficulty").notNull(),
  frontendQuestionId: text("frontend_question_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roomStatusEnum = pgEnum("room_status", ["waiting", "active", "finished"]);

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  inviteCode: text("invite_code").notNull().unique(),
  problemSlug: text("problem_slug").references(() => problems.titleSlug),
  status: roomStatusEnum("status").notNull().default("waiting"),
  turnDurationSeconds: integer("turn_duration_seconds").notNull().default(120),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roomParticipants = pgTable(
  "room_participants",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })]
);

// One row per problem attempt in a room — what actually gets "played".
export const sessionStatusEnum = pgEnum("session_status", [
  "in_progress",
  "completed",
  "abandoned",
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  problemSlug: text("problem_slug")
    .notNull()
    .references(() => problems.titleSlug),
  status: sessionStatusEnum("status").notNull().default("in_progress"),
  finalCode: text("final_code"),
  finalLanguage: text("final_language"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// One row per player's turn within a session — the audit trail for turn-based play.
export const turnResultEnum = pgEnum("turn_result", [
  "passed_turn",
  "failed",
  "solved",
  "timed_out",
]);

export const turns = pgTable("turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  playerId: text("player_id")
    .notNull()
    .references(() => users.id),
  turnNumber: integer("turn_number").notNull(),
  codeSnapshot: text("code_snapshot"),
  result: turnResultEnum("result"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const usersRelations = relations(users, ({ many }) => ({
  ownedRooms: many(rooms),
  roomParticipants: many(roomParticipants),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  owner: one(users, { fields: [rooms.ownerId], references: [users.id] }),
  problem: one(problems, { fields: [rooms.problemSlug], references: [problems.titleSlug] }),
  participants: many(roomParticipants),
  sessions: many(sessions),
}));

export const roomParticipantsRelations = relations(roomParticipants, ({ one }) => ({
  room: one(rooms, { fields: [roomParticipants.roomId], references: [rooms.id] }),
  user: one(users, { fields: [roomParticipants.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  room: one(rooms, { fields: [sessions.roomId], references: [rooms.id] }),
  problem: one(problems, { fields: [sessions.problemSlug], references: [problems.titleSlug] }),
  turns: many(turns),
}));

export const turnsRelations = relations(turns, ({ one }) => ({
  session: one(sessions, { fields: [turns.sessionId], references: [sessions.id] }),
  player: one(users, { fields: [turns.playerId], references: [users.id] }),
}));
