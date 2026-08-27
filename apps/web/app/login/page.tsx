"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiGet, apiRequest, setCsrfToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { AuthResponse, BootstrapStatus } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);

  useEffect(() => {
    void apiGet<BootstrapStatus>("/api/v1/auth/bootstrap-status", getBrowserApiUrl())
      .then((status) => setBootstrapAvailable(status.available))
      .catch(() => undefined);
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await apiRequest<AuthResponse>("/api/v1/auth/login", getBrowserApiUrl(), {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setCsrfToken(result.csrfToken);
      setUser(result.user);
      router.push("/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold text-slate-900">Sign in to NEXA BOS</h1>
      <p className="mt-2 text-sm text-slate-600">Email and password only. MFA is not enforced.</p>
      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
        <label className="block text-sm">
          Email
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          Sign in
        </button>
      </form>
      {bootstrapAvailable ? (
        <p className="mt-4 text-sm text-slate-600">
          First-time setup is available.{" "}
          <Link className="font-medium text-slate-900" href="/bootstrap">
            Create the OWNER account
          </Link>
        </p>
      ) : null}
    </main>
  );
}
