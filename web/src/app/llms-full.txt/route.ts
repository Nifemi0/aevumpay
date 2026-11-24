import { llmsFull, llmsUrls } from "@/lib/llms";

/** The complete agent guide: connect, check limits, pay, buy, handle refusals. */
export function GET(request: Request) {
  return new Response(llmsFull(llmsUrls(request)), {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
