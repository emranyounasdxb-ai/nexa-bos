"use client";

import { useEffect, useState } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

type Settings = {
  setupLinkExpiryHours: number;
  lockoutMinutes: number;
  inactivityTimeoutMinutes: number;
  absoluteSessionHours: number;
  failedLoginLimit: number;
};

export default function SecurityPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();

  useEffect(() => {
    void apiGet<Settings>("/api/v1/security-settings", api).then(setSettings);
  }, [api]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    const updated = await apiRequest<Settings>("/api/v1/security-settings", api, {
      method: "PUT",
      body: JSON.stringify({
        setup_link_expiry_hours: settings.setupLinkExpiryHours,
        lockout_minutes: settings.lockoutMinutes,
        inactivity_timeout_minutes: settings.inactivityTimeoutMinutes,
        absolute_session_hours: settings.absoluteSessionHours,
      }),
    });
    setSettings(updated);
    setMessage("Saved. OWNER-only settings apply immediately.");
  }

  if (!settings) {
    return <p className="text-sm">Loading…</p>;
  }

  return (
    <section className="max-w-lg space-y-4">
      <h2 className="text-xl font-semibold">Security settings</h2>
      <form onSubmit={(event) => void save(event)} className="grid gap-3 rounded-xl border bg-white p-5">
        <label className="text-sm">
          Setup/reset link expiry (hours)
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="number"
            min={1}
            value={settings.setupLinkExpiryHours}
            onChange={(event) =>
              setSettings({ ...settings, setupLinkExpiryHours: Number(event.target.value) })
            }
          />
        </label>
        <label className="text-sm">
          Lockout duration (minutes)
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="number"
            min={1}
            value={settings.lockoutMinutes}
            onChange={(event) =>
              setSettings({ ...settings, lockoutMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label className="text-sm">
          Inactivity timeout (minutes)
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="number"
            min={1}
            value={settings.inactivityTimeoutMinutes}
            onChange={(event) =>
              setSettings({ ...settings, inactivityTimeoutMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label className="text-sm">
          Absolute session lifetime (hours)
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            type="number"
            min={1}
            value={settings.absoluteSessionHours}
            onChange={(event) =>
              setSettings({ ...settings, absoluteSessionHours: Number(event.target.value) })
            }
          />
        </label>
        <p className="text-xs text-slate-500">Failed login limit is fixed at {settings.failedLoginLimit}.</p>
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
          Save
        </button>
        {message ? <p className="text-sm">{message}</p> : null}
      </form>
    </section>
  );
}
