import { describe, expect, it } from "vitest";
import {
  isValidUsername,
  normalizeUsername,
  validateUsername,
} from "@/lib/username";

describe("normalizeUsername", () => {
  it("lowercases and trims, so a handle is claimed in one canonical form", () => {
    expect(normalizeUsername("  Alice  ")).toBe("alice");
  });

  // The whole point of normalizing: the unique index would otherwise let
  // these be two accounts that are indistinguishable everywhere a name is
  // read rather than compared.
  it("collapses case variants onto the same handle", () => {
    expect(normalizeUsername("ALICE")).toBe(normalizeUsername("alice"));
  });
});

describe("validateUsername", () => {
  it("accepts letters, digits and underscores", () => {
    expect(validateUsername("karman_70")).toBeNull();
    expect(isValidUsername("abc")).toBe(true);
  });

  it("accepts uppercase input, because it is normalized before checking", () => {
    expect(validateUsername("Karman")).toBeNull();
  });

  it("rejects a handle that is too short or too long", () => {
    expect(validateUsername("ab")).toMatch(/at least 3/i);
    expect(validateUsername("a".repeat(21))).toMatch(/at most 20/i);
  });

  it("rejects characters that let two handles look alike", () => {
    expect(validateUsername("has space")).toMatch(/letters, numbers/i);
    expect(validateUsername("dots.allowed")).toMatch(/letters, numbers/i);
    expect(validateUsername("emoji🎉here")).toMatch(/letters, numbers/i);
  });

  it("rejects an empty handle", () => {
    expect(validateUsername("   ")).toMatch(/pick a username/i);
  });

  // Each reserved word is already a path segment on this origin, so a handle
  // matching one reads as a promise the URL doesn't keep.
  it("rejects handles that collide with the app's own routes", () => {
    expect(validateUsername("settings")).toMatch(/reserved/i);
    expect(validateUsername("Dashboard")).toMatch(/reserved/i);
    expect(validateUsername("api")).toMatch(/reserved/i);
  });
});
