"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BackIcon, CheckIcon, KeyIcon, StoreIcon, UserIcon } from "@/components/Icons";
import { PasswordField } from "@/components/PasswordField";
import { Avatar, BackButton, ErrorBox, Screen, Spinner, SubmitButton } from "@/components/ui";
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

/**
 * Two short steps instead of one long form:
 *   1. pick your @name (checked live) and who it's for;
 *   2. set a password, with one plain sentence about why it matters.
 * New personal accounts land on Add money, where the welcome dollars wait.
 */
function Signup() {
  const { register, status } = useSession();
  const router = useRouter();
  const next = useNextParam();
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<Role>("personal");
  const [raw, setRaw] = useState("");
  const [password, setPassword] = useState("");
  const [check, setCheck] = useState<Check>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const username = normUsername(raw);
  // Checked on every render, not only by the live lookup, so a too-short or too-long name can never
  // reach the contract (which refuses it, and the error would surface only after signing).
  const nameProblem = !username ? "empty" : username.length < 3 ? "short" : username.length > 24 ? "long" : null;

  // The landing page's "Claim it" box sends people here as /signup?username=ada. Read it after the
  // first render: reading it during render makes the server and browser HTML differ, and React then
  // leaves the server's disabled="" on the button.
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("username");
    if (u) setRaw(u);
  }, []);

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
    if (step === 1) {
      if (check === "taken" || nameProblem) return;
      return setStep(2);
    }
    if (nameProblem) {
      setStep(1);
      return setError(nameProblem === "long" ? "Your @name can be at most 24 characters." : "Your @name needs at least 3 characters.");
    }
    if (password.length < 6) return setError("Your password needs at least 6 characters.");
    setBusy(true);
    try {
      await register(username, role, password);
      router.replace(next ? safeNext(next) : role === "business" ? "/store" : "/topup");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      // A problem with the name is fixed on the first step, so take them back there.
      const reason = err instanceof ApiError ? err.reason : undefined;
      if (reason === "UsernameTaken" || reason === "UsernameTooShort" || reason === "UsernameTooLong") {
        setStep(1);
        if (reason === "UsernameTaken") setCheck("taken");
      }
    }
  }

  const hint =
    check === "taken"
      ? `@${username} is taken. Try another.`
      : nameProblem === "long"
        ? "That's too long: at most 24 characters."
        : check === "short" || nameProblem === "short"
        ? "A little longer: at least 3 characters."
        : check === "free"
          ? `Nice, @${username} is yours if you want it.`
          : check === "error"
            ? "Couldn't check right now. You can still try."
            : "Letters, numbers, dots and underscores.";

  return (
    <Screen
      band={
        <>
          <div className="nav-row">
            {step === 2 ? (
              <button type="button" className="round" aria-label="Back to your @name" onClick={() => setStep(1)}>
                <BackIcon size={16} />
              </button>
            ) : (
              <BackButton href="/" />
            )}
            <span className="steps" aria-label={`Step ${step} of 2`}>
              <i className="on" />
              <i className={step === 2 ? "on" : ""} />
            </span>
            <span />
          </div>
          {step === 1 ? (
            <div className="signup-head">
              <h1>Pick your @name</h1>
              <p>It&apos;s how people pay you. No long wallet address to share.</p>
            </div>
          ) : (
            <div className="signup-head">
              <div className="signup-me">
                <Avatar name={username} size="lg" />
                <b>@{username}</b>
              </div>
              <h1>Lock it with a password</h1>
            </div>
          )}
        </>
      }
    >
      <form onSubmit={onSubmit} style={{ display: "contents" }}>
        {step === 1 ? (
          <>
            <div className={`field name-field ${check === "free" ? "is-free" : check === "taken" ? "is-taken" : ""}`}>
              <label htmlFor="username">Your @name</label>
              <div className="row">
                <span className="prefix">@</span>
                <input
                  id="username"
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value);
                    setError(null);
                  }}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={24}
                  placeholder="yourname"
                  required
                />
                {check === "free" ? (
                  <span className="name-ok" aria-label="Available">
                    <CheckIcon size={14} />
                  </span>
                ) : check === "checking" ? (
                  <Spinner size={16} label="Checking" style={{ color: "var(--ink-3)" }} />
                ) : null}
              </div>
            </div>
            <p className={`hint ${check === "taken" ? "hint-bad" : ""}`} style={{ marginTop: -6, paddingInline: 4 }} aria-live="polite">
              {hint}
            </p>

            <fieldset className="who-pick">
              <legend>Who&apos;s it for?</legend>
              <button type="button" aria-pressed={role === "personal"} onClick={() => setRole("personal")}>
                <UserIcon size={18} />
                <b>Just me</b>
                <span>Send and receive money</span>
              </button>
              <button type="button" aria-pressed={role === "business"} onClick={() => setRole("business")}>
                <StoreIcon size={18} />
                <b>My business</b>
                <span>Sell with a shop link</span>
              </button>
            </fieldset>

            <ErrorBox>{error}</ErrorBox>
            <div className="grow" />
            <button type="submit" className="btn" disabled={check === "taken" || nameProblem !== null}>
              Continue
            </button>
          </>
        ) : (
          <>
            <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 6 characters" autoFocus />
            <div className="keynote">
              <span className="keynote-ic">
                <KeyIcon size={16} />
              </span>
              <p>
                Your wallet is made right here on this device and locked with this password. Keep it somewhere safe: we never see it, so we
                can&apos;t reset it for you.
              </p>
            </div>
            <p className="hint" style={{ textAlign: "center", paddingInline: 6 }}>
              Your account starts at $0. Next you can claim free test dollars (while they last), or anyone can pay you at your @name.
            </p>
            <ErrorBox>{error}</ErrorBox>
            <div className="grow" />
            <SubmitButton busy={busy} busyLabel="Making your wallet…">
              Create my account
            </SubmitButton>
          </>
        )}
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
