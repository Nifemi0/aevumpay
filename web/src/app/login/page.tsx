"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BackButton, ErrorBox, Screen, SubmitButton } from "@/components/ui";
import { normUsername } from "@/lib/format";
import { safeNext, useSession } from "@/lib/session";
import { useNextParam } from "@/lib/useNextParam";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const { login, status } = useSession();
  const router = useRouter();
  const next = useNextParam();
  const [raw, setRaw] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "in" && !busy) router.replace(safeNext(next));
  }, [status, busy, router, next]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(normUsername(raw), password);
      router.replace(safeNext(next));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

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
            <h1 style={{ fontSize: 30, fontWeight: 600 }}>Welcome back</h1>
            <p style={{ opacity: 0.85 }}>Log in with your @username.</p>
          </div>
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
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
              placeholder="yourname"
              required
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel="Logging in…">
          Log in
        </SubmitButton>
        <p className="hint" style={{ textAlign: "center" }}>
          New to AevumPay?{" "}
          <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="textlink" style={{ color: "var(--ink)" }}>
            Create an account
          </Link>
        </p>
      </form>
    </Screen>
  );
}
