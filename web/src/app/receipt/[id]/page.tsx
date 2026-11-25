import type { Metadata } from "next";
import type { Receipt } from "@/lib/api";
import { serverGet, usd } from "@/lib/server-api";
import ReceiptClient from "./ReceiptClient";

type Props = { params: Promise<{ id: string }> };

const idOf = async (p: Props["params"]) => {
  const { id } = await p;
  return /^\d+$/.test(id) ? id : "0";
};
// A receipt never changes once written, so the server can keep it for a long time.
const load = (id: string) => serverGet<Receipt>(`/payments/${id}`, 3600);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = await idOf(params);
  const r = await load(id);
  if (!r) return { title: `Receipt #${id}` };
  const when = new Date(r.paidAt * 1000).toUTCString().replace(/:\d\d GMT$/, " UTC");
  const title = `Receipt #${id}: ${usd(r.amount)} paid`;
  const description = `${usd(r.amount)} in tUSD8 paid on QDay Aevum testnet on ${when}, recorded on-chain by the AevumPay contract.${r.via ? " Paid by an AI agent within its allowance." : ""}`;
  return { title, description, openGraph: { title, description } };
}

/** An on-chain receipt, rendered on the server with its details. */
export default async function Page({ params }: Props) {
  const id = await idOf(params);
  return <ReceiptClient id={id} initialReceipt={await load(id)} />;
}
