"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { themeStorageKey } from "@/lib/theme-bootstrap";

export type Theme = "light" | "dark";
const themeEvent = "amafh-theme-changed";
let sessionPreference: Theme | null = null;

function preference(): Theme | null {
  if (sessionPreference) return sessionPreference;
  try {
    const stored = localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Theme still works when browser storage is unavailable. */ }
  return sessionPreference;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(themeEvent));
}

function synchronizeTheme() {
  applyTheme(preference() ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}

function chooseTheme(next: Theme) {
  sessionPreference = next;
  try { localStorage.setItem(themeStorageKey, next); } catch { /* Session-only choice. */ }
  applyTheme(next);
}

function subscribe(listener: () => void) {
  window.addEventListener(themeEvent, listener);
  return () => window.removeEventListener(themeEvent, listener);
}

const snapshot = (): Theme => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const serverSnapshot = (): Theme => "light";

export function useTheme() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function ThemeSync() {
  useLayoutEffect(() => {
    synchronizeTheme();
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== themeStorageKey) return;
      sessionPreference = null;
      synchronizeTheme();
    };
    media.addEventListener("change", synchronizeTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", synchronizeTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}

export function ThemeControls({ className = "" }: { className?: string }) {
  const theme = useTheme();
  return (
    <div className={`amafh-theme-controls ${className}`} role="group" aria-label="Appearance">
      {(["light", "dark"] as const).map(value => (
        <button key={value} type="button" aria-label={`${value === "light" ? "Light" : "Dark"} theme`} aria-pressed={theme === value} onClick={() => chooseTheme(value)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {value === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />}
          </svg>
        </button>
      ))}
    </div>
  );
}
