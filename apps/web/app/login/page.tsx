"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeControls } from "@/components/theme-controls";
import { BrandLogo, Button, ErrorText, TextInput, focusRing } from "@/components/ui";
import { apiGet, apiRequest, setCsrfToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AuthResponse, BootstrapStatus } from "@/lib/types";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void apiGet<BootstrapStatus>("/api/v1/auth/bootstrap-status", getBrowserApiUrl())
      .then((status) => setBootstrapAvailable(status.available))
      .catch(() => undefined);
  }, []);

  function completeLogin(result: AuthResponse) {
    if (!result.csrfToken || !result.user) {
      throw new Error("Login did not complete");
    }
    setCsrfToken(result.csrfToken);
    setUser(result.user);
    router.push(result.user.permissions.includes("Dashboard.View") ? "/reports" : "/users");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mfaToken) {
        const result = await apiRequest<AuthResponse>("/api/v1/auth/mfa/login", getBrowserApiUrl(), {
          method: "POST",
          body: JSON.stringify({ token: mfaToken, code: mfaCode }),
        });
        completeLogin(result);
        return;
      }
      const result = await apiRequest<AuthResponse>("/api/v1/auth/login", getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
        return;
      }
      completeLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} data-testid="login-brand-panel" aria-label="AMAFH CORE secure workspace">
        <div className={styles.brandContent}>
          <div className={styles.logoWrap}>
            <BrandLogo />
          </div>
          <div className={styles.brandMessage}>
            <p className={styles.eyebrow}>AMAFH CORE</p>
            <h2>Secure AMAFH CORE workspace</h2>
          </div>
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewHeader}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.previewBody}>
              <div className={styles.previewRail} />
              <div className={styles.previewCanvas}>
                <div className={styles.previewMetric} />
                <div className={styles.previewMetric} />
                <div className={styles.previewMetric} />
                <div className={styles.previewChart}>
                  <span /><span /><span /><span /><span /><span />
                </div>
                <div className={styles.previewList}>
                  <span /><span /><span />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.formPanel} data-testid="login-form-panel" data-amafh-public-surface="">
        <ThemeControls className={styles.themeControls} />
        <div className={styles.formContent}>
          <div className={styles.mobileBrand}>
            <BrandLogo />
          </div>
          <p className={styles.formEyebrow}>Welcome back</p>
          <h1>Sign in to AMAFH CORE</h1>
          <p data-testid="page-purpose" className={styles.description}>
            {mfaToken
              ? "Enter the authenticator code for this account."
              : "Email and password. Authenticator challenge is required only when MFA is enabled for the account."}
          </p>

          <form onSubmit={(event) => void onSubmit(event)} className={styles.form}>
            {mfaToken ? (
              <label className={styles.field}>
                Authenticator code
                <TextInput
                  className={styles.input}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
              </label>
            ) : (
              <>
                <label className={styles.field}>
                  Email
                  <TextInput
                    className={styles.input}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    required
                  />
                </label>
                <label className={styles.field}>
                  Password
                  <TextInput
                    className={styles.input}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    required
                  />
                </label>
              </>
            )}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={submitting} className={styles.submit}>
              {submitting ? "Signing in…" : mfaToken ? "Verify and sign in" : "Sign in"}
            </Button>
          </form>
          {bootstrapAvailable && !mfaToken ? (
            <p className={styles.bootstrap}>
              First-time setup is available.{" "}
              <Link className={focusRing} href="/bootstrap">
                Create the OWNER account
              </Link>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
