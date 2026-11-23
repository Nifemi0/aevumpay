"use client";

import { useState } from "react";
import { AEVUM_CHAIN_ID, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { DropIcon, ExternalIcon } from "./Icons";
import { ErrorBox } from "./ui";

const QDAY_FAUCET = "https://faucet.qday.info/en";

/** How to get test tUSD8: a one-tap mint on a local chain, the QDay faucet on Aevum testnet. */
export function TopUp({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const { chainId } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chainId === null) return null;

  if (chainId === AEVUM_CHAIN_ID) {
    return (
      <a className={compact ? "linkbtn" : "btn ghost"} href={QDAY_FAUCET} target="_blank" rel="noreferrer">
        Get test tUSD8 from the QDay faucet <ExternalIcon size={14} />
      </a>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, width: "100%" }}>
      <button
        type="button"
        className={compact ? "linkbtn" : "btn ghost"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.faucet("100");
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : <DropIcon size={15} />}
        {busy ? "Adding…" : "Add 100 test tUSD8"}
      </button>
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}
