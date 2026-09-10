// Username rules, with no runtime dependency — the same module validates on
// the server and drives the inline error in the pick-a-username dialog, so
// the two can't drift into disagreeing about what's allowed. Same reason
// lib/roomLimits.ts and lib/turnRotation.ts are kept separate from the code
// that reaches for Redis.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

// Lowercase letters, digits and underscore. Deliberately narrow: a handle is
// something people read out loud and type from memory, and every character
// class beyond this one buys a way for two accounts to look identical —
// mixed case, a Cyrillic "а", a trailing space.
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

// Reserved because each is already a path segment on this origin, so a handle
// matching one would read as a promise the URL doesn't keep.
const RESERVED = new Set([
  "admin",
  "api",
  "competitive",
  "dashboard",
  "join",
  "privacy",
  "room",
  "settings",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "support",
  "terms",
  "thirty70",
]);

/**
 * The stored form of what someone typed. Lowercasing here rather than
 * rejecting uppercase is what makes "Alice" and "alice" the same handle:
 * without it the unique index treats them as two, and the two accounts are
 * indistinguishable everywhere a name is read rather than compared.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * `null` when the normalized handle is usable, otherwise the sentence to show
 * under the input. Says which rule was broken rather than restating all of
 * them, so the message changes as you type instead of sitting there as a
 * wall of requirements.
 */
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);

  if (username.length === 0) return "Pick a username.";
  if (username.length < USERNAME_MIN_LENGTH) {
    return `At least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `At most ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Letters, numbers and underscores only.";
  }
  if (RESERVED.has(username)) return "That username is reserved.";

  return null;
}

/** True when `validateUsername` has nothing to complain about. */
export function isValidUsername(raw: string): boolean {
  return validateUsername(raw) === null;
}
