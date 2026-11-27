/**
 * The one username rule. The deployed contract only checks length (3-24 bytes), so on-chain anyone
 * can register look-alikes such as "Ada", "ADA" or "аda" (Cyrillic а) next to the real "ada".
 * Everything we run enforces the canonical form instead:
 *   - input: trimmed, a leading "@" dropped, lowercased, then it must match USERNAME exactly
 *     (no silent stripping, so "ad-a" is refused rather than quietly becoming "ada");
 *   - names read from the chain are shown only if they are already canonical; any other name is
 *     treated as "no username" and the wallet address is shown instead.
 */
export const USERNAME = /^[a-z0-9_.]{3,24}$/;

export const USERNAME_RULE = "a username is 3-24 characters: a-z, 0-9, _ and .";

/** Canonical form of what someone typed, or null if it can't be a valid AevumPay username. */
export function canonicalUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^@/, "").toLowerCase();
  return USERNAME.test(s) ? s : null;
}

/** True only for a name that is already canonical, byte for byte (used for names read from the chain). */
export function isCanonicalUsername(name: string): boolean {
  return USERNAME.test(name);
}
