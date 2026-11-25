import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Activity",
  description: "Every payment in and out, each with an on-chain receipt.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
