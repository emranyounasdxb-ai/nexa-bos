import { getBrowserApiUrl } from "@/lib/env";

type PendingEntry = {
  abortTimer?: number;
  controller: AbortController;
  promise: Promise<string>;
  subscribers: number;
};

type CachedEntry = {
  objectUrl: string;
  lastUsed: number;
};

const MAX_CONCURRENT_REQUESTS = 6;
const MAX_SESSION_ENTRIES = 512;
const pending = new Map<string, PendingEntry>();
const cached = new Map<string, CachedEntry>();
const queue: Array<() => void> = [];
let activeRequests = 0;
let sessionUserId: string | null = null;

function runNext() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length) {
    activeRequests += 1;
    queue.shift()?.();
  }
}

function schedule<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      void work()
        .then(resolve, reject)
        .finally(() => {
          activeRequests -= 1;
          runNext();
        });
    });
    runNext();
  });
}

function trimCache() {
  if (cached.size <= MAX_SESSION_ENTRIES) return;
  const oldest = [...cached.entries()]
    .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)
    .slice(0, cached.size - MAX_SESSION_ENTRIES);
  for (const [key, entry] of oldest) {
    cached.delete(key);
    URL.revokeObjectURL(entry.objectUrl);
  }
}

function cacheKey(userId: string, version: string | undefined, variant: string) {
  return `${userId}|${version ?? "current"}|${variant}`;
}

export function acquireProfilePhoto({
  userId,
  version,
  variant,
}: {
  userId: string;
  version?: string;
  variant: "avatar" | "card" | "profile";
}): { promise: Promise<string>; release: () => void } {
  const key = cacheKey(userId, version, variant);
  const ready = cached.get(key);
  if (ready) {
    ready.lastUsed = Date.now();
    return { promise: Promise.resolve(ready.objectUrl), release: () => undefined };
  }

  const existing = pending.get(key);
  if (existing) {
    if (existing.abortTimer !== undefined) window.clearTimeout(existing.abortTimer);
    existing.subscribers += 1;
    let released = false;
    return {
      promise: existing.promise,
      release: () => {
        if (released) return;
        released = true;
        existing.subscribers -= 1;
        if (existing.subscribers === 0) {
          existing.abortTimer = window.setTimeout(() => {
            if (existing.subscribers === 0) existing.controller.abort();
          }, 0);
        }
      },
    };
  }

  const controller = new AbortController();
  const entry = {} as PendingEntry;
  entry.controller = controller;
  entry.subscribers = 1;
  entry.promise = schedule(async () => {
    const params = new URLSearchParams({ size: variant });
    if (version) params.set("v", version);
    const response = await fetch(
      `${getBrowserApiUrl()}/api/v1/users/${userId}/photo?${params.toString()}`,
      {
        credentials: "include",
        cache: "default",
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`Profile photo request failed (${response.status})`);
    const contentType = response.headers.get("Content-Type") ?? "";
    const blob = await response.blob();
    if (!contentType.startsWith("image/") && !blob.type.startsWith("image/")) {
      throw new Error("Profile photo response is not an image");
    }
    const objectUrl = URL.createObjectURL(blob);
    if (entry.subscribers === 0) {
      URL.revokeObjectURL(objectUrl);
      throw new DOMException("Profile photo is no longer needed", "AbortError");
    }
    cached.set(key, { objectUrl, lastUsed: Date.now() });
    trimCache();
    return objectUrl;
  }).finally(() => {
    pending.delete(key);
  });
  pending.set(key, entry);

  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.subscribers -= 1;
      if (entry.subscribers === 0) {
        entry.abortTimer = window.setTimeout(() => {
          if (entry.subscribers === 0) entry.controller.abort();
        }, 0);
      }
    },
  };
}

export function invalidateProfilePhoto(userId: string) {
  for (const [key, entry] of cached) {
    if (!key.startsWith(`${userId}|`)) continue;
    cached.delete(key);
    window.setTimeout(() => URL.revokeObjectURL(entry.objectUrl), 1_000);
  }
  for (const [key, entry] of pending) {
    if (key.startsWith(`${userId}|`)) entry.controller.abort();
  }
}

export function clearProfilePhotoCache() {
  for (const entry of pending.values()) entry.controller.abort();
  pending.clear();
  for (const entry of cached.values()) URL.revokeObjectURL(entry.objectUrl);
  cached.clear();
}

export function setProfilePhotoSession(userId: string | null) {
  if (sessionUserId && sessionUserId !== userId) clearProfilePhotoCache();
  sessionUserId = userId;
}
