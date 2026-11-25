import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Send",
  description: "Send tUSD8 to any @name. No wallet address, no gas fee.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
