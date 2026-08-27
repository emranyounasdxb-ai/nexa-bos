"use client";

import { PasswordLinkPage } from "@/components/password-link-form";

export default function SetupPage() {
  return <PasswordLinkPage path="/api/v1/auth/setup" title="Set your password" />;
}
