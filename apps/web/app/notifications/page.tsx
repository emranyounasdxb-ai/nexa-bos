"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, EmptyState, ErrorText, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

type NotificationItem = {
  id: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  timestamp: string;
  contextualLink: string | null;
  unread: boolean;
  readAt: string | null;
  acknowledgementRequired: boolean;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};

const label = (value: string) =>
  value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" / ");

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const api = getBrowserApiUrl();

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ items: NotificationItem[] }>("/api/v1/notifications", api);
      setItems(data.items);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load notifications");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    try {
      const updated = await apiRequest<NotificationItem>(`/api/v1/notifications/${id}/read`, api, {
        method: "POST",
      });
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
      window.dispatchEvent(new Event("nexa-notifications-changed"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to mark notification as read");
    }
  }

  async function markAllRead() {
    try {
      await apiRequest("/api/v1/notifications/read-all", api, { method: "POST" });
      setItems((current) =>
        current.map((item) => ({
          ...item,
          unread: false,
          readAt: item.readAt ?? new Date().toISOString(),
        })),
      );
      window.dispatchEvent(new Event("nexa-notifications-changed"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to mark notifications as read");
    }
  }

  async function acknowledge(id: string) {
    try {
      const updated = await apiRequest<NotificationItem>(
        `/api/v1/notifications/${id}/acknowledge`,
        api,
        { method: "POST" },
      );
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to acknowledge notification");
    }
  }

  const unreadCount = items.filter((item) => item.unread).length;

  return (
    <section className="space-y-5">
      <PageHeader
        title="Notification center"
        description={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
        actions={
          <Button type="button" variant="secondary" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
            Mark all as read
          </Button>
        }
      />
      <ErrorText>{error}</ErrorText>
      {loading ? <LoadingState>Loading notifications…</LoadingState> : null}
      {!loading && items.length === 0 ? (
        <Card>
          <EmptyState>No notifications are available.</EmptyState>
        </Card>
      ) : null}
      <div className="space-y-3" aria-live="polite">
        {items.map((item) => (
          <Card
            key={item.id}
            className={`relative overflow-hidden ${item.unread ? "border-blue-200 bg-blue-50/30" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 w-1 ${
                item.severity.toLowerCase() === "critical"
                  ? "bg-red-700"
                  : item.severity.toLowerCase() === "urgent"
                    ? "bg-amber-500"
                    : "bg-[#0f4c81]"
              }`}
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2 pl-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={item.unread ? "Unread" : "Read"} />
                  <Badge>{label(item.category)}</Badge>
                  <StatusBadge value={label(item.severity)} />
                  {item.acknowledgementRequired ? (
                    <StatusBadge value={item.acknowledged ? "Acknowledged" : "Acknowledgement required"} />
                  ) : null}
                </div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{item.message}</p>
                <p className="text-xs text-slate-500">
                  {new Date(item.timestamp).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.contextualLink ? (
                  <Link
                    href={item.contextualLink}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                  >
                    Open related record
                  </Link>
                ) : null}
                {item.unread ? (
                  <Button type="button" variant="secondary" onClick={() => void markRead(item.id)}>
                    Mark as read
                  </Button>
                ) : null}
                {item.acknowledgementRequired && !item.acknowledged ? (
                  <Button type="button" onClick={() => void acknowledge(item.id)}>
                    Acknowledge
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
