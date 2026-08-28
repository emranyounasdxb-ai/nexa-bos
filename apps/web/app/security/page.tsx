"use client";

import { useEffect, useState } from "react";

import { Button, Card, PageHeader, TextInput } from "@/components/ui";
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
    void apiGet<Settings>("/api/v1/security-settings", api)
      .then(setSettings)
      .catch((err: unknown) =>
        setMessage(err instanceof Error ? err.message : "Unable to load security settings"),
      );
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
    return (
      <section className="max-w-lg space-y-4">
        <PageHeader title="Security settings" />
        {message ? <p className="text-sm text-red-700">{message}</p> : <p className="text-sm text-slate-500">Loading…</p>}
      </section>
    );
  }

  return (
    <section className="max-w-lg space-y-4">
      <PageHeader title="Security settings" />
      <Card>
        <form onSubmit={(event) => void save(event)} className="grid gap-3">
          <label className="text-sm">
            Setup/reset link expiry (hours)
            <TextInput
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
            <TextInput
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
            <TextInput
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
            <TextInput
              type="number"
              min={1}
              value={settings.absoluteSessionHours}
              onChange={(event) =>
                setSettings({ ...settings, absoluteSessionHours: Number(event.target.value) })
              }
            />
          </label>
          <p className="text-xs text-slate-500">Failed login limit is fixed at {settings.failedLoginLimit}.</p>
          <Button type="submit">Save</Button>
          {message ? <p className="text-sm text-slate-700">{message}</p> : null}
        </form>
      </Card>
    </section>
  );
}
