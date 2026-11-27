/** "248.5" → { dollars: "$248", cents: ".50" }. Works on the server's decimal strings without floats. */
export function money(amount: string): { dollars: string; cents: string } {
  const [whole = "0", frac = ""] = amount.trim().replace(/^-/, "").split(".");
  const dollars = "$" + Number(whole || "0").toLocaleString("en-US");
  const cents = "." + (frac + "00").slice(0, 2);
  return { dollars, cents };
}

export function moneyText(amount: string): string {
  const m = money(amount);
  return m.dollars + m.cents;
}

/** Keep what a person types into an amount box to digits and at most 2 decimals. */
export function cleanAmount(input: string): string {
  let v = input.replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  if (v.startsWith(".")) v = "0" + v;
  return v.replace(/^0+(?=\d)/, "");
}

/** a - b for tUSD8 decimal strings, in integers. */
export function subAmounts(a: string, b: string): string {
  const m = (x: string) => {
    const [w = "0", f = ""] = x.split(".");
    return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  };
  const d = m(a) - m(b);
  return `${d / 1_000_000n}.${(d % 1_000_000n).toString().padStart(6, "0")}`;
}

/** Sum of tUSD8 decimal strings (6 dp), in integers to avoid float drift. */
export function sumAmounts(amounts: string[]): string {
  const micros = amounts.reduce((acc, a) => {
    const [w = "0", f = ""] = a.split(".");
    return acc + BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  }, 0n);
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
}

export function isPositiveAmount(v: string): boolean {
  return /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0;
}

export function shortAddr(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string): string {
  return h && h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

export function initials(name: string): string {
  const clean = name.replace(/^@/, "").replace(/[^a-zA-Z0-9 _.]/g, "");
  const parts = clean.split(/[\s_.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}

const AVATAR_COLORS = ["#b8e77f", "#f2d27a", "#9ed7c4", "#e9b8a8", "#c8c2ef", "#a9d4f0"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Same rules the server applies (server/src/index.ts `norm`). */
/**
 * AevumPay usernames: 3-24 characters of a-z, 0-9, _ and . The contract only checks the length, so
 * look-alikes ("Ada", "аda" with a Cyrillic а) can exist on-chain; the app only ever pays the
 * canonical form and refuses anything else rather than guessing.
 */
export const USERNAME = /^[a-z0-9_.]{3,24}$/;
export const USERNAME_CHARS_HINT = "Use only a-z, 0-9, _ and . (no spaces, symbols or accented letters).";

/** Trimmed, lowercased, without a leading "@". Other characters are kept: check isValidUsername. */
export function normUsername(u: string): string {
  return u.trim().replace(/^@/, "").toLowerCase();
}

export const isValidUsername = (u: string) => USERNAME.test(u);
export const hasBadUsernameChars = (u: string) => /[^a-z0-9_.]/.test(u);

/** 60 → "every minute", 2592000 → "every 30 days". */
export function periodText(seconds: number): string {
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? `every ${name}` : `every ${n} ${name}s`;
    }
  }
  return `every ${seconds} seconds`;
}

export function dateText(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
