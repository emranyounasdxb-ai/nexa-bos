"use client";

import { RecordFrame } from "@/components/page-patterns";

import { useState } from "react";
import { FilePicker } from "@/components/file-picker";
import { HrWorkflowSummary } from "@/components/hr-workflow-summary";
import { ProfilePhoto } from "@/components/profile-photo";

import { Button, ButtonLink, Card, ErrorText, PageHeader, TextInput } from "@/components/ui";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { invalidateProfilePhoto } from "@/lib/profile-photo-cache";

export default function AccountPage() {
  const { user, setUser } = useAuth();
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
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

  async function uploadPhoto() {
    if (!photoFile) return;
    const userId = user?.id;
    if (!userId) return;
    setPhotoSaving(true);
    setError("");
    setMessage("");
    const body = new FormData();
    body.append("file", photoFile);
    try {
      const updated = await apiRequest<typeof user>("/api/v1/users/me/photo", api, {
        method: "POST",
        body,
      });
      invalidateProfilePhoto(userId);
      setUser(updated);
      setPhotoFile(null);
      setMessage("Photo updated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Photo could not be updated");
    } finally {
      setPhotoSaving(false);
    }
  }

  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="My profile"
        description="You can change only your mobile number and profile photo. Other fields require Users.Edit."
        actions={<ButtonLink href={`/users/${user.id}`}>View employee profile</ButtonLink>}
      />
      <RecordFrame summary={
      <Card className="flex items-center gap-3 text-sm">
        <ProfilePhoto userId={user.id} fullName={user.fullName} hasPhoto={user.hasPhoto} version={user.updatedAt} size="identity" labelled />
        <div className="min-w-0 space-y-1">
          <p className="truncate"><strong>{user.fullName}</strong></p>
          <p className="truncate" title={user.email}>{user.email}</p>
          <p>{user.userType?.name ?? "No user type"}</p>
        </div>
      </Card>
      }>
      <Card>
        <form onSubmit={(event) => void saveMobile(event)} className="grid gap-3">
          <label className="text-sm">
            Mobile number
            <TextInput value={mobile} onChange={(event) => setMobile(event.target.value)} />
          </label>
          <Button type="submit">Save mobile</Button>
        </form>
      </Card>
      <Card className="space-y-3">
        <FilePicker
          id="profile-photo"
          label="Profile photo"
          chooseLabel="Choose image"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          guidance="PNG, JPEG, or WebP. Maximum 2 MB."
          file={photoFile}
          imagePreview
          busy={photoSaving}
          onChange={(file) => {
            setPhotoFile(file);
            setError("");
            setMessage("");
          }}
        />
        <div className="flex justify-end">
          <Button type="button" disabled={!photoFile || photoSaving} onClick={() => void uploadPhoto()}>
            {photoSaving ? "Uploading…" : "Upload photo"}
          </Button>
        </div>
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
      </RecordFrame>
      <HrWorkflowSummary personal />
    </section>
  );
}
