"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    void apiGet<UserRecord>("/api/v1/auth/me", getBrowserApiUrl())
      .then(() => router.replace("/users"))
      .catch(() =>
        apiGet<{ available: boolean }>("/api/v1/auth/bootstrap-status", getBrowserApiUrl())
          .then((status) => router.replace(status.available ? "/bootstrap" : "/login"))
          .catch(() => router.replace("/login")),
      );
  }, [router]);
  return <p className="p-8 text-sm text-slate-500">Redirecting…</p>;
}
