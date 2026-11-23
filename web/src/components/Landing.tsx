import Link from "next/link";
import { BagIcon, CheckIcon, LogoMark, RequestIcon, SendIcon } from "./Icons";
import { Avatar, Balance } from "./ui";

/**
 * The signed-out home. Shows the product more than it describes it: every section leads with a
 * piece of the real UI (built from the app's own components) and keeps copy to a line or two.
 * All names and amounts on this page are examples.
 */
export function Landing() {
  return (
    <div className="lp">
      <header className="lp-hero">
        <div className="lp-wrap">
          <nav className="lp-nav" aria-label="Main">
            <Link href="/" className="brand" style={{ textDecoration: "none" }}>
              <span className="mark">
                <LogoMark size={20} />
              </span>
              AevumPay
            </Link>
            <div className="lp-nav-links">
              <a href="#how">How it works</a>
              <a href="#business">For business</a>
            </div>
            <div className="lp-nav-cta">
              <Link href="/login" className="lp-login">
                Log in
              </Link>
              <Link href="/signup" className="btn small lp-dark">
                Create account
              </Link>
            </div>
          </nav>

          <div className="lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-chip">Live on QDay Aevum testnet</span>
              <h1>
                Pay anyone
                <br />
                by <span className="lp-at">@</span>username.
              </h1>
              <p className="lp-lede">Digital dollars to a name, not a wallet address. No gas fees.</p>
              <div className="lp-ctas">
                <Link href="/signup" className="btn lp-dark">
                  Claim your @username
                </Link>
                <a href="#how" className="btn ghost lp-ghost">
                  How it works
                </a>
              </div>
            </div>

            <div className="lp-hero-art" aria-hidden="true">
              <PhoneMock />
              <div className="lp-float lp-float-a">
                <span className="lp-float-ic">
                  <CheckIcon size={14} />
                </span>
                <div>
                  <b>Received $40.00</b>
                  <span>from @kemi</span>
                </div>
              </div>
              <div className="lp-float lp-float-b">
                <b>$0.00</b>
                <span>network fee</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* The core idea as a picture: the same payment, addressed two ways. */}
      <section className="lp-section">
        <div className="lp-wrap">
          <div className="lp-compare" aria-label="Paying by address versus by username">
            <div className="lp-compare-old">
              <span className="lp-eyebrow">Other wallets</span>
              <code>0x71C4b8E2a9d3F05c6E1a7b44D2c9e8F3A0b19a02</code>
              <span className="lp-compare-note">42 characters. One typo and it&apos;s gone.</span>
            </div>
            <span className="lp-compare-arrow" aria-hidden="true">
              →
            </span>
            <div className="lp-compare-new">
              <span className="lp-eyebrow">AevumPay</span>
              <span className="lp-handle">
                <Avatar name="kemi" />
                @kemi
              </span>
              <span className="lp-compare-note">The name is checked on-chain before you pay.</span>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="lp-section lp-alt">
        <div className="lp-wrap">
          <h2 className="lp-title">Three steps. About a minute.</h2>
          <ol className="lp-steps">
            <li>
              <div className="lp-vis">
                <div className="field lp-mini-field">
                  <span className="k">Username</span>
                  <span className="v">
                    <span>@ada</span>
                    <span className="pill ok">Available</span>
                  </span>
                </div>
              </div>
              <span className="lp-num">1</span>
              <h3>Claim your @username</h3>
              <p>We create your wallet for you.</p>
            </li>
            <li>
              <div className="lp-vis">
                <div className="lp-mini-bal">
                  <span className="unit">Balance</span>
                  <Balance amount="100.00" size={40} />
                  <span className="pill ok lp-plus">+100 tUSD8</span>
                </div>
              </div>
              <span className="lp-num">2</span>
              <h3>Add test dollars</h3>
              <p>Free from the QDay faucet.</p>
            </li>
            <li>
              <div className="lp-vis">
                <div className="lp-mini-receipt">
                  <span className="lp-mini-check">
                    <CheckIcon size={18} />
                  </span>
                  <div>
                    <b>$40.00 to @kemi</b>
                    <span className="mono">block 1,284,551</span>
                  </div>
                </div>
              </div>
              <span className="lp-num">3</span>
              <h3>Pay, get a receipt</h3>
              <p>Checkable on the explorer.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-wrap">
          <div className="lp-stats">
            <div>
              <span className="lp-stat">$0.00</span>
              <span className="lp-stat-label">gas for you, on every payment</span>
            </div>
            <div>
              <span className="lp-stat">0</span>
              <span className="lp-stat-label">admin keys on the contract</span>
            </div>
            <div>
              <span className="lp-stat">1</span>
              <span className="lp-stat-label">on-chain receipt per payment</span>
            </div>
          </div>
          <div className="lp-pills">
            <span>
              <SendIcon size={15} /> Send by name
            </span>
            <span>
              <RequestIcon size={15} /> Request with a QR
            </span>
            <span>
              <BagIcon size={15} /> Sell with a link
            </span>
            <span>
              <CheckIcon size={15} /> Never holds your money
            </span>
          </div>
        </div>
      </section>

      <section id="business" className="lp-section lp-alt">
        <div className="lp-wrap lp-split">
          <div className="lp-split-copy">
            <span className="lp-eyebrow">For business</span>
            <h2>Sell with a link.</h2>
            <p>Add a product, share its checkout page, get paid straight to your wallet.</p>
            <Link href="/signup" className="btn lp-dark lp-cta-inline">
              Open a store
            </Link>
          </div>
          <div className="lp-checkout" aria-hidden="true">
            <div className="lp-checkout-top">
              <div className="who">
                <Avatar name="Bola's Bakery" />
                <div>
                  <div className="name">Bola&apos;s Bakery</div>
                  <div className="sub">@bolabakes</div>
                </div>
              </div>
              <span className="lp-co-title">Sourdough loaf</span>
              <Balance amount="12.50" size={40} />
            </div>
            <div className="lp-checkout-body">
              <div className="rowk">
                <span>Paying as</span>
                <span>@ada</span>
              </div>
              <div className="rowk">
                <span>Network fee</span>
                <span>$0.00</span>
              </div>
              <span className="btn">Pay $12.50</span>
            </div>
            <span className="lp-example">Example</span>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap">
          <h2>Your @username is waiting.</h2>
          <div className="lp-ctas" style={{ justifyContent: "center" }}>
            <Link href="/signup" className="btn lp-dark">
              Create account
            </Link>
            <Link href="/login" className="btn ghost lp-ghost">
              Log in
            </Link>
          </div>
          <p className="lp-fine">Testnet only. tUSD8 has no real-world value.</p>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <span>AevumPay · Aevum Builder Challenge #1</span>
          <span>QDay Aevum testnet · chain 44005</span>
        </div>
      </footer>
    </div>
  );
}

/** A static picture of the home screen, using the app's own components and example data. */
function PhoneMock() {
  return (
    <div className="lp-phone">
      <div className="lp-phone-band">
        <div className="who">
          <Avatar name="ada" />
          <div>
            <div className="name" style={{ fontSize: 14 }}>
              Hi, @ada
            </div>
            <div className="sub">Personal account</div>
          </div>
        </div>
        <div className="balcard">
          <span className="unit">Balance</span>
          <Balance amount="248.50" size={38} />
          <span className="unit">tUSD8</span>
        </div>
        <div className="actionbar">
          <span className="lp-act">
            <span className="ic">
              <SendIcon size={15} />
            </span>
            Send
          </span>
          <span className="lp-act">
            <span className="ic">
              <RequestIcon size={15} />
            </span>
            Request
          </span>
          <span className="lp-act">
            <span className="ic">
              <BagIcon size={15} />
            </span>
            Store
          </span>
        </div>
      </div>
      <div className="lp-phone-sheet">
        <b style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>Activity</b>
        <MockRow name="@kemi" sub="Received" amt="+$40.00" dir="in" />
        <MockRow name="@bolabakes" sub="Store purchase" amt="−$12.50" dir="out" />
        <MockRow name="@tunde" sub="Sent" amt="−$25.00" dir="out" />
      </div>
    </div>
  );
}

function MockRow({ name, sub, amt, dir }: { name: string; sub: string; amt: string; dir: "in" | "out" }) {
  return (
    <div className="txrow" style={{ padding: "6px 0", margin: 0 }}>
      <Avatar name={name} />
      <div style={{ minWidth: 0 }}>
        <div className="t" style={{ fontSize: 13 }}>
          {name}
        </div>
        <div className="s" style={{ fontSize: 11 }}>
          {sub}
        </div>
      </div>
      <span className={`amt ${dir}`} style={{ fontSize: 13 }}>
        {amt}
      </span>
    </div>
  );
}
