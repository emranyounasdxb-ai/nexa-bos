"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LoadingState } from "@/components/ui";

export default function CreateApplicationRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/applications");
  }, [router]);

  return <LoadingState>Opening the Applications workspace…</LoadingState>;
}
