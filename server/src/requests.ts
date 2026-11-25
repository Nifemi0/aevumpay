/**
 * Payment requests ("@kemi is requesting $5 for lunch"): trackable pay links.
 *
 * A request is off-chain bookkeeping. Paying one is an ordinary on-chain payment to the owner; this
 * server marks the request paid when it relays a payment that names it, and only if that payment
 * went to the request's owner for the requested amount. The owner's open screens are told at once
 * (live push), so "Waiting for payment" turns into "Paid by @ada" within seconds.
 */
import { randomBytes } from "node:crypto";
import { parseUnits } from "viem";
import { addRequest, findRequest, saveDb, type PayRequest, type User } from "./db";

export const REQUEST_ID = /^[A-Za-z0-9]{10}$/;
const MAX_NOTE = 80;
const MAX_HOURS = 24 * 90;

export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function newRequestId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

export function createRequest(owner: User, body: { amount?: unknown; note?: unknown; oneTime?: unknown; expiresInHours?: unknown }): PayRequest {
  let amount: string | null = null;
  if (body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== "") {
    let units: bigint;
    try {
      units = parseUnits(String(body.amount), 6);
    } catch {
      throw new RequestError("invalid amount");
    }
    if (units <= 0n) throw new RequestError("amount must be more than 0");
    if (units > parseUnits("100000", 6)) throw new RequestError("amount is too large");
    amount = String(body.amount).trim();
  }
  const note = String(body.note ?? "").trim().slice(0, MAX_NOTE);
  const hours = body.expiresInHours === undefined || body.expiresInHours === null ? null : Number(body.expiresInHours);
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS)) throw new RequestError("expiry must be between 1 hour and 90 days");
  const r: PayRequest = {
    id: newRequestId(),
    ownerId: owner.id,
    ownerUsername: owner.username,
    ownerAddress: owner.address.toLowerCase(),
    amount,
    note,
    // A fixed amount is normally paid once; "any amount" (a tip jar) stays open unless asked.
    oneTime: body.oneTime === undefined ? amount !== null : Boolean(body.oneTime),
    expiresAt: hours === null ? null : Date.now() + hours * 3600_000,
    cancelled: false,
    createdAt: Date.now(),
    payments: [],
  };
  addRequest(r);
  return r;
}

export type RequestStatus = "open" | "paid" | "expired" | "cancelled";

export function statusOf(r: PayRequest): RequestStatus {
  if (r.oneTime && r.payments.length) return "paid";
  if (r.cancelled) return "cancelled";
  if (r.expiresAt !== null && Date.now() > r.expiresAt) return "expired";
  return "open";
}

/** What anyone with the link may see: no internal ids. */
export function publicRequest(r: PayRequest) {
  const total = r.payments.reduce((s, p) => s + Number(p.amount), 0);
  return {
    id: r.id,
    to: { username: r.ownerUsername, address: r.ownerAddress },
    amount: r.amount,
    note: r.note,
    oneTime: r.oneTime,
    status: statusOf(r),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    paidCount: r.payments.length,
    paidTotal: total.toFixed(6).replace(/\.?0+$/, ""),
    payments: r.payments.map((p) => ({
      paymentId: p.paymentId,
      payerUsername: p.payerUsername,
      amount: p.amount,
      txHash: p.txHash,
      at: p.at,
    })),
  };
}

/**
 * Before relaying a payment that names `id`: it must exist, be open, be for `payee`, and match its
 * fixed amount (if it has one). Returns the request, or throws a RequestError explaining why not.
 */
export function checkRequestPayable(id: string, payee: string, amount: string): PayRequest {
  if (!REQUEST_ID.test(id)) throw new RequestError("invalid request id");
  const r = findRequest(id);
  if (!r) throw new RequestError("this request doesn't exist", 404);
  const st = statusOf(r);
  if (st === "paid") throw new RequestError("this request has already been paid", 409);
  if (st === "expired") throw new RequestError("this request has expired", 410);
  if (st === "cancelled") throw new RequestError("this request was cancelled", 410);
  if (r.ownerAddress !== payee.toLowerCase()) throw new RequestError("this request is for someone else");
  if (r.amount !== null && parseUnits(r.amount, 6) !== parseUnits(amount, 6)) throw new RequestError(`this request is for exactly $${r.amount}`);
  return r;
}

/** Record a payment this server relayed against request `r` (after it confirmed on-chain). */
export function recordRequestPayment(r: PayRequest, p: { paymentId: string; payer: string; payerUsername: string | null; amount: string; txHash: string }) {
  if (r.payments.some((x) => x.txHash === p.txHash)) return;
  r.payments.push({ ...p, payer: p.payer.toLowerCase(), at: Date.now() });
  saveDb();
}

export function cancelRequest(r: PayRequest) {
  r.cancelled = true;
  saveDb();
}
