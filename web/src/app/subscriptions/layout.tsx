import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Subscriptions",
  description: "The subscriptions you pay and the ones you sell. Terms are fixed on-chain; cancel any time.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
