"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { User } from "@/lib/api";
import { useSession } from "@/lib/session";
import { LogoMark } from "./Icons";
import { Avatar } from "./ui";
import { Unlock } from "./Unlock";

/**
 * Page chrome around every screen.
 * Phone: just the screen (signed-in screens carry their own bottom tab bar).
 * Wider screens: a navigation bar on the lime band, which the screen's own band continues below.
 * The signed-out home is the landing page and brings its own navigation.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  const pathname = usePathname();
  if ((status === "out" || status === "loading") && pathname === "/") return <div className="page">{children}</div>;
  return (
    <div className="frame">
      {status !== "loading" && <DeskBar user={status === "in" ? user : null} />}
      <div className="app">{status === "locked" ? <Unlock /> : children}</div>
    </div>
  );
}

function DeskBar({ user }: { user: User | null }) {
  const pathname = usePathname();
  const items = user
    ? [
        { href: "/", label: "Home" },
        { href: "/send", label: "Send" },
        { href: "/request", label: "Request" },
        { href: "/activity", label: "Activity" },
        ...(user.role === "business" ? [{ href: "/store", label: "Store" }] : []),
      ]
    : [];
  return (
    <div className="deskbar">
      <div className="deskbar-in">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <span className="mark">
            <LogoMark size={24} />
          </span>
          AevumPay
        </Link>
        {user ? (
          <>
            <nav className="desk-nav" aria-label="Main">
              {items.map((i) => (
                <Link key={i.href} href={i.href} aria-current={pathname === i.href ? "page" : undefined}>
                  {i.label}
                </Link>
              ))}
            </nav>
            <Link href="/profile" className="desk-user" aria-current={pathname === "/profile" ? "page" : undefined}>
              <Avatar name={user.username} />
              <span>@{user.username}</span>
            </Link>
          </>
        ) : (
          pathname !== "/login" &&
          pathname !== "/signup" && (
            <nav className="desk-nav" aria-label="Account">
              <Link href="/login">Log in</Link>
              <Link href="/signup" aria-current="page">
                Create account
              </Link>
            </nav>
          )
        )}
      </div>
    </div>
  );
}
