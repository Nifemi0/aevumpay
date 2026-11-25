import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Connect an AI agent",
  description: "Let an AI assistant pay for you within a budget, a per-payment cap and an expiry that the AevumPay contract enforces. Revoke any time.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
