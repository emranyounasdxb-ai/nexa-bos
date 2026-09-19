"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth-context";
import { LoadingState } from "@/components/ui";

export default function CreateApplicationRedirectPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    router.replace("/applications");
  }, [router]);

  return <LoadingState>{user?.userType?.code === "ADMIN_OFFICER" ? "Opening My Cases…" : "Opening the Applications workspace…"}</LoadingState>;
}
