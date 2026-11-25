import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { WalletBlob } from "./crypto";

export type Role = "personal" | "business";

export interface User {
  id: string;
  username: string;
  role: Role;
  address: string;
  /** scrypt hash of the browser-derived auth key (never the password itself). */
  salt: string;
  hash: string;
  /** The wallet key, encrypted in the browser. Absent on accounts made before browser-held keys. */
  wallet?: WalletBlob;
  createdAt: number;
}

export interface Session {
  token: string;
  userId: string;
  exp: number;
}

/** A welcome grant of test tUSD8 (see grant.ts). One per account and one per wallet, ever. */
export interface Grant {
  userId: string;
  address: string;
  amount: string;
  txHash: string;
  at: number;
}

/** One payment made against a request (see requests.ts). */
export interface RequestPayment {
  paymentId: string;
  payer: string;
  payerUsername: string | null;
  amount: string;
  txHash: string;
  at: number;
}

/**
 * A payment request: "pay @owner $amount for note". Off-chain bookkeeping only: the money moves
 * on-chain like any payment, and a request is marked paid when this server relays a payment that
 * names it (to the right person, for the right amount).
 */
export interface PayRequest {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerAddress: string;
  /** Fixed amount, or null for "any amount". */
  amount: string | null;
  note: string;
  /** One payment closes it; otherwise it keeps collecting (a tip jar, a group split). */
  oneTime: boolean;
  expiresAt: number | null;
  cancelled: boolean;
  createdAt: number;
  payments: RequestPayment[];
}

export interface Db {
  users: User[];
  sessions: Session[];
  grants: Grant[];
  requests: PayRequest[];
}

let db: Db = { users: [], sessions: [], grants: [], requests: [] };
let dbPath = "./data/db.json";

export function loadDb(path: string): void {
  dbPath = path;
  if (existsSync(path)) {
    try {
      db = JSON.parse(readFileSync(path, "utf8")) as Db;
      db.users ??= [];
      db.sessions ??= [];
      db.grants ??= [];
      db.requests ??= [];
    } catch (e) {
      console.warn(`[db] failed to read ${path}, starting empty:`, (e as Error).message);
      db = { users: [], sessions: [], grants: [], requests: [] };
    }
  }
}

export function saveDb(): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, dbPath); // atomic replace
}

export function findUserByUsername(username: string): User | undefined {
  return db.users.find((u) => u.username === username.toLowerCase());
}

export function findUserById(id: string): User | undefined {
  return db.users.find((u) => u.id === id);
}

export function allUsers(): User[] {
  return db.users;
}

export function createSession(userId: string, ttlMs = 30 * 24 * 3600 * 1000): string {
  const token = randomBytes(32).toString("hex");
  db.sessions = db.sessions.filter((s) => s.exp > Date.now()); // prune expired
  db.sessions.push({ token, userId, exp: Date.now() + ttlMs });
  saveDb();
  return token;
}

export function userForToken(token: string): User | undefined {
  const s = db.sessions.find((x) => x.token === token && x.exp > Date.now());
  return s ? findUserById(s.userId) : undefined;
}

export function addUser(user: User): void {
  db.users.push(user);
  saveDb();
}

export function grantFor(userId: string, address: string): Grant | undefined {
  const a = address.toLowerCase();
  return db.grants.find((g) => g.userId === userId || g.address === a);
}

export function grantsSince(ms: number): number {
  return db.grants.filter((g) => g.at >= ms).length;
}

export function addGrant(g: Grant): void {
  db.grants.push({ ...g, address: g.address.toLowerCase() });
  saveDb();
}

export function addRequest(r: PayRequest): void {
  db.requests.push(r);
  saveDb();
}

export function findRequest(id: string): PayRequest | undefined {
  return db.requests.find((r) => r.id === id);
}

export function requestsOf(ownerId: string, limit = 50): PayRequest[] {
  return db.requests.filter((r) => r.ownerId === ownerId).slice(-limit).reverse();
}
