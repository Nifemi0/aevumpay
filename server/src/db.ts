import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { KeyBlob } from "./crypto";

export type Role = "personal" | "business";

export interface User {
  id: string;
  username: string;
  role: Role;
  address: string;
  salt: string;
  hash: string;
  keyBlob: KeyBlob;
  createdAt: number;
}

export interface Session {
  token: string;
  userId: string;
  exp: number;
}

export interface Db {
  users: User[];
  sessions: Session[];
}

let db: Db = { users: [], sessions: [] };
let dbPath = "./data/db.json";

export function loadDb(path: string): void {
  dbPath = path;
  if (existsSync(path)) {
    try {
      db = JSON.parse(readFileSync(path, "utf8")) as Db;
      db.users ??= [];
      db.sessions ??= [];
    } catch (e) {
      console.warn(`[db] failed to read ${path}, starting empty:`, (e as Error).message);
      db = { users: [], sessions: [] };
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
