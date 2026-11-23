"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { KeyIcon } from "@/components/Icons";
import { BackButton, ErrorBox, Screen, SubmitButton } from "@/components/ui";
import { ApiError, api, type Role } from "@/lib/api";
import { normUsername } from "@/lib/format";
import { safeNext, useSession } from "@/lib/session";
import { useNextParam } from "@/lib/useNextParam";

type Check = "idle" | "short" | "checking" | "free" | "taken" | "error";

export default function SignupPage() {
  return (
    <Suspense>
      <Signup />
    </Suspense>
  );
}

function Signup() {
  const { register, status } = useSession();
  const router = useRouter();
  const next = useNextParam();
  const [role, setRole] = useState<Role>("personal");
  const [raw, setRaw] = useState("");
  const [password, setPassword] = useState("");
  const [check, setCheck] = useState<Check>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const username = normUsername(raw);

  // Already signed in when arriving here: move on. (Skipped while submitting; onSubmit routes itself.)
  useEffect(() => {
    if (status === "in" && !busy) router.replace(safeNext(next));
  }, [status, busy, router, next]);

  // Live availability check against the on-chain registry (404 = nobody has it).
  useEffect(() => {
    if (!username) return setCheck("idle");
    if (username.length < 3) return setCheck("short");
    setCheck("checking");
    const t = setTimeout(() => {
      api
        .user(username)
        .then(() => setCheck("taken"))
        .catch((e) => setCheck(e instanceof ApiError && e.status === 404 ? "free" : "error"));
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Use a password of at least 6 characters.");
    setBusy(true);
    try {
      await register(username, role, password);
      router.replace(role === "business" && !next ? "/store" : safeNext(next));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const pill =
    check === "free" ? (
      <span className="pill ok">Available</span>
    ) : check === "taken" ? (
      <span className="pill bad">Taken</span>
    ) : check === "checking" ? (
      <span className="spinner" style={{ width: 14, height: 14, color: "var(--ink-3)" }} aria-label="Checking" />
    ) : null;

  return (
    <Screen
      band={
        <>
          <div className="nav-row">
            <BackButton href="/" />
            <span />
            <span />
          </div>
          <div style={{ display: "grid", gap: 8, paddingBottom: 8 }}>
            <h1 style={{ fontSize: 30, fontWeight: 600 }}>Claim your @username</h1>
            <p style={{ opacity: 0.85 }}>This is how people pay you. No wallet address needed.</p>
          </div>
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        <div className="seg" role="group" aria-label="Account type">
          <button type="button" aria-pressed={role === "personal"} onClick={() => setRole("personal")}>
            Personal
          </button>
          <button type="button" aria-pressed={role === "business"} onClick={() => setRole("business")}>
            Business
          </button>
        </div>
        <p className="hint" style={{ marginTop: -6, paddingInline: 4 }}>
          {role === "business" ? "Open a store, add products and share checkout links." : "Send and request money from friends."}
        </p>

        <div className="field">
          <label htmlFor="username">Username</label>
          <div className="row">
            <span className="prefix">@</span>
            <input
              id="username"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24}
              placeholder="yourname"
              required
            />
            {pill}
          </div>
        </div>
        <p className="hint" style={{ marginTop: -6, paddingInline: 4 }}>
          {check === "taken"
            ? `@${username} is taken. Try another.`
            : check === "short"
              ? "At least 3 characters."
              : check === "error"
                ? "Couldn't check right now. You can still try."
                : "3–24 characters: lowercase letters, numbers, dots and underscores."}
        </p>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            placeholder="At least 6 characters"
            required
          />
        </div>

        <div className="field" style={{ gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center" }}>
          <span style={{ color: "var(--ink-2)" }}>
            <KeyIcon size={18} />
          </span>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            Your wallet is created in this browser and locked with your password. We never see the key, so we can't reset a forgotten password. Export the key from Profile to back it up.
          </span>
        </div>

        <ErrorBox>{error}</ErrorBox>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel="Creating your wallet…" disabled={check === "taken" || check === "short" || !username}>
          Create account
        </SubmitButton>
        <p className="hint" style={{ textAlign: "center" }}>
          Already have an account?{" "}
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="textlink" style={{ color: "var(--ink)" }}>
            Log in
          </Link>
        </p>
      </form>
    </Screen>
  );
}
