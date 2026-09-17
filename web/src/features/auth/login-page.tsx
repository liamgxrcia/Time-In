"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, LockKeyhole } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ApiResponse, ErrorCode } from "@/contracts/crm";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";

const credentialsSchema = z.object({
  username: z.string().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});
const challengeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code from your authenticator app."),
});

type Credentials = z.infer<typeof credentialsSchema>;
type ChallengeValues = z.infer<typeof challengeSchema>;
type Authenticated = { authenticated: true };
type MfaChallenge = { requiresMfa: true; factorId: string; challengeId: string };

function errorMessage(code: ErrorCode | undefined, fallback: string, duringMfa = false) {
  if (code === "RATE_LIMITED") {
    return duringMfa
      ? "Too many verification attempts. Wait a moment, then try again."
      : "Too many sign-in attempts. Wait a moment, then try again.";
  }
  if (code === "MFA_REQUIRED") {
    return duringMfa
      ? "That verification code was not accepted. Enter the current six-digit code and try again."
      : "Multi-factor verification could not be started. Try signing in again.";
  }
  return fallback;
}

async function postAuth<T>(operation: "login" | "mfa", body: unknown) {
  const response = await fetch(`/api/auth/${operation}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const envelope = await response.json().catch(() => null) as ApiResponse<T> | null;
  return { response, envelope };
}

export function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [serverError, setServerError] = useState(
    params.get("error") === "forbidden"
      ? "This account is not authorized for the CEO command center."
      : "",
  );
  const credentialsForm = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });
  const challengeForm = useForm<ChallengeValues>({
    resolver: zodResolver(challengeSchema),
    defaultValues: { code: "" },
  });

  useEffect(() => {
    if (challenge) challengeForm.setFocus("code");
  }, [challenge, challengeForm]);

  function enterApplication() {
    router.replace("/today");
    router.refresh();
  }

  const submitCredentials = credentialsForm.handleSubmit(async (values) => {
    setServerError("");
    try {
      const { response, envelope } = await postAuth<Authenticated | MfaChallenge>("login", values);
      if (!response.ok || !envelope || envelope.error) {
        setServerError(errorMessage(envelope?.error?.code, envelope?.error?.message ?? "Sign-in could not be completed."));
        return;
      }
      if ("requiresMfa" in envelope.data && envelope.data.requiresMfa) {
        credentialsForm.reset({ username: values.username, password: "" });
        setChallenge(envelope.data);
        return;
      }
      if ("authenticated" in envelope.data && envelope.data.authenticated === true) enterApplication();
      else setServerError("Sign-in could not be confirmed. Try again.");
    } catch {
      setServerError("The network connection was interrupted. Check your connection and try again.");
    }
  });

  const submitChallenge = challengeForm.handleSubmit(async ({ code }) => {
    if (!challenge) return;
    setServerError("");
    try {
      const { response, envelope } = await postAuth<Authenticated>("mfa", {
        factorId: challenge.factorId,
        challengeId: challenge.challengeId,
        code,
      });
      if (!response.ok || !envelope || envelope.error) {
        setServerError(errorMessage(envelope?.error?.code, envelope?.error?.message ?? "Verification could not be completed.", true));
        challengeForm.setValue("code", "");
        challengeForm.setFocus("code");
        return;
      }
      if (envelope.data.authenticated === true) enterApplication();
      else setServerError("Verification could not be confirmed. Try again.");
    } catch {
      setServerError("The network connection was interrupted. Check your connection and try again.");
    }
  });

  const fieldClass = "mt-2 w-full rounded-lg border border-white/20 bg-white/8 px-3 py-2.5 text-white outline-none focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/35";

  return (
    <main id="main-content" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink p-5">
      <div className="absolute inset-0 opacity-45" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 20% 15%, rgba(181,149,93,.26), transparent 26%), repeating-linear-gradient(112deg, transparent 0 12px, rgba(255,255,255,.018) 13px 14px)" }} />
      <section className="relative w-full max-w-md rounded-2xl border border-white/15 bg-charcoal/95 p-7 text-ivory shadow-2xl sm:p-9" aria-labelledby="login-title">
        <div className="flex items-center gap-3" aria-label={brand.name}>
          <span className="display flex size-11 items-center justify-center rounded-xl border border-gold/50 text-xl text-gold">{brand.mark}</span>
          <div>
            <p className="display text-2xl leading-none">{brand.name}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[.18em] text-gold">{brand.descriptor}</p>
          </div>
        </div>
        <div className="mt-10 flex size-12 items-center justify-center rounded-xl border border-gold/30 text-gold">
          {challenge ? <KeyRound className="size-5" aria-hidden /> : <LockKeyhole className="size-5" aria-hidden />}
        </div>
        <p className="eyebrow mt-8 !text-gold">Private workspace</p>
        <h1 id="login-title" className="display mt-3 text-4xl">
          {challenge ? "Confirm it’s you." : "Your private command center."}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/62">
          {challenge
            ? "Enter the current code from your authenticator app to finish signing in."
            : "Invite-only access for the CEO. Authentication changes are recorded in the audit history."}
        </p>

        {challenge ? (
          <form className="mt-8 space-y-5" onSubmit={submitChallenge} noValidate>
            <div>
              <label htmlFor="mfa-code" className="block text-sm font-semibold">Six-digit code</label>
              <input
                {...challengeForm.register("code")}
                id="mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                aria-invalid={Boolean(challengeForm.formState.errors.code)}
                aria-describedby={challengeForm.formState.errors.code ? "mfa-code-error" : "mfa-code-help"}
                className={`${fieldClass} text-center text-2xl tracking-[0.35em] tabular-nums`}
              />
              <p id="mfa-code-help" className="mt-2 text-xs leading-5 text-white/45">Codes contain six numbers and refresh regularly.</p>
              {challengeForm.formState.errors.code && <p id="mfa-code-error" className="mt-1 text-xs text-red-300">{challengeForm.formState.errors.code.message}</p>}
            </div>
            {serverError && <p role="alert" aria-live="assertive" className="rounded-lg bg-red-400/12 p-3 text-sm text-red-200">{serverError}</p>}
            <Button className="w-full bg-gold-strong text-white hover:bg-gold" disabled={challengeForm.formState.isSubmitting}>
              {challengeForm.formState.isSubmitting ? "Verifying…" : "Verify and continue"}
            </Button>
          </form>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={submitCredentials} noValidate>
            <label htmlFor="username" className="block text-sm font-semibold">Username
              <input {...credentialsForm.register("username")} id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(credentialsForm.formState.errors.username)} aria-describedby={credentialsForm.formState.errors.username ? "username-error" : undefined} className={fieldClass} />
              {credentialsForm.formState.errors.username && <span id="username-error" className="mt-1 block text-xs text-red-300">{credentialsForm.formState.errors.username.message}</span>}
            </label>
            <label htmlFor="password" className="block text-sm font-semibold">Password
              <input {...credentialsForm.register("password")} id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(credentialsForm.formState.errors.password)} aria-describedby={credentialsForm.formState.errors.password ? "password-error" : undefined} className={fieldClass} />
              {credentialsForm.formState.errors.password && <span id="password-error" className="mt-1 block text-xs text-red-300">{credentialsForm.formState.errors.password.message}</span>}
            </label>
            {serverError && <p role="alert" aria-live="assertive" className="rounded-lg bg-red-400/12 p-3 text-sm text-red-200">{serverError}</p>}
            <Button className="w-full bg-gold-strong text-white hover:bg-gold" disabled={credentialsForm.formState.isSubmitting}>
              {credentialsForm.formState.isSubmitting ? "Signing in…" : "Sign in securely"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-xs leading-5 text-white/45">No public registration. Contact the authorized administrator if your invitation or access has changed.</p>
      </section>
    </main>
  );
}
