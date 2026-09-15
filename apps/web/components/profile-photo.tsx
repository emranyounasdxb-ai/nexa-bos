"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { cx } from "@/components/ui";
import { acquireProfilePhoto } from "@/lib/profile-photo-cache";

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
  eager,
  className,
}: {
  userId: string;
  fullName: string;
  hasPhoto?: boolean;
  version?: string;
  size?: "header" | "identity" | "list";
  labelled?: boolean;
  eager?: boolean;
  className?: string;
}) {
  const [source, setSource] = useState<string | null>(null);
  const container = useRef<HTMLSpanElement>(null);
  const shouldLoadImmediately = eager ?? size !== "list";
  const [visible, setVisible] = useState(shouldLoadImmediately);

  useEffect(() => {
    setVisible(shouldLoadImmediately);
    if (shouldLoadImmediately || hasPhoto === false || !container.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasPhoto, shouldLoadImmediately, userId, version]);

  useEffect(() => {
    let active = true;
    setSource(null);
    if (hasPhoto === false || !visible) return;

    const acquisition = acquireProfilePhoto({
      userId,
      version,
      variant: size === "identity" ? "profile" : "avatar",
    });
    void acquisition.promise
      .then(async (objectUrl) => {
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
      acquisition.release();
    };
  }, [hasPhoto, size, userId, version, visible]);

  return (
    <span
      ref={container}
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
        <Image
          className="size-full object-cover"
          src={source}
          alt=""
          width={size === "identity" ? 384 : 96}
          height={size === "identity" ? 384 : 96}
          loading={shouldLoadImmediately ? "eager" : "lazy"}
          unoptimized
          onError={() => setSource(null)}
        />
      ) : (
        <span aria-hidden="true">{initials(fullName)}</span>
      )}
    </span>
  );
}
