"use client";

import { useEffect, useState } from "react";

import { apiGet, ApiClientError, type HealthResponse, type ReadyResponse } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

type CheckState =
  | { state: "loading" }
  | { state: "ok"; detail: string }
  | { state: "error"; detail: string };

function StatusCard({
  title,
  check,
}: {
  title: string;
  check: CheckState;
}) {
  const tone =
    check.state === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : check.state === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <article className={`rounded-xl border p-5 ${tone}`}>
      <h3 className="text-sm font-semibold uppercase tracking-wide">{title}</h3>
      <p className="mt-2 text-sm" data-testid={`${title.toLowerCase().replace(/ /g, "-")}-status`}>
        {check.state === "loading" ? "Checking…" : check.detail}
      </p>
    </article>
  );
}

export function SmokeStatus() {
  const [health, setHealth] = useState<CheckState>({ state: "loading" });
  const [ready, setReady] = useState<CheckState>({ state: "loading" });
  const apiUrl = getBrowserApiUrl();

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      try {
        const data = await apiGet<HealthResponse>("/api/v1/health", apiUrl);
        if (!cancelled) {
          setHealth({ state: "ok", detail: `API health: ${data.status}` });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof ApiClientError ? error.message : "Health check failed";
          setHealth({ state: "error", detail: message });
        }
      }

      try {
        const data = await apiGet<ReadyResponse>("/api/v1/ready", apiUrl);
        if (!cancelled) {
          setReady({ state: "ok", detail: `API readiness: ${data.status}` });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof ApiClientError ? error.message : "Readiness check failed";
          setReady({ state: "error", detail: message });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <StatusCard title="API health" check={health} />
      <StatusCard title="API readiness" check={ready} />
      <p className="md:col-span-2 text-xs text-slate-500" data-testid="api-base-url">
        API base URL: {apiUrl}
      </p>
    </div>
  );
}
