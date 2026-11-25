import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Request money",
  description: "Make a payment link or QR code anyone can pay, and see it turn Paid the moment they do.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
