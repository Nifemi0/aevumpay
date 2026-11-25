/**
 * Reads made on the server while rendering a public page (shop, pay link, receipt, plan), so the
 * HTML already contains the content. This matters for slow phones and for AI agents and link
 * previewers that read pages without running JavaScript. Every read is optional: if the API is
 * slow or down, the page still renders and the browser fetches as usual.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");

export async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Like serverGet, but also says whether the API answered "not found" (vs. couldn't be reached). */
export async function serverLookup<T>(path: string, revalidate = 30): Promise<{ data: T | null; missing: boolean }> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate }, signal: AbortSignal.timeout(4000) });
    if (res.status === 404) return { data: null, missing: true };
    if (!res.ok) return { data: null, missing: false };
    return { data: (await res.json()) as T, missing: false };
  } catch {
    return { data: null, missing: false };
  }
}

export const apiUrl = API;

/** "$1.50", "$5" */
export function usd(amount: string | number): string {
  const n = Number(amount);
  return `$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)}`;
}

export const cleanName = (raw: string) => decodeURIComponent(raw).toLowerCase().replace(/[^a-z0-9_.]/g, "");
