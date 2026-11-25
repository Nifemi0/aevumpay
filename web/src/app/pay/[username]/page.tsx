import type { Metadata } from "next";
import type { PayRequest, PublicUser } from "@/lib/api";
import { apiUrl, cleanName, serverGet, serverLookup, usd } from "@/lib/server-api";
import PayClient from "./PayClient";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The link's name and query, cleaned, plus what the server can tell about it. */
async function load({ params, searchParams }: Props) {
  const username = cleanName((await params).username);
  const sp = await searchParams;
  const query = {
    amount: /^\d+(\.\d{1,6})?$/.test(one(sp.amount)) ? one(sp.amount) : "",
    note: one(sp.note).slice(0, 80),
    r: /^[A-Za-z0-9]{10}$/.test(one(sp.r)) ? one(sp.r) : "",
  };
  const [lookup, request] = await Promise.all([
    serverLookup<PublicUser>(`/users/${username}`),
    query.r ? serverGet<PayRequest>(`/requests/${query.r}`, 10) : Promise.resolve(null),
  ]);
  return { username, query, payee: lookup.data, missing: lookup.missing, request };
}

/**
 * Link previews and agents. When a pay link is shared (WhatsApp, X, iMessage…) the card reads
 * "@kemi is requesting $5.00", with an image made by /og/pay. Software gets the same request as
 * JSON from the API (the `alternate` link), so an agent can read and pay it.
 */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const { username, query, payee, request } = await load(props);
  if (!payee) return { title: "Payment link", description: `No AevumPay user is called @${username}.` };
  const amount = request ? (request.amount ?? "") : query.amount;
  const note = request ? request.note : query.note;
  const status = request?.status ?? "open";
  const money = amount ? usd(amount) : "";
  const title = status === "paid" ? `Paid: @${username}'s request` : money ? `@${username} is requesting ${money}` : `Pay @${username}`;
  const description = `${note ? `${note} · ` : ""}Pay @${username} with AevumPay: by @name, no fees, settles on QDay Aevum in about a second.`;
  const og = new URLSearchParams({ u: username });
  if (amount) og.set("a", amount);
  if (note) og.set("n", note);
  if (status !== "open") og.set("s", status);
  const q = new URLSearchParams();
  if (query.r) q.set("r", query.r);
  else {
    if (query.amount) q.set("amount", query.amount);
    if (query.note) q.set("note", query.note);
  }
  const image = { url: `/og/pay?${og}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { title, description, images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: { types: { "application/json": [{ url: `${apiUrl}/pay/${username}${q.toString() ? `?${q}` : ""}`, title: "Payment request (JSON)" }] } },
  };
}

/** A shared pay link, rendered on the server with who, how much and the request's status. */
export default async function Page(props: Props) {
  const { username, query, payee, missing, request } = await load(props);
  return <PayClient username={username} query={query} initialPayee={payee} initialRequest={request} missing={missing} />;
}
