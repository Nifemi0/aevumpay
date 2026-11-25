"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  ApiError,
  api,
  captureReads,
  checkNetworkStamp,
  followLive,
  getToken,
  rememberUser,
  remembered,
  rememberedUser,
  setToken,
  type LiveEvent,
  type Role,
  type User,
  type WalletBlob,
} from "./api";

/** Window event fired for every live update from the server (detail: LiveEvent). */
const LIVE_EVENT = "aevumpay:live";
import { normUsername } from "./format";
import { signContractCall } from "./sign";
import { deriveKeys, deviceAccount, deviceAddress, encryptForBackup, forgetDevice, hasDeviceKey, newPrivateKey, openBackup, saveOnDevice } from "./wallet";

/**
 * - loading: checking the stored session
 * - out: not signed in
 * - locked: signed in, but this browser doesn't hold the wallet key yet (needs the password once)
 * - in: signed in, key available on this device
 */
type Status = "loading" | "out" | "locked" | "in";

interface Session {
  status: Status;
  user: User | null;
  /** Chain the server is on (44005 = Aevum testnet). null until /health answers. */
  chainId: number | null;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, role: Role, password: string) => Promise<User>;
  /** Re-derive the key from the password on a device that doesn't hold it. */
  unlock: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** The signer for the current user. Throws if this browser doesn't hold the key. */
  account: () => Promise<PrivateKeyAccount>;
  /** Decrypt the key for export. Asks for the password again as a guard. */
  exportKey: (password: string) => Promise<Hex>;
}

const SessionContext = createContext<Session | null>(null);

const WRONG_PASSWORD = "That password doesn't unlock this wallet.";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<WalletBlob | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      // Open straight on the account seen last time (if this browser still holds its key), then
      // let the server confirm it below: the screen doesn't wait for the network.
      const saved = getToken() ? rememberedUser() : null;
      if (saved && (await hasDeviceKey(saved.username))) {
        setUser(saved);
        setStatus("in");
      }
      // Which chain is the server on? Data this browser saved for another server or chain (say, a
      // local test chain) is stale, so it's dropped before we look at the stored session.
      // Both requests go out at once (each is a full round trip to the API); the session is used
      // only if the network check below didn't just wipe it.
      const meReq = getToken() ? api.me() : null;
      meReq?.catch(() => {}); // handled below; avoid an unhandled rejection if we never await it
      try {
        const h = await api.health();
        setChainId(h.chainId);
        checkNetworkStamp(h.chainId);
      } catch {
        setChainId(null);
      }
      if (!meReq || !getToken()) return setStatus("out");
      try {
        const { user, wallet } = await meReq;
        if (!wallet) {
          // An account from before browser-held keys: nothing this browser could unlock.
          setToken(null);
          return setStatus("out");
        }
        // A key saved here under the same @name but for a different wallet (an old test account)
        // can't sign for this one: forget it, and ask for the password to fetch the right one.
        const held = await deviceAddress(user.username);
        if (held && held.toLowerCase() !== user.address.toLowerCase()) await forgetDevice(user.username);
        setUser(user);
        setWallet(wallet);
        setStatus((await hasDeviceKey(user.username)) ? "in" : "locked");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setToken(null);
        setStatus("out");
      }
    })();
  }, []);

  const register = useCallback(async (rawName: string, role: Role, password: string) => {
    const username = normUsername(rawName);
    const { authKey, kek } = await deriveKeys(username, password);
    const privateKey = newPrivateKey();
    const account = privateKeyToAccount(privateKey);
    // The wallet registers its own username; the server only adds gas and broadcasts.
    const registerTx = await signContractCall(account, { functionName: "register", args: [username] });
    const backup = await encryptForBackup(kek, privateKey);
    const r = await api.register({ username, role, authKey, address: account.address, wallet: backup, registerTx });
    await saveOnDevice(username, privateKey);
    setToken(r.token);
    setUser(r.user);
    setWallet(r.wallet);
    setStatus("in");
    return r.user;
  }, []);

  const login = useCallback(async (rawName: string, password: string) => {
    const username = normUsername(rawName);
    const { authKey, kek } = await deriveKeys(username, password);
    const r = await api.login(username, authKey);
    let privateKey: Hex;
    try {
      privateKey = await openBackup(kek, r.wallet);
    } catch {
      throw new Error(WRONG_PASSWORD);
    }
    await saveOnDevice(username, privateKey);
    setToken(r.token);
    setUser(r.user);
    setWallet(r.wallet);
    setStatus("in");
    return r.user;
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      if (!user || !wallet) throw new Error("Log in again to unlock this wallet.");
      const { kek } = await deriveKeys(user.username, password);
      let privateKey: Hex;
      try {
        privateKey = await openBackup(kek, wallet);
      } catch {
        throw new Error(WRONG_PASSWORD);
      }
      await saveOnDevice(user.username, privateKey);
      setStatus("in");
    },
    [user, wallet],
  );

  // Remember who is signed in, for the instant start above.
  useEffect(() => {
    if (user) rememberUser(user);
  }, [user]);

  // Signed out after all (expired session): let the landing page show (layout hid it early).
  useEffect(() => {
    if (status === "out") document.documentElement.classList.remove("has-session");
  }, [status]);

  // Live updates: the server pushes new payments and changes; screens using useLoad refresh
  // themselves, and money arriving shows a short note.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!user || (status !== "in" && status !== "locked")) return;
    const ctl = new AbortController();
    const mine = user.address.toLowerCase();
    void followLive((e) => {
      if (e.type === "incoming") {
        // Broadcast, not yet confirmed: say so; the confirmed `payment` follows in about a second.
        const from = e.data.payerUsername ? `@${e.data.payerUsername}` : "Someone";
        setToast(`${from} is sending you $${Number(e.data.amount).toFixed(2)}…`);
        return;
      }
      window.dispatchEvent(new CustomEvent<LiveEvent>(LIVE_EVENT, { detail: e }));
      if (e.type === "payment" && e.data.payee.toLowerCase() === mine && e.data.payer.toLowerCase() !== mine) {
        const from = e.data.payerUsername ? `@${e.data.payerUsername}` : "someone";
        setToast(`You received $${Number(e.data.amount).toFixed(2)} from ${from}`);
      }
    }, ctl.signal);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, status]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const logout = useCallback(async () => {
    if (user) await forgetDevice(user.username);
    setToken(null);
    setUser(null);
    setWallet(null);
    setStatus("out");
  }, [user]);

  const account = useCallback(async () => {
    const a = user ? await deviceAccount(user.username) : null;
    if (!a) {
      setStatus("locked");
      throw new Error("Unlock your wallet with your password first.");
    }
    if (a.address.toLowerCase() !== user!.address.toLowerCase()) throw new Error("This browser holds a different wallet. Log out and in again.");
    return a;
  }, [user]);

  const exportKey = useCallback(
    async (password: string) => {
      if (!user || !wallet) throw new Error("Log in again first.");
      const { kek } = await deriveKeys(user.username, password);
      try {
        return await openBackup(kek, wallet);
      } catch {
        throw new Error(WRONG_PASSWORD);
      }
    },
    [user, wallet],
  );

  const value = useMemo(
    () => ({ status, user, chainId, login, register, unlock, logout, account, exportKey }),
    [status, user, chainId, login, register, unlock, logout, account, exportKey],
  );
  return (
    <SessionContext.Provider value={value}>
      {children}
      {toast && (
        <div className="live-toast" role="status" aria-live="polite" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

/** For signed-in screens: sends people to /login (and back here afterwards) when there is no session. */
export function useRequireUser(): User | null {
  const { status, user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (status === "out") {
      const here = pathname + (typeof window !== "undefined" ? window.location.search : "");
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [status, router, pathname]);
  return status === "in" ? user : null;
}

/** Only allow same-site paths as a post-login destination. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

/**
 * Load data once the inputs are ready; `reload()` fetches again.
 *
 * Instant screens: if this browser has the last answer to the same read, it shows right away
 * (no spinner) and the fresh answer replaces it when it lands. And when the server pushes a live
 * update (a payment, a change to your store or allowances), the data reloads quietly by itself.
 */
export function useLoad<T>(fn: (() => Promise<T>) | null, deps: unknown[], initial?: T | null) {
  // `initial`: data the server already fetched for this page, so its HTML has real content (for
  // people on slow phones and for agents that read pages without running JavaScript).
  const [data, setData] = useState<T | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(fn) && initial == null);
  const [tick, setTick] = useState(0);
  const quiet = useRef(initial != null); // with server data, the first refresh is a quiet one

  useEffect(() => {
    if (!fn) return;
    let live = true;
    const silent = quiet.current;
    quiet.current = false;
    const { result, paths } = captureReads(fn);
    const prior = !silent && paths.length === 1 ? remembered<T>(paths[0]!) : undefined;
    if (prior !== undefined) {
      setData(prior);
      setError(null);
      setLoading(false);
    } else if (!silent) {
      setLoading(true);
    }
    result
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        // Keep showing what we have if a quiet refresh (or one behind remembered data) fails.
        if (!live || silent || prior !== undefined) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, Boolean(fn)]);

  // Live update from the server: fetch again, without a spinner.
  useEffect(() => {
    if (!fn) return;
    const onLive = () => {
      quiet.current = true;
      setTick((t) => t + 1);
    };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => window.removeEventListener(LIVE_EVENT, onLive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(fn)]);

  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
