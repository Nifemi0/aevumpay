import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Add money",
  description: "Get test dollars (tUSD8) for AevumPay: welcome dollars and the QDay faucet.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
