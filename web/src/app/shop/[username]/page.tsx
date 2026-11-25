import type { Metadata } from "next";
import type { Plan, Store } from "@/lib/api";
import { cleanName, serverGet, usd } from "@/lib/server-api";
import ShopClient from "./ShopClient";

type Props = { params: Promise<{ username: string }> };

const load = (u: string) => Promise.all([serverGet<Store>(`/stores/${u}`), serverGet<{ plans: Plan[] }>(`/plans/${u}`)]);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const u = cleanName((await params).username);
  const [store] = await load(u);
  if (!store) return { title: `@${u}'s shop`, description: `Shop on AevumPay: pay @${u} by name in tUSD8, no fees.` };
  const items = store.products.filter((p) => p.active).map((p) => `${p.name} ${usd(p.price)}`);
  const description = `${items.length ? `${items.join(" · ")}. ` : ""}Pay in tUSD8 with AevumPay: no fees, no wallet address.`;
  return { title: `${store.name} (@${u})`, description, openGraph: { title: `${store.name} on AevumPay`, description } };
}

/** Public storefront. Rendered with its products on the server, then live in the browser. */
export default async function Page({ params }: Props) {
  const u = cleanName((await params).username);
  const [store, plans] = await load(u);
  return <ShopClient username={u} initialStore={store} initialPlans={plans} />;
}
