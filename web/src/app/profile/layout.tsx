import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your AevumPay account, wallet address and key export.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
