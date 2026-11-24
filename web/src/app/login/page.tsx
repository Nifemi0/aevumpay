"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PasswordField } from "@/components/PasswordField";
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
          <div className="signup-head">
            <h1>Welcome back</h1>
            <p>Good to see you. Log in with your @name.</p>
          </div>
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        <div className="field name-field">
          <label htmlFor="username">Your @name</label>
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
        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <ErrorBox>{error}</ErrorBox>
        <details className="forgot">
          <summary>Forgot your password?</summary>
          <p>
            Your password unlocks a wallet only you hold, so nobody (us included) can reset it. If you exported your wallet key from
            Profile, you can still move your money with it. Otherwise, start fresh with a new @name.
          </p>
        </details>
        <div className="grow" />
        <SubmitButton busy={busy} busyLabel="Unlocking your wallet…">
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
