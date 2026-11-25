import type { Metadata } from "next";
import PayClient from "./PayClient";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Link previews. When a pay link is shared (WhatsApp, X, iMessage…) the card reads
 * "@kemi is requesting $5.00", with an image made by /og/pay. Software gets the same request as
 * JSON from the API (the `alternate` link), so an agent can read and pay it.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const username = decodeURIComponent((await params).username).toLowerCase().replace(/[^a-z0-9_.]/g, "");
  const sp = await searchParams;
  let amount = /^\d+(\.\d{1,6})?$/.test(one(sp.amount)) ? one(sp.amount) : "";
  let note = one(sp.note).slice(0, 80);
  let status = "open";
  const r = /^[A-Za-z0-9]{10}$/.test(one(sp.r)) ? one(sp.r) : "";
  if (r) {
    try {
      const res = await fetch(`${API}/requests/${r}`, { next: { revalidate: 20 } });
      if (res.ok) {
        const data = (await res.json()) as { amount: string | null; note: string; status: string };
        amount = data.amount ?? "";
        note = data.note;
        status = data.status;
      }
    } catch {
      /* the preview falls back to what the link itself says */
    }
  }
  const money = amount ? `$${Number(amount).toFixed(Number(amount) % 1 ? 2 : 0)}` : "";
  const title = status === "paid" ? `Paid: @${username}'s request` : money ? `@${username} is requesting ${money}` : `Pay @${username}`;
  const description = `${note ? `${note} · ` : ""}Pay with AevumPay: by @name, no fees, settles on Aevum in about a second.`;
  const og = new URLSearchParams({ u: username });
  if (amount) og.set("a", amount);
  if (note) og.set("n", note);
  if (status !== "open") og.set("s", status);
  const q = new URLSearchParams();
  if (amount && !r) q.set("amount", amount);
  if (note && !r) q.set("note", note);
  if (r) q.set("r", r);
  const image = { url: `/og/pay?${og}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { title, description, images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: { types: { "application/json": [{ url: `${API}/pay/${username}${q.toString() ? `?${q}` : ""}`, title: "Payment request (JSON)" }] } },
  };
}

export default function Page() {
  return <PayClient />;
}
