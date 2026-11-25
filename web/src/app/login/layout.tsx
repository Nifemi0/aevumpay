import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to AevumPay with your @name and password. Your wallet key stays in your browser.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
