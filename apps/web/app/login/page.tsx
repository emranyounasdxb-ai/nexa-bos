"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, ErrorText, PublicScreen, TextInput, focusRing } from "@/components/ui";
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
    <PublicScreen
      title="Sign in to NEXA BOS"
      description="Email and password only. MFA is not enforced."
    >
      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
        <label className="block text-sm">
          Email
          <TextInput
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block text-sm">
          Password
          <TextInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full font-medium">
          Sign in
        </Button>
      </form>
      {bootstrapAvailable ? (
        <p className="mt-4 text-sm text-slate-600">
          First-time setup is available.{" "}
          <Link className={`font-medium text-slate-900 ${focusRing}`} href="/bootstrap">
            Create the OWNER account
          </Link>
        </p>
      ) : null}
    </PublicScreen>
  );
}
