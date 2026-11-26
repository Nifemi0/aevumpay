import type { MetadataRoute } from "next";

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://pay.nuvixes.studio").replace(/\/+$/, "");

/** The public pages, for search engines and AI agents. Signed-in screens aren't listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({ url: `${APP}${path}`, lastModified: now, priority });
  return [
    page("/", 1),
    page("/signup", 0.8),
    page("/login", 0.5),
    page("/connect", 0.6),
    page("/developers", 0.8),
    page("/llms.txt", 0.9),
    page("/llms-full.txt", 0.9),
    // The demo shop, so there is a real storefront, checkout and plan to look at.
    page("/shop/demobakery", 0.7),
    page("/shop/demobakery/3", 0.5),
    page("/subscribe/2", 0.5),
  ];
}
