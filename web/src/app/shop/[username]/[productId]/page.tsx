import type { Metadata } from "next";
import type { Store } from "@/lib/api";
import { cleanName, serverGet, usd } from "@/lib/server-api";
import CheckoutClient from "./CheckoutClient";

type Props = { params: Promise<{ username: string; productId: string }> };

async function load(p: Props["params"]) {
  const { username, productId } = await p;
  const u = cleanName(username);
  const id = /^\d+$/.test(productId) ? productId : "0";
  return { u, id, store: await serverGet<Store>(`/stores/${u}`) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { u, id, store } = await load(params);
  const product = store?.products.find((p) => String(p.id) === id);
  if (!store || !product) return { title: `Checkout · @${u}` };
  const title = `${product.name}, ${usd(product.price)} · ${store.name}`;
  const description = `Buy ${product.name} from ${store.name} (@${u}) for ${usd(product.price)} in tUSD8. No fees; paid straight to the shop on QDay Aevum.`;
  return { title, description, openGraph: { title, description } };
}

/** One product's checkout, rendered with the product on the server. */
export default async function Page({ params }: Props) {
  const { u, id, store } = await load(params);
  return <CheckoutClient username={u} productId={id} initialStore={store} />;
}
