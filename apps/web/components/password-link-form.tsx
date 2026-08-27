"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

function PasswordLinkForm({ path, title }: { path: string; title: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const token = params.get("token") ?? "";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest(path, getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
        <label className="block text-sm">
          New password
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        <p className="text-xs text-slate-500">
          Must include lowercase, uppercase, number, and special character.
        </p>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          Save password
        </button>
      </form>
    </main>
  );
}

export function PasswordLinkPage({ path, title }: { path: string; title: string }) {
  return (
    <Suspense fallback={<p className="p-8 text-sm">Loading…</p>}>
      <PasswordLinkForm path={path} title={title} />
    </Suspense>
  );
}
