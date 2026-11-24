"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BagIcon, CheckIcon, DropIcon, ExternalIcon } from "@/components/Icons";
import { QrCode } from "@/components/QrCode";
import { Balance, balSize, CopyButton, ErrorBox, Loading, NavRow, Screen, Spinner } from "@/components/ui";
import { AEVUM_CHAIN_ID, api, type GrantStatus } from "@/lib/api";
import { moneyText } from "@/lib/format";
import { useLoad, useRequireUser, useSession } from "@/lib/session";

const QDAY_FAUCET = "https://faucet.qday.info/en";
/** Our demo shop (server/scripts/seed-demo-shop.ts). Its takings refill the welcome dollars. */
const DEMO_SHOP = process.env.NEXT_PUBLIC_DEMO_SHOP || "demobakery";

/**
 * Add money: claim the welcome dollars once, or fill up from the QDay faucet with this wallet's
 * address. The balance refreshes every few seconds, so a faucet claim shows up without reloading.
 */
export default function TopUpPage() {
  const user = useRequireUser();
  const { chainId } = useSession();
  const balance = useLoad(user ? () => api.balance() : null, [user?.id]);
  const grant = useLoad<GrantStatus>(user ? () => api.grantStatus() : null, [user?.id]);
  const demoShop = useLoad(() => api.store(DEMO_SHOP), []);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const last = useRef<string | null>(null);

  // Watch the balance while this screen is open; say so when money arrives.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(async () => {
      try {
        const b = await api.balance();
        if (last.current !== null && Number(b.balance) > Number(last.current)) {
          setLanded(`+${moneyText(String(Number(b.balance) - Number(last.current)))} arrived`);
        }
        last.current = b.balance;
        balance.setData(b);
      } catch {
        /* keep the last number */
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => {
    if (balance.data && last.current === null) last.current = balance.data.balance;
  }, [balance.data]);

  if (!user) return <Loading />;
  const onAevum = chainId === AEVUM_CHAIN_ID;
  const g = grant.data;

  async function claim() {
    setClaiming(true);
    setError(null);
    try {
      const r = await api.claimGrant();
      setLanded(`+${moneyText(r.amount)} welcome dollars arrived`);
      grant.reload();
      const b = await api.balance();
      last.current = b.balance;
      balance.setData(b);
    } catch (e) {
      setError((e as Error).message);
      grant.reload();
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Screen
      band={
        <>
          <NavRow title="Add money" back="/" />
          <div className="balcard">
            <span className="unit">Your balance</span>
            {balance.data ? <Balance amount={balance.data.balance} size={46} /> : <span className="bal" style={balSize(46, { opacity: 0.35 })}>$—</span>}
            <span className="unit">{landed ?? "tUSD8 · test dollars, no real-world value"}</span>
          </div>
        </>
      }
    >
      {g?.enabled && (
        <section className="topup-card" aria-labelledby="welcome-h">
          <span className="topup-step">{g.claimed ? <CheckIcon size={14} /> : "1"}</span>
          <div className="topup-body">
            <h2 id="welcome-h">{g.claimed ? "Welcome dollars claimed" : `Claim ${moneyText(g.amount)} to start`}</h2>
            <p>
              {g.claimed
                ? "They're in your wallet. Need more? Use the faucet below."
                : g.available
                  ? "A one-time gift so you can try a payment right away. Once per account."
                  : g.reason}
            </p>
            {g.claimed && g.explorer && (
              <a className="textlink" href={g.explorer} target="_blank" rel="noreferrer">
                See it on the explorer <ExternalIcon size={13} />
              </a>
            )}
            {!g.claimed && g.available && (
              <button type="button" className="btn" onClick={claim} disabled={claiming}>
                {claiming ? <Spinner /> : <DropIcon size={16} />}
                {claiming ? "Sending… about 2 seconds" : `Claim ${moneyText(g.amount)}`}
              </button>
            )}
          </div>
        </section>
      )}
      <ErrorBox>{error}</ErrorBox>

      <section className="topup-card" aria-labelledby="faucet-h">
        <span className="topup-step">{g?.enabled ? "2" : "1"}</span>
        <div className="topup-body">
          <h2 id="faucet-h">Fill up from the QDay faucet</h2>
          <p>Copy your wallet address, paste it on the faucet page and claim. It lands here in a few seconds.</p>
          <div className="copyfield">
            <span className="v mono">{user.address}</span>
            <CopyButton text={user.address} label="Copy wallet address" />
          </div>
          {onAevum ? (
            <a className="btn ghost" href={QDAY_FAUCET} target="_blank" rel="noreferrer">
              Open the QDay faucet <ExternalIcon size={14} />
            </a>
          ) : (
            <p className="hint">This server is on a development chain, so the QDay faucet won&apos;t reach it.</p>
          )}
        </div>
      </section>

      <details className="topup-more">
        <summary>Show a QR code of my address</summary>
        <QrCode value={user.address} label={`QR code of @${user.username}'s wallet address`} />
      </details>

      {demoShop.data && Number(balance.data?.balance ?? 0) > 0 && (
        <Link href={`/shop/${DEMO_SHOP}`} className="topup-card topup-try">
          <span className="topup-step">
            <BagIcon size={15} />
          </span>
          <span className="topup-body">
            <b>Try a purchase</b>
            <span>Buy a croissant from @{DEMO_SHOP}, our demo shop. ›</span>
          </span>
        </Link>
      )}

      <p className="hint" style={{ textAlign: "center" }}>
        Or ask a friend: share your{" "}
        <Link href="/request" className="textlink">
          payment link
        </Link>
        .
      </p>
    </Screen>
  );
}
