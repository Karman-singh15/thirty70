// Free of any runtime dependency (no db/redis imports) so client components
// can show the same cap the server enforces, without pulling in server-only
// code. Full-mesh WebRTC (every participant connects to every other one
// directly) stops scaling past a handful of people — see the useWebRTC
// notes.
export const MAX_ROOM_PARTICIPANTS = 4;

// Pro rooms still ride the same full-mesh WebRTC, so this is a modest bump,
// not a real scale-up — that needs an SFU behind it. Revisit once one exists.
export const MAX_ROOM_PARTICIPANTS_PRO = 8;

export type UserPlan = "free" | "pro";

export function getMaxParticipants(plan: UserPlan): number {
  return plan === "pro" ? MAX_ROOM_PARTICIPANTS_PRO : MAX_ROOM_PARTICIPANTS;
}
