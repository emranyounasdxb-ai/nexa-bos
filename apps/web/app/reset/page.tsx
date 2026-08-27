"use client";

import { PasswordLinkPage } from "@/components/password-link-form";

export default function ResetPage() {
  return <PasswordLinkPage path="/api/v1/auth/reset" title="Reset your password" />;
}
