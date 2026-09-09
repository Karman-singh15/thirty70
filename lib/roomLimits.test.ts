import { describe, expect, it } from "vitest";
import {
  MAX_ROOM_PARTICIPANTS,
  MAX_ROOM_PARTICIPANTS_PRO,
  getMaxParticipants,
} from "@/lib/roomLimits";

describe("getMaxParticipants", () => {
  it("gives free rooms the free cap", () => {
    expect(getMaxParticipants("free")).toBe(MAX_ROOM_PARTICIPANTS);
  });

  it("gives pro rooms the pro cap", () => {
    expect(getMaxParticipants("pro")).toBe(MAX_ROOM_PARTICIPANTS_PRO);
  });

  it("keeps the pro cap above the free one", () => {
    expect(MAX_ROOM_PARTICIPANTS_PRO).toBeGreaterThan(MAX_ROOM_PARTICIPANTS);
  });
});
