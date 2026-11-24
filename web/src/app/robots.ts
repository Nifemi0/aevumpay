import type { MetadataRoute } from "next";

/** Crawlers and AI tools are welcome; the agent guides live at /llms.txt and /llms-full.txt. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }] };
}
