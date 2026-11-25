import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { AppFrame } from "@/components/AppFrame";
import { SessionProvider } from "@/lib/session";
import "./globals.css";
import "./landing.css";

const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-outfit", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  // Absolute URLs for link-preview images (pay links shared on WhatsApp, X…).
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://pay.nuvixes.studio"),
  title: { default: "AevumPay: pay anyone by @name", template: "%s · AevumPay" },
  description:
    "Stablecoin payments on QDay Aevum: pay anyone by @name in tUSD8 with no gas and no wallet address, sell with a link, and let AI agents pay within limits the contract enforces. Testnet.",
  openGraph: { siteName: "AevumPay", type: "website" },
  // Points AI tools at the plain-text guides (/llms.txt, /llms-full.txt).
  alternates: { types: { "text/markdown": [{ url: "/llms.txt", title: "AevumPay for AI agents (llms.txt)" }] } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#b8e77f" },
    { media: "(prefers-color-scheme: dark)", color: "#1f3313" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        {/* Signed in on this browser? Then don't flash the landing page before Home appears. */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("aevumpay.token"))document.documentElement.classList.add("has-session")}catch(e){}` }} />
      </head>
      <body>
        <SessionProvider>
          <AppFrame>{children}</AppFrame>
        </SessionProvider>
      </body>
    </html>
  );
}
