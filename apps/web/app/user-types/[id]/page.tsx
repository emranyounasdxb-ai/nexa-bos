"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserTypeSummary } from "@/lib/types";

const SCOPES = ["company", "office", "team", "own"];

export default function UserTypeDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const [item, setItem] = useState<UserTypeSummary | null>(null);
  const [catalog, setCatalog] = useState<{ code: string; description: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();

  const refresh = useCallback(async () => {
    const data = await apiGet<UserTypeSummary>(`/api/v1/user-types/${params.id}`, api);
    setItem(data);
    setSelected(data.permissions ?? []);
    const perms = await apiGet<{ items: { code: string; description: string }[] }>(
      "/api/v1/permissions",
      api,
    );
    setCatalog(perms.items);
  }, [api, params.id]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  async function savePermissions() {
    await apiRequest(`/api/v1/user-types/${params.id}/permissions`, api, {
      method: "PUT",
      body: JSON.stringify({ permissions: selected }),
    });
    await refresh();
    setMessage("Permissions saved. Active sessions for this type were terminated.");
  }

  if (!item) {
    return <p className="text-sm">{message || "Loading…"}</p>;
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">
        {item.code} — {item.name}
      </h2>
      <p className="text-sm text-slate-600">{item.description || "No description"}</p>
      <p className="text-sm">
        Status: {item.status} · User directory scope: {item.visibilityScope ?? "none"} · Customer
        scope: {item.customerVisibilityScope ?? "none"} · Application scope:{" "}
        {item.applicationVisibilityScope ?? "none"} · MFA required flag:{" "}
        {item.mfaRequired ? "on" : "off (default, not enforced)"}
      </p>
      {can("UserTypes.Edit") && !item.isSystem ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(item.canBeReportingManager)}
              onChange={(event) =>
                void apiRequest(`/api/v1/user-types/${item.id}`, api, {
                  method: "PATCH",
                  body: JSON.stringify({ can_be_reporting_manager: event.target.checked }),
                }).then(refresh)
              }
            />
            Can be reporting manager
          </label>
        </div>
      ) : (
        <p className="text-sm">
          Can be reporting manager: {item.canBeReportingManager ? "Yes" : "No"}
        </p>
      )}
      {can("UserTypes.Edit") ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(item.canBeCaseOwner)}
            onChange={(event) =>
              void apiRequest(`/api/v1/user-types/${item.id}/case-owner`, api, {
                method: "PUT",
                body: JSON.stringify({ can_be_case_owner: event.target.checked }),
              }).then(refresh)
            }
          />
          Can be Case Owner
        </label>
      ) : (
        <p className="text-sm">Can be Case Owner: {item.canBeCaseOwner ? "Yes" : "No"}</p>
      )}
      <div className="flex gap-2 text-sm">
        {can("UserTypes.Activate") ? (
          <button
            className="rounded-md border px-3 py-1"
            type="button"
            onClick={() =>
              void apiRequest(`/api/v1/user-types/${item.id}/activate`, api, { method: "POST" }).then(
                refresh,
              )
            }
          >
            Activate
          </button>
        ) : null}
        {can("UserTypes.Deactivate") ? (
          <button
            className="rounded-md border px-3 py-1"
            type="button"
            onClick={() =>
              void apiRequest(`/api/v1/user-types/${item.id}/deactivate`, api, { method: "POST" }).then(
                refresh,
              )
            }
          >
            Deactivate
          </button>
        ) : null}
        {can("UserTypes.AssignScope") ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              User directory scope
              <select
                className="rounded-md border px-2 py-1"
                aria-label="User directory scope"
                value={item.visibilityScope ?? ""}
                onChange={(event) =>
                  void apiRequest(`/api/v1/user-types/${item.id}/scope`, api, {
                    method: "PUT",
                    body: JSON.stringify({
                      visibility_scope: event.target.value || null,
                    }),
                  }).then(refresh)
                }
              >
                <option value="">No scope</option>
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Customer scope
              <select
                className="rounded-md border px-2 py-1"
                aria-label="Customer scope"
                value={item.customerVisibilityScope ?? ""}
                onChange={(event) =>
                  void apiRequest(`/api/v1/user-types/${item.id}/customer-scope`, api, {
                    method: "PUT",
                    body: JSON.stringify({
                      customer_visibility_scope: event.target.value || null,
                    }),
                  }).then(refresh)
                }
              >
                <option value="">No scope</option>
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Application scope
              <select
                className="rounded-md border px-2 py-1"
                aria-label="Application scope"
                value={item.applicationVisibilityScope ?? ""}
                onChange={(event) =>
                  void apiRequest(`/api/v1/user-types/${item.id}/application-scope`, api, {
                    method: "PUT",
                    body: JSON.stringify({
                      application_visibility_scope: event.target.value || null,
                    }),
                  }).then(refresh)
                }
              >
                <option value="">No scope</option>
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
      {can("UserTypes.AssignPermissions") && item.code !== "OWNER" ? (
        <div className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold">Permissions</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {catalog.map((perm) => (
              <label key={perm.code} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(perm.code)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, perm.code]
                        : current.filter((code) => code !== perm.code),
                    );
                  }}
                />
                <span>
                  <strong>{perm.code}</strong>
                  <span className="block text-slate-500">{perm.description}</span>
                </span>
              </label>
            ))}
          </div>
          <button
            className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
            type="button"
            onClick={() => void savePermissions()}
          >
            Save permissions
          </button>
        </div>
      ) : null}
      {message ? <p className="text-sm">{message}</p> : null}
    </section>
  );
}
