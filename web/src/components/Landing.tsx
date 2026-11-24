"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BagIcon, CheckIcon, ExternalIcon, KeyIcon, LogoMark, RequestIcon, SendIcon } from "./Icons";
import { Avatar, Balance } from "./ui";

/**
 * The signed-out home: one day in the life of Ada, a baker, told in seven scenes.
 * It should look like a sequence of posters, not an article: every scene is a short headline,
 * one line, and the real app on a phone with the key fact floating beside it.
 *   Desktop: full-height scenes that alternate lime and light.
 *   Phone/tablet: the scenes become a swipeable row of cards.
 *
 * Ada, Kemi and the amounts are a story. The receipt in the last scene is a real payment on
 * Aevum testnet.
 */

const REAL_TX = "0xf6f41958075d3f5a9093929569ddcb5798762e2e8c1f013f75a53736bcc5049b";
const EXPLORER = `https://explorer-test.qday.info/tx/${REAL_TX}`;

/** A fact pinned beside the phone. `at` places it around the phone (desktop only). */
interface Chip {
  text: ReactNode;
  tone?: "good" | "bad" | "dark";
  at: "tl" | "tr" | "ml" | "mr" | "bl" | "br";
}

interface Scene {
  kicker: string;
  title: ReactNode;
  line: ReactNode;
  chips: Chip[];
  screen: () => ReactNode;
}

const SCENES: Scene[] = [
  {
    kicker: "6:40 am",
    title: "Meet Ada.",
    line: "Her customers want to pay her. Her wallet wants a 42-character address, typed perfectly.",
    chips: [
      { text: "0x71C4…9a02 ?", tone: "dark", at: "tl" },
      { text: "One typo. Gone.", tone: "bad", at: "mr" },
    ],
    screen: () => <ScreenAddress />,
  },
  {
    kicker: "6:45 am",
    title: (
      <>
        She claimed a <span className="st-hl">name</span>.
      </>
    ),
    line: "@ada, in under a minute. Her wallet lives in her browser.",
    chips: [
      { text: <>@ada ✓</>, tone: "good", at: "tr" },
      { text: "Key never leaves her device", at: "bl" },
    ],
    screen: () => <ScreenClaim />,
  },
  {
    kicker: "8:12 am",
    title: "Paid like a text.",
    line: "Kemi typed @ada, $12, send.",
    chips: [
      { text: "+$12.00 from @kemi", tone: "good", at: "tl" },
      { text: "$0.00 gas", at: "mr" },
      { text: "Settled in ~1s", tone: "dark", at: "bl" },
    ],
    screen: () => <ScreenReceived />,
  },
  {
    kicker: "11:30 am",
    title: "Her shop, in a link.",
    line: "One link per loaf, paid straight to her wallet.",
    chips: [
      { text: "aevumpay/shop/ada", tone: "dark", at: "tr" },
      { text: "0.5% fee, not 2.9%", at: "ml" },
    ],
    screen: () => <ScreenCheckout />,
  },
  {
    kicker: "Every Friday",
    title: "Regulars subscribe.",
    line: "The Bread Club collects itself. Never twice, never for missed weeks.",
    chips: [
      { text: "$8 / week", tone: "good", at: "tl" },
      { text: "Cancel in one tap", at: "br" },
    ],
    screen: () => <ScreenSubscription />,
  },
  {
    kicker: "Sunday night",
    title: (
      <>
        Her AI gets a <span className="st-hl">budget</span>.
      </>
    ),
    line: "Not her keys. $20 a week, $5 max per order.",
    chips: [
      { text: "✕ $30 order refused", tone: "bad", at: "tr" },
      { text: "Limits live in the contract", tone: "dark", at: "ml" },
      { text: "Revoke anytime", at: "br" },
    ],
    screen: () => <ScreenAgent />,
  },
  {
    kicker: "Always",
    title: "Only she can move it.",
    line: "No owner, no back door. Every payment is a public receipt.",
    chips: [
      { text: "Her key, her device", tone: "dark", at: "tl" },
      {
        text: (
          <a href={EXPLORER} target="_blank" rel="noreferrer">
            Real receipt on Aevum <ExternalIcon size={13} />
          </a>
        ),
        tone: "good",
        at: "mr",
      },
    ],
    screen: () => <ScreenReceipt />,
  },
];

const CONTRACT_URL = "https://explorer-test.qday.info/address/0xAA36d954e8930FFe29078bDF67975534A31895F7";

export function Landing() {
  const [claim, setClaim] = useState("");
  const router = useRouter();
  const claimName = claim.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_.]/g, "");

  return (
    <div className="st">
      {/* ---------------- opening ---------------- */}
      <header className="st-hero">
        <div className="st-wrap">
          <nav className="st-nav" aria-label="Main">
            <Link href="/" className="st-brand">
              <span className="st-mark">
                <LogoMark size={26} />
              </span>
              AevumPay
            </Link>
            <div className="st-nav-cta">
              <Link href="/login" className="st-login">
                Log in
              </Link>
              <Link href="/signup" className="st-btn st-btn-dark st-btn-sm">
                Get your @name
              </Link>
            </div>
          </nav>

          <div className="st-hero-grid">
            <div className="st-hero-body">
              <h1>
                Pay anyone
                <br />
                by <span className="st-at">@</span>name.
              </h1>
              <p className="st-lede">No 0x addresses. No gas. Just names, digital dollars and a receipt for everything.</p>

              {/* Phones: what a payment looks like. */}
              <div className="st-send" aria-hidden="true">
                <div className="st-send-to">
                  <span className="st-send-label">To</span>
                  <Avatar name="kemi" />
                  <b>@kemi</b>
                  <span className="st-send-ok">
                    <CheckIcon size={12} />
                  </span>
                </div>
                <div className="st-send-amt">
                  <Balance amount="12.00" size={48} />
                  <span>2 loaves</span>
                </div>
                <div className="st-send-status">Sent in ~1s · $0.00 gas</div>
              </div>

              <div className="st-ctas">
                <Link href="/signup" className="st-btn st-btn-dark st-btn-wide">
                  Claim your @name
                </Link>
                <a href="#story" className="st-btn st-btn-ghost st-desktop-only">
                  See how it works ↓
                </a>
              </div>
            </div>
            <div className="st-stage st-hero-stage" aria-hidden="true">
              <div className="st-blob" />
              <Phone>
                <ScreenReceived />
              </Phone>
              {/* All on the right: the headline fills the left side. */}
              <ChipEl chip={{ text: "+$12.00 from @kemi", tone: "good", at: "tr" }} />
              <ChipEl chip={{ text: "$0.00 gas", at: "mr" }} />
              <ChipEl chip={{ text: "No 0x… anywhere", tone: "dark", at: "br" }} />
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- desktop: full-height scenes ---------------- */}
      <div id="story" className="st-scenes">
        {SCENES.map((s, i) => (
          <section key={i} className={`st-scene ${i % 2 === 0 ? "st-scene-light" : "st-scene-lime"}`} aria-label={`Scene ${i + 1}`}>
            <div className="st-wrap st-scene-grid">
              <div className="st-scene-text">
                <span className="st-kicker">
                  <b>{String(i + 1).padStart(2, "0")}</b> {s.kicker}
                </span>
                <h2>{s.title}</h2>
                <p>{s.line}</p>
              </div>
              <div className="st-stage" aria-hidden={i === 6 ? undefined : true}>
                <div className="st-blob" />
                <Phone>{s.screen()}</Phone>
                {s.chips.map((c, k) => (
                  <ChipEl key={k} chip={c} />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* ---------------- phones + tablets: four bold tiles, straight down ---------------- */}
      <section className="st-tiles" aria-label="What you can do with AevumPay">
        <div className="st-wrap st-tiles-grid">
          <article className="st-tile st-tile-light">
            <span className="st-tile-kicker">Send</span>
            <h2>Send to a name.</h2>
            <div className="st-tv st-tv-send" aria-hidden="true">
              <div className="st-tv-row">
                <Avatar name="kemi" />
                <b>@kemi</b>
                <span className="pill ok">Verified</span>
              </div>
              <Balance amount="12.00" size={44} />
              <span className="st-tv-status">Sent in ~1s · $0.00 gas</span>
            </div>
            <p>Type their @name and an amount. That&apos;s it.</p>
          </article>

          <article className="st-tile st-tile-dark">
            <span className="st-tile-kicker">Sell</span>
            <h2>Sell with a link.</h2>
            <div className="st-tv st-tv-shop" aria-hidden="true">
              <span className="st-tv-link">aevumpay.app/shop/ada</span>
              <div className="st-tv-product">
                <span className="st-tv-img">
                  <BagIcon size={18} />
                </span>
                <div>
                  <b>Sourdough loaf</b>
                  <span>@ada</span>
                </div>
                <Balance amount="6.00" size={24} />
              </div>
              <span className="st-stamp">PAID ✓</span>
            </div>
            <p>Customers pay straight into your wallet. 0.5% per sale.</p>
          </article>

          <article className="st-tile st-tile-lime">
            <span className="st-tile-kicker">Automate</span>
            <h2>Bills that run themselves.</h2>
            <div className="st-tv st-tv-auto" aria-hidden="true">
              <div className="st-tv-sub">
                <div>
                  <b>Bread Club</b>
                  <span>$8.00 every week</span>
                </div>
                <span className="pill ok">Active</span>
              </div>
              <div className="st-tv-sub">
                <div>
                  <b>AI assistant</b>
                  <span>$14 of $20 this week</span>
                </div>
                <span className="st-tv-meter">
                  <i style={{ width: "70%" }} />
                </span>
              </div>
              <span className="st-tv-refused">✕ $30 order refused by the contract</span>
            </div>
            <p>Subscriptions and AI budgets, with hard limits you control.</p>
          </article>

          <article className="st-tile st-tile-light">
            <span className="st-tile-kicker">Own it</span>
            <h2>Only you hold the key.</h2>
            <div className="st-tv st-tv-key">
              <span className="st-tv-keyicon" aria-hidden="true">
                <KeyIcon size={30} />
              </span>
              <a className="st-tv-receipt" href={EXPLORER} target="_blank" rel="noreferrer">
                <span>Receipt #1 · Block 3,947,023</span>
                <b>
                  Check it on Aevum <ExternalIcon size={13} />
                </b>
              </a>
            </div>
            <p>Your key lives on your device. Every payment is a public receipt.</p>
          </article>
        </div>
      </section>

      {/* ---------------- the ending: claim a name ---------------- */}
      <section className="st-claim" id="claim">
        <div className="st-wrap st-claim-inner">
          <h2>
            Your <span>@name</span> is waiting.
          </h2>
          <p>Free to claim. Ready in a minute.</p>
          <form
            className="st-claim-form"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(claimName ? `/signup?username=${encodeURIComponent(claimName)}` : "/signup");
            }}
          >
            <label htmlFor="claim-name" className="sr-only">
              Your username
            </label>
            <span className="st-claim-at">@</span>
            <input
              id="claim-name"
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              placeholder="yourname"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
            />
            <button type="submit" className="st-btn st-btn-lime">
              Claim it
            </button>
          </form>
          <Link href="/signup" className="st-claim-shop">
            Running a business? Open a shop →
          </Link>
          <ul className="st-facts">
            <li>
              <b>$0.00</b> gas
            </li>
            <li>
              <b>0.5%</b> for shops
            </li>
            <li>
              <b>$0</b> between people
            </li>
          </ul>
        </div>
      </section>

      <footer className="st-footer">
        <div className="st-wrap st-footer-grid">
          <div className="st-footer-brand">
            <Link href="/" className="st-brand">
              <span className="st-mark st-mark-lime">
                <LogoMark size={26} />
              </span>
              AevumPay
            </Link>
            <p>Payments by @name, on QDay Aevum.</p>
          </div>
          <nav aria-label="Product">
            <b>Product</b>
            <a href="#story">How it works</a>
            <Link href="/signup">Open a shop</Link>
            <Link href="/signup">Subscriptions</Link>
          </nav>
          <nav aria-label="Account">
            <b>Account</b>
            <Link href="/signup">Create account</Link>
            <Link href="/login">Log in</Link>
          </nav>
          <nav aria-label="Proof">
            <b>On-chain</b>
            <a href={CONTRACT_URL} target="_blank" rel="noreferrer">
              Contract ↗
            </a>
            <a href={EXPLORER} target="_blank" rel="noreferrer">
              A real receipt ↗
            </a>
          </nav>
        </div>
        <div className="st-wrap st-footer-fine">
          <span>Aevum Builder Challenge #1</span>
          <span>Testnet only. Test dollars have no real-world value.</span>
        </div>
      </footer>
    </div>
  );
}

function ChipEl({ chip }: { chip: Chip }) {
  return <span className={`st-chip st-chip-${chip.at} ${chip.tone ? `st-chip-${chip.tone}` : ""}`}>{chip.text}</span>;
}

// ---------------- the phone and its screens (the app's own components, example data) ----------------

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="st-phone">
      <div className="st-phone-screen">{children}</div>
    </div>
  );
}

function Top({ children }: { children: ReactNode }) {
  return <div className="st-top">{children}</div>;
}

function Sheet({ children }: { children: ReactNode }) {
  return <div className="st-sheet">{children}</div>;
}

function ScreenAddress() {
  return (
    <>
      <Top>
        <span className="st-screen-title">Send</span>
        <div className="st-big-q">Who are you paying?</div>
      </Top>
      <Sheet>
        <div className="field st-warn-field">
          <span className="k">Recipient address</span>
          <span className="st-addr">0x71C4b8E2a9d3F05c6E1a7b44D2c9e8F3A0b19a02</span>
        </div>
        <p className="st-warn">One wrong character and the money is gone for good.</p>
        <div className="rows">
          <div className="rowk">
            <span>Network fee</span>
            <span>0.0012 ETH</span>
          </div>
        </div>
        <span className="btn st-btn-disabled">Send</span>
      </Sheet>
    </>
  );
}

function ScreenClaim() {
  return (
    <>
      <Top>
        <span className="st-screen-title">Welcome</span>
        <div className="st-big-q">Claim your @username</div>
      </Top>
      <Sheet>
        <div className="seg st-seg">
          <span>Personal</span>
          <span className="on">Business</span>
        </div>
        <div className="field">
          <span className="k">Username</span>
          <span className="st-field-row">
            <b>@ada</b>
            <span className="pill ok">Available</span>
          </span>
        </div>
        <div className="field st-note">
          <KeyIcon size={16} />
          <span>Your wallet is created in this browser.</span>
        </div>
        <span className="btn">Create account</span>
      </Sheet>
    </>
  );
}

function ScreenReceived() {
  return (
    <>
      <Top>
        <div className="who">
          <Avatar name="ada" />
          <div>
            <div className="name">Hi, @ada</div>
            <div className="sub">Business account</div>
          </div>
        </div>
        <div className="balcard">
          <span className="unit">Balance</span>
          <Balance amount="12.00" size={34} />
          <span className="unit">tUSD8</span>
        </div>
        <div className="st-actions">
          <span>
            <i>
              <SendIcon size={13} />
            </i>
            Send
          </span>
          <span>
            <i>
              <RequestIcon size={13} />
            </i>
            Request
          </span>
          <span>
            <i>
              <BagIcon size={13} />
            </i>
            Store
          </span>
        </div>
      </Top>
      <Sheet>
        <div className="st-toast">
          <span className="st-toast-ic">
            <CheckIcon size={13} />
          </span>
          <div>
            <b>Received $12.00</b>
            <span>from @kemi · just now</span>
          </div>
        </div>
        <Row name="@kemi" sub="Received · 2 loaves" amt="+$12.00" dir="in" />
        <Row name="@tunde" sub="Received · Croissants" amt="+$6.50" dir="in" />
      </Sheet>
    </>
  );
}

function ScreenCheckout() {
  return (
    <>
      <Top>
        <div className="who">
          <Avatar name="Ada's Bakery" />
          <div>
            <div className="name">Ada&apos;s Bakery</div>
            <div className="sub">@ada</div>
          </div>
        </div>
        <span className="st-product">Sourdough loaf</span>
        <Balance amount="6.00" size={34} />
      </Top>
      <Sheet>
        <div className="rows">
          <div className="rowk">
            <span>Paying as</span>
            <span>@kemi</span>
          </div>
          <div className="rowk">
            <span>Network fee</span>
            <span>$0.00</span>
          </div>
          <div className="rowk">
            <span>Ada receives</span>
            <span>$5.97</span>
          </div>
        </div>
        <span className="btn">Pay $6.00</span>
      </Sheet>
    </>
  );
}

function ScreenSubscription() {
  return (
    <>
      <Top>
        <span className="st-screen-title">Subscriptions</span>
        <div className="st-big-q">The Bread Club</div>
        <span className="st-sub-price">$8.00 every week</span>
      </Top>
      <Sheet>
        <div className="st-sub-card">
          <div className="st-sub-head">
            <b>@kemi</b>
            <span className="pill ok">Active</span>
          </div>
          <div className="rows">
            <div className="rowk">
              <span>Next charge</span>
              <span>Fri, 7:00 am</span>
            </div>
            <div className="rowk">
              <span>Paid so far</span>
              <span>12 weeks</span>
            </div>
          </div>
        </div>
        <div className="st-sub-card st-sub-muted">
          <div className="st-sub-head">
            <b>@tunde</b>
            <span className="pill wait">Payment due</span>
          </div>
          <p>Retried for a few days, never charged twice.</p>
        </div>
      </Sheet>
    </>
  );
}

function ScreenAgent() {
  return (
    <>
      <Top>
        <span className="st-screen-title">Spending permissions</span>
        <div className="balcard">
          <span className="unit">Kitchen assistant</span>
          <span className="bal" style={{ ["--bal-size" as string]: "28px" }}>
            $14<span className="c">.00</span>
          </span>
          <span className="unit">of $20 this week</span>
        </div>
      </Top>
      <Sheet>
        <div className="st-meter">
          <span style={{ width: "70%" }} />
        </div>
        <Row name="@millersupply" sub="Flour, 10 kg · by agent" amt="−$5.00" dir="out" />
        <div className="st-refused">
          <b>✕ $30.00 order refused</b>
          <span>Over the $5 per-payment limit. Stopped by the contract.</span>
        </div>
        <span className="btn ghost">Revoke now</span>
      </Sheet>
    </>
  );
}

function ScreenReceipt() {
  return (
    <>
      <Top>
        <span className="check st-check">
          <CheckIcon size={22} />
        </span>
        <div className="st-receipt-amt">
          <span>Sent to @aevumcafe</span>
          <Balance amount="0.50" size={32} />
        </div>
      </Top>
      <Sheet>
        <div className="st-sub-head">
          <b>Receipt #1</b>
          <span className="pill ok">Confirmed</span>
        </div>
        <div className="rows">
          <div className="rowk">
            <span>Network</span>
            <span>Aevum testnet</span>
          </div>
          <div className="rowk">
            <span>Block</span>
            <span className="mono">3,947,023</span>
          </div>
          <div className="rowk">
            <span>Tx</span>
            <span className="mono">0xf6f4…049b</span>
          </div>
          <div className="rowk">
            <span>Network fee</span>
            <span>$0.00</span>
          </div>
        </div>
        <span className="btn ghost">View on explorer</span>
      </Sheet>
    </>
  );
}

function Row({ name, sub, amt, dir }: { name: string; sub: string; amt: string; dir: "in" | "out" }) {
  return (
    <div className="txrow st-row">
      <Avatar name={name} />
      <div style={{ minWidth: 0 }}>
        <div className="t">{name}</div>
        <div className="s">{sub}</div>
      </div>
      <span className={`amt ${dir}`}>{amt}</span>
    </div>
  );
}
