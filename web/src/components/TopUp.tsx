"use client";

import Link from "next/link";
import { useState } from "react";
import { AEVUM_CHAIN_ID, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { DropIcon, PlusIcon } from "./Icons";
import { ErrorBox, Spinner } from "./ui";

/**
 * The "add money" prompt on the home screen. It opens the Add money screen (welcome dollars, QDay
 * faucet, address). On a local development chain it also offers a one-tap mint, which the testnet
 * server refuses and production builds don't show.
 */
export function TopUp({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const { chainId } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chainId === null) return null;
  const devMint = chainId !== AEVUM_CHAIN_ID && process.env.NODE_ENV !== "production";

  return (
    <div style={{ display: "grid", gap: 8, width: "100%" }}>
      <Link href="/topup" className={compact ? "linkbtn" : "btn"}>
        <PlusIcon size={16} />
        Add money
      </Link>
      {devMint && (
        <button
          type="button"
          className="linkbtn"
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
          {busy ? <Spinner /> : <DropIcon size={15} />}
          {busy ? "Adding…" : "Dev chain: mint 100 test tUSD8"}
        </button>
      )}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}
