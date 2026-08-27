"use client";

import { useState } from "react";

import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

export default function AccountPage() {
  const { user, setUser } = useAuth();
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();

  if (!user) {
    return null;
  }

  async function saveMobile(event: React.FormEvent) {
    event.preventDefault();
    const updated = await apiRequest<typeof user>("/api/v1/users/me", api, {
      method: "PATCH",
      body: JSON.stringify({ mobile }),
    });
    setUser(updated);
    setMessage("Mobile number updated");
  }

  async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const body = new FormData();
    body.append("file", file);
    const updated = await apiRequest<typeof user>("/api/v1/users/me/photo", api, {
      method: "POST",
      body,
    });
    setUser(updated);
    setMessage("Photo updated");
  }

  return (
    <section className="max-w-lg space-y-4">
      <h2 className="text-xl font-semibold">My profile</h2>
      <p className="text-sm text-slate-600">
        You can change only your mobile number and profile photo. Other fields require Users.Edit.
      </p>
      <div className="rounded-xl border bg-white p-5 text-sm">
        <p>
          <strong>{user.fullName}</strong> · {user.userCode}
        </p>
        <p>{user.email}</p>
        <p>{user.userType?.name ?? "No user type"}</p>
      </div>
      <form onSubmit={(event) => void saveMobile(event)} className="grid gap-3 rounded-xl border bg-white p-5">
        <label className="text-sm">
          Mobile number
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
          />
        </label>
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
          Save mobile
        </button>
      </form>
      <label className="block rounded-xl border bg-white p-5 text-sm">
        Profile photo
        <input className="mt-2 block" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadPhoto(event)} />
      </label>
      {message ? <p className="text-sm">{message}</p> : null}
    </section>
  );
}
