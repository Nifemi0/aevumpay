import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Your store",
  description: "Sell with a link: products, subscription plans and sales for your AevumPay store.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
