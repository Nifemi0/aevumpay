"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Balance, balSize, ErrorBox, Loading, NavRow, Screen, Spinner, SubmitButton, Who , CheckingSession } from "@/components/ui";
import { ApiError, api, type PublicUser } from "@/lib/api";
import { cleanAmount, hasBadUsernameChars, isPositiveAmount, moneyText, normUsername, shortAddr, USERNAME_CHARS_HINT } from "@/lib/format";
import { saveLocalReceipt } from "@/lib/receipts";
import { useLoad, useRequireUser, useSession } from "@/lib/session";
import { signPayment } from "@/lib/sign";

export default function SendPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Send />
    </Suspense>
  );
}

type Lookup = { state: "idle" } | { state: "checking" } | { state: "found"; user: PublicUser } | { state: "missing" } | { state: "invalid" } | { state: "error"; message: string };

function Send() {
  const user = useRequireUser();
  const { account } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [toRaw, setToRaw] = useState(params.get("to") ?? "");
  const [amount, setAmount] = useState(cleanAmount(params.get("amount") ?? ""));
  const [note, setNote] = useState(params.get("note") ?? "");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [editingTo, setEditingTo] = useState(!params.get("to"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const balance = useLoad(user ? () => api.balance() : null, [user?.id]);

  const to = normUsername(toRaw);

  useEffect(() => {
    // Never "fix up" a name: "ad-a" must not quietly become "ada".
    if (hasBadUsernameChars(to)) return setLookup({ state: "invalid" });
    if (to.length < 3) return setLookup({ state: "idle" });
    setLookup({ state: "checking" });
    const t = setTimeout(() => {
      api
        .user(to)
        .then((u) => {
          setLookup({ state: "found", user: u });
          if (params.get("to")) setEditingTo(false);
        })
        .catch((e) => setLookup(e instanceof ApiError && e.status === 404 ? { state: "missing" } : { state: "error", message: (e as Error).message }));
    }, 300);
    return () => clearTimeout(t);
  }, [to, params]);

  if (!user) return <CheckingSession />;

  const self = to === user.username;
  const over = balance.data && isPositiveAmount(amount) && Number(amount) > Number(balance.data.balance);
  const ready = lookup.state === "found" && !self && isPositiveAmount(amount) && !over;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      // Signed here with the key in this browser; the server only relays it and pays the gas.
      if (lookup.state !== "found") return;
      // The payee and note are part of what we sign, so a relay can't redirect or relabel it.
      const authorization = await signPayment(await account(), amount, { payee: lookup.user.address as `0x${string}`, memo: note.trim() });
      const r = await api.send(to, amount, note.trim(), authorization);
      saveLocalReceipt(r.paymentId, { note: note.trim() || undefined, txHash: r.txHash, explorer: r.explorer, blockNumber: r.blockNumber, counterparty: to });
      router.replace(`/receipt/${r.paymentId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const found = lookup.state === "found" ? lookup.user : null;

  return (
    <Screen
      band={
        <>
          <NavRow title="Send" back="/" />
          <div className="balcard">
            <span className="unit">Available</span>
            {balance.data ? <Balance amount={balance.data.balance} size={32} /> : <span className="bal" style={balSize(32, { opacity: 0.35 })}>$—</span>}
          </div>
          {found && !editingTo ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "color-mix(in srgb, var(--sheet) 35%, transparent)", borderRadius: 18, padding: "10px 10px 10px 12px" }}>
              <Who name={`@${found.username}`} sub={<span className="mono">{shortAddr(found.address)}</span>} />
              <button type="button" className="linkbtn" style={{ background: "var(--sheet)", borderColor: "transparent" }} onClick={() => setEditingTo(true)}>
                Change
              </button>
            </div>
          ) : null}
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        {(!found || editingTo) && (
          <>
            <div className="field">
              <label htmlFor="to">To</label>
              <div className="row">
                <span className="prefix">@</span>
                <input
                  id="to"
                  value={toRaw}
                  onChange={(e) => setToRaw(e.target.value)}
                  onBlur={() => found && !self && setEditingTo(false)}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="username"
                  autoFocus={!params.get("to")}
                />
                {lookup.state === "checking" && <Spinner size={16} label="Looking up" style={{ color: "var(--ink-3)" }} />}
                {found && !self && <span className="pill ok">Found</span>}
              </div>
            </div>
            <p className="hint" style={{ marginTop: -6, paddingInline: 4 }} aria-live="polite">
              {self
                ? "That's you. Pick someone else."
                : lookup.state === "invalid"
                  ? `That isn't an @name. ${USERNAME_CHARS_HINT}`
                : lookup.state === "missing"
                  ? `No one has @${to} yet. Check the spelling.`
                  : lookup.state === "error"
                    ? lookup.message
                    : found
                      ? `Paying @${found.username} · ${shortAddr(found.address)}`
                      : "Type their @username."}
            </p>
          </>
        )}

        <div className="amount-input">
          <span>$</span>
          <label htmlFor="amount" className="sr-only">
            Amount in tUSD8
          </label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(cleanAmount(e.target.value))}
            placeholder="0.00"
            autoFocus={Boolean(params.get("to")) && !params.get("amount")}
          />
        </div>
        {over && <p className="hint" style={{ color: "var(--out)", textAlign: "center", marginTop: -6 }}>That's more than your balance.</p>}

        <div className="field">
          <label htmlFor="note">Note</label>
          <textarea id="note" rows={2} maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's it for? (optional)" />
        </div>
        <div className="rows">
          <div className="rowk">
            <span>Network fee</span>
            <span>$0.00 · gas covered</span>
          </div>
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel="Sending…" disabled={!ready}>
          {isPositiveAmount(amount) ? `Send ${moneyText(amount)}` : "Send"}
        </SubmitButton>
      </form>
    </Screen>
  );
}
