import type { Metadata } from "next";
import type { Plan } from "@/lib/api";
import { periodText } from "@/lib/format";
import { serverGet, usd } from "@/lib/server-api";
import SubscribeClient from "./SubscribeClient";

type Props = { params: Promise<{ planId: string }> };

const idOf = async (p: Props["params"]) => {
  const { planId } = await p;
  return /^\d+$/.test(planId) ? planId : "0";
};
const load = (id: string) => serverGet<Plan>(`/plan/${id}`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load(await idOf(params));
  if (!p) return { title: "Subscription" };
  const from = p.merchantUsername ? ` from @${p.merchantUsername}` : "";
  const title = `${p.name}: ${usd(p.amount)} ${periodText(p.period)}${from}`;
  const description = `Subscribe to ${p.name}${from} on AevumPay. The price and schedule are fixed on-chain (the shop can't raise them), and you can cancel any time in one tap.`;
  return { title, description, openGraph: { title, description } };
}

/** A shared subscription link, rendered with the plan on the server. */
export default async function Page({ params }: Props) {
  const id = await idOf(params);
  return <SubscribeClient planId={id} initialPlan={await load(id)} />;
}
