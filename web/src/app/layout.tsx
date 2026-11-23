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
  title: { default: "AevumPay", template: "%s · AevumPay" },
  description: "Pay anyone by @username in tUSD8 on the QDay Aevum testnet. No gas, no wallet addresses.",
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
    <html lang="en" className={`${outfit.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body>
        <SessionProvider>
          <AppFrame>{children}</AppFrame>
        </SessionProvider>
      </body>
    </html>
  );
}
