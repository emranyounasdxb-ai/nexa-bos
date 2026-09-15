"use client";

import { useEffect, useState } from "react";

import styles from "./pwa-manager.module.css";

const DISMISSAL_KEY = "amafh-core-install-dismissed-until";
const DISMISSAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const ENGAGEMENT_DELAY_MS = process.env.NEXT_PUBLIC_PWA_TEST === "1" ? 50 : 8_000;

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function isMacSafari() {
  const userAgent = navigator.userAgent;
  return (
    /Macintosh/.test(userAgent) &&
    /Safari/.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|Edg|OPR)/.test(userAgent)
  );
}

function InstallIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 18v2h14v-2" />
    </svg>
  );
}

export function PwaManager() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showSafariGuidance, setShowSafariGuidance] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.pwaReady = "true";
    const clearReadyState = () => {
      delete document.documentElement.dataset.pwaReady;
    };
    if (isStandalone()) return;

    const dismissedUntil = Number(window.localStorage.getItem(DISMISSAL_KEY));
    if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) {
      setDismissed(true);
    } else {
      window.localStorage.removeItem(DISMISSAL_KEY);
    }

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setShowSafariGuidance(false);
      setDismissed(true);
    };
    const onDisplayModeChange = () => {
      if (displayMode.matches) onInstalled();
    };

    setShowSafariGuidance(isMacSafari());
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);

    return () => {
      clearReadyState();
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  useEffect(() => {
    if (dismissed || (!installPrompt && !showSafariGuidance)) {
      setEngaged(false);
      return;
    }
    const timer = window.setTimeout(() => setEngaged(true), ENGAGEMENT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dismissed, installPrompt, showSafariGuidance]);

  const visible = engaged && !dismissed && Boolean(installPrompt || showSafariGuidance);

  useEffect(() => {
    if (visible) document.documentElement.dataset.pwaInstallVisible = "true";
    else delete document.documentElement.dataset.pwaInstallVisible;
    return () => {
      delete document.documentElement.dataset.pwaInstallVisible;
    };
  }, [visible]);

  useEffect(() => {
    const pwaRuntimeEnabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_PWA_TEST === "1";
    if (!pwaRuntimeEnabled || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    const updateWorker = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((current) => {
        registration = current;
        return current.update();
      })
      .catch(() => {
        // PWA enhancement must never interrupt authentication or application use.
      });

    document.addEventListener("visibilitychange", updateWorker);
    window.addEventListener("online", updateWorker);
    return () => {
      document.removeEventListener("visibilitychange", updateWorker);
      window.removeEventListener("online", updateWorker);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function dismiss() {
    window.localStorage.setItem(DISMISSAL_KEY, String(Date.now() + DISMISSAL_DURATION_MS));
    setDismissed(true);
  }

  if (!visible) return null;

  return (
    <aside className={styles.installCard} aria-label="Install AMAFH CORE" data-testid="pwa-install-card">
      <div className={styles.actions}>
        {installPrompt ? (
          <button type="button" className={styles.installButton} onClick={() => void install()}>
            <InstallIcon />
            Install AMAFH CORE
          </button>
        ) : (
          <strong className={styles.installButton} aria-describedby="safari-install-guidance">
            <InstallIcon />
            Install AMAFH CORE
          </strong>
        )}
        <button type="button" className={styles.dismissButton} onClick={dismiss} aria-label="Dismiss install suggestion">
          Not now
        </button>
      </div>
      {showSafariGuidance ? (
        <p id="safari-install-guidance" className={styles.guidance}>
          In Safari, choose File &gt; Add to Dock, then confirm Add.
        </p>
      ) : null}
    </aside>
  );
}
