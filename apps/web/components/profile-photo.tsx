"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { apiDownload } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { cx } from "@/components/ui";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`
    : parts[0]?.slice(0, 2) ?? "U"
  ).toUpperCase();
}

export function ProfilePhoto({
  userId,
  fullName,
  hasPhoto,
  version,
  size = "header",
  labelled = false,
  className,
}: {
  userId: string;
  fullName: string;
  hasPhoto?: boolean;
  version?: string;
  size?: "header" | "identity" | "list";
  labelled?: boolean;
  className?: string;
}) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    if (hasPhoto === false) return;

    void apiDownload(`/api/v1/users/${userId}/photo?v=${encodeURIComponent(version ?? "current")}`, getBrowserApiUrl())
      .then(async ({ blob, contentType }) => {
        if (!contentType.startsWith("image/") && !blob.type.startsWith("image/")) {
          throw new Error("Profile photo response is not an image");
        }
        objectUrl = URL.createObjectURL(blob);
        const preview = new window.Image();
        preview.src = objectUrl;
        await preview.decode();
        if (active) setSource(objectUrl);
      })
      .catch(() => {
        if (active) setSource(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasPhoto, userId, version]);

  return (
    <span
      data-profile-photo=""
      className={cx(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-subtle font-semibold text-text-primary",
        size === "identity" ? "size-16 text-base" : size === "list" ? "size-8 text-xs" : "size-[30px] text-[10px]",
        className,
      )}
      aria-label={labelled ? `Profile photo for ${fullName}` : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {source ? (
        <Image className="size-full object-cover" src={source} alt="" width={64} height={64} unoptimized />
      ) : (
        <span aria-hidden="true">{initials(fullName)}</span>
      )}
    </span>
  );
}
