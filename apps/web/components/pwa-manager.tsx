"use client";

import { useEffect, useState } from "react";

import styles from "./pwa-manager.module.css";

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

  useEffect(() => {
    document.documentElement.dataset.pwaReady = "true";
    const clearReadyState = () => {
      delete document.documentElement.dataset.pwaReady;
    };
    if (isStandalone()) return;

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

  if (dismissed || (!installPrompt && !showSafariGuidance)) return null;

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
        <button type="button" className={styles.dismissButton} onClick={() => setDismissed(true)} aria-label="Dismiss install suggestion">
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
