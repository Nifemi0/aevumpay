"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { avatarColor, initials, money } from "@/lib/format";
import { ActivityIcon, BackIcon, CheckIcon, CopyIcon, HomeIcon, LOOP_PATH, StoreIcon, UserIcon } from "./Icons";

/** Inline size for a `.bal` number; wider screens scale it up from this base. */
export function balSize(px: number, extra: CSSProperties = {}): CSSProperties {
  return { ["--bal-size" as string]: `${px}px`, ...extra } as CSSProperties;
}

/** "$248" at full size, ".50" at 55%. The signature number of the app. */
export function Balance({ amount, size = 44 }: { amount: string; size?: number }) {
  const m = money(amount);
  return (
    <span className="bal" style={balSize(size)}>
      {m.dollars}
      <span className="c">{m.cents}</span>
    </span>
  );
}

export function Avatar({ name, size = "" }: { name: string; size?: "" | "lg" | "xl" }) {
  return (
    <span className={`av ${size}`} style={{ background: avatarColor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Avatar + @handle + a secondary line. How a person appears everywhere. */
export function Who({ name, sub, size = "" }: { name: string; sub?: ReactNode; size?: "" | "lg" }) {
  return (
    <div className="who">
      <Avatar name={name} size={size} />
      <div style={{ minWidth: 0 }}>
        <div className="name">{name}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: "ok" | "wait" | "bad" }) {
  const label = status === "ok" ? "Confirmed" : status === "wait" ? "Pending" : "Failed";
  return <span className={`pill ${status}`}>{label}</span>;
}

export function BackButton({ href }: { href?: string }) {
  const router = useRouter();
  if (href) {
    return (
      <Link href={href} className="round" aria-label="Back">
        <BackIcon size={16} />
      </Link>
    );
  }
  return (
    <button type="button" className="round" aria-label="Back" onClick={() => (history.length > 1 ? router.back() : router.push("/"))}>
      <BackIcon size={16} />
    </button>
  );
}

export function NavRow({ title, back }: { title: string; back?: string }) {
  return (
    <div className="nav-row">
      <BackButton href={back} />
      <h1>{title}</h1>
      <span />
    </div>
  );
}

export function TabBar({ business }: { business: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/", label: "Home", icon: <HomeIcon size={20} /> },
    { href: "/activity", label: "Activity", icon: <ActivityIcon size={20} /> },
    ...(business ? [{ href: "/store", label: "Store", icon: <StoreIcon size={20} /> }] : []),
    { href: "/profile", label: "Profile", icon: <UserIcon size={20} /> },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-label={t.label} aria-current={pathname === t.href ? "page" : undefined}>
          {t.icon}
        </Link>
      ))}
    </nav>
  );
}

export function Toast({ text, onDone }: { text: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, [text, onDone]);
  if (!text) return null;
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label, className = "round", children }: { text: string; label: string; className?: string; children?: ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      style={className === "round" ? { background: "var(--lime-wash)", width: 44, height: 44 } : undefined}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
      {children && <span>{done ? "Copied" : children}</span>}
    </button>
  );
}

/**
 * The loading indicator everywhere on the site: the AevumPay loop with a bright stretch travelling
 * around it. `label` is read by screen readers; leave it out when the text next to it says enough.
 */
export function Spinner({ size = 18, label, style }: { size?: number; label?: string; style?: CSSProperties }) {
  return (
    <svg
      className="spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={LOOP_PATH} className="spinner-track" />
      <path d={LOOP_PATH} className="spinner-run" pathLength={100} />
    </svg>
  );
}

/** `caption` shows under the spinner (and is what screen readers and agents read). */
export function Loading({ label = "Loading", caption }: { label?: string; caption?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner size={44} />
      {caption ? <span className="loading-caption">{caption}</span> : <span className="sr-only">{label}</span>}
    </div>
  );
}

/** For screens that need you signed in, while that's being checked. */
export const CheckingSession = () => <Loading caption="Checking your session…" />;

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error" role="alert">
      <span className="error-ic" aria-hidden="true">
        !
      </span>
      <span>{children}</span>
    </p>
  );
}

/** Lime band on top, white sheet sliding over it. Every screen uses this. */
export function Screen({ band, children, bandClass = "", tabs }: { band: ReactNode; children: ReactNode; bandClass?: string; tabs?: { business: boolean } }) {
  return (
    <>
      <div className="screen">
        <header className={`band ${bandClass}`}>{band}</header>
        <main className="sheet">{children}</main>
      </div>
      {tabs && <TabBar business={tabs.business} />}
    </>
  );
}

export function SubmitButton({ busy, busyLabel, children, disabled }: { busy: boolean; busyLabel: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" className="btn" disabled={busy || disabled}>
      {busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
