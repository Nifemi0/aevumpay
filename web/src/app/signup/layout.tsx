import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Get your @name",
  description: "Claim a free @name on AevumPay and get a wallet that lives in your browser. Pay anyone by name in tUSD8, no gas.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
