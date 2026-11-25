import type { MetadataRoute } from "next";

const APP = (process.env.NEXT_PUBLIC_APP_URL || "https://pay.nuvixes.studio").replace(/\/+$/, "");

/** Crawlers and AI tools are welcome; the agent guides live at /llms.txt and /llms-full.txt. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }], sitemap: `${APP}/sitemap.xml`, host: APP };
}
