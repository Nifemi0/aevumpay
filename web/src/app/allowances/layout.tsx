import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Spending permissions",
  description: "AI agents and subscriptions that may spend from your wallet, within limits enforced on-chain. Revoke any of them in one tap.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
