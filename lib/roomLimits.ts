// Free of any runtime dependency (no db/redis imports) so client components
// can show the same cap the server enforces, without pulling in server-only
// code. Full-mesh WebRTC (every participant connects to every other one
// directly) stops scaling past a handful of people — see the useWebRTC
// notes. This is also the free-tier room size until there's an SFU behind a
// paid tier.
export const MAX_ROOM_PARTICIPANTS = 4;
