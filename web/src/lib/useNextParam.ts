"use client";

import { useSearchParams } from "next/navigation";

/** The `?next=` path to return to after logging in or signing up. Use inside <Suspense>. */
export function useNextParam(): string | null {
  return useSearchParams().get("next");
}
