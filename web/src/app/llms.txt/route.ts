import { llmsShort, llmsUrls } from "@/lib/llms";

/** https://llmstxt.org: a short Markdown map of AevumPay for AI models. */
export function GET(request: Request) {
  return new Response(llmsShort(llmsUrls(request)), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
