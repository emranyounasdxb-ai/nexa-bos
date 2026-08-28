"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button, ErrorText, PublicScreen, TextInput } from "@/components/ui";
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
    <PublicScreen title={title}>
      <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
        <label className="block text-sm">
          New password
          <TextInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>
        <p className="text-xs text-slate-500">
          Must include lowercase, uppercase, number, and special character.
        </p>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full font-medium">
          Save password
        </Button>
      </form>
    </PublicScreen>
  );
}

export function PasswordLinkPage({ path, title }: { path: string; title: string }) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-slate-500">Loading…</p>}>
      <PasswordLinkForm path={path} title={title} />
    </Suspense>
  );
}
