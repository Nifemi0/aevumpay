/**
 * Answer reads from memory. Every read the app makes goes to a slow testnet RPC (~1 s a call), so
 * each answer is kept and served instantly next time, while a fresh copy is fetched in the
 * background once it is a few seconds old (stale-while-revalidate).
 *
 * Freshness after a change: when an address is touched (the indexer saw an event for it, or this
 * server just relayed one of its transactions), its entries are marked dirty and refreshed at
 * once. A request for a dirty entry waits for that refresh, so nobody sees data from before their
 * own payment. Money is never decided from this cache: the contract checks everything on-chain.
 */
interface Entry {
  value?: unknown;
  has: boolean;
  at: number;
  dirty: boolean;
  inflight?: Promise<unknown>;
  fetch: () => Promise<unknown>;
}

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 20_000;

function refresh(key: string, e: Entry): Promise<unknown> {
  if (!e.inflight) {
    e.inflight = e
      .fetch()
      .then((v) => {
        e.value = v;
        e.has = true;
        e.at = Date.now();
        e.dirty = false;
        return v;
      })
      .finally(() => {
        e.inflight = undefined;
      });
    // A background refresh that fails keeps the old value; the next request will retry.
    e.inflight.catch(() => {});
  }
  return e.inflight;
}

/**
 * The cached value for `key`, fetching it with `fetch` if there is none. Values older than
 * `freshMs` are returned as they are and refreshed in the background. Put any address the value
 * depends on in the key (lowercase is handled here) so `touch(address)` finds it.
 */
export async function cached<T>(key: string, fetch: () => Promise<T>, freshMs = 15_000): Promise<T> {
  const k = key.toLowerCase();
  let e = entries.get(k);
  if (!e) {
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    e = { has: false, at: 0, dirty: false, fetch };
    entries.set(k, e);
  }
  e.fetch = fetch;
  if (!e.has || e.dirty) return (await refresh(k, e)) as T;
  if (Date.now() - e.at > freshMs) void refresh(k, e);
  return e.value as T;
}

/** Something changed for these addresses (or keys): refresh every entry that mentions them. */
export function touch(...needles: string[]) {
  const ns = needles.filter(Boolean).map((n) => n.toLowerCase());
  if (!ns.length) return;
  for (const [k, e] of entries) {
    if (ns.some((n) => k.includes(n))) {
      e.dirty = true;
      void refresh(k, e);
    }
  }
}

/** Forget one entry (e.g. a lookup that should not be cached after all). */
export function forget(key: string) {
  entries.delete(key.toLowerCase());
}
