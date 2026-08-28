"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ButtonLink, PageHeader, controlClass, secondaryButtonClass } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord, UserTypeSummary } from "@/lib/types";

type History = {
  emails: { email: string; changedAt: string }[];
  employeeCodes: { employeeCode: string; effectiveFrom: string; effectiveTo: string | null }[];
  events: { id: string; action: string; createdAt: string }[];
};

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [types, setTypes] = useState<UserTypeSummary[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();

  const refresh = useCallback(async () => {
    const data = await apiGet<UserRecord>(`/api/v1/users/${params.id}`, api);
    setUser(data);
    const hist = await apiGet<History>(`/api/v1/users/${params.id}/history`, api);
    setHistory(hist);
  }, [api, params.id]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Load failed"));
    void apiGet<{ items: UserTypeSummary[] }>("/api/v1/user-types", api)
      .then((data) => setTypes(data.items.filter((item) => item.code !== "OWNER")))
      .catch(() => undefined);
  }, [api, refresh]);

  async function action(path: string, body?: unknown) {
    setMessage("");
    try {
      await apiRequest(path, api, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh();
      setMessage("Updated");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (!user) {
    return <p className="text-sm text-slate-500">{message || "Loading…"}</p>;
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={user.fullName}
        description={user.userCode}
        actions={
          can("Users.Edit") ? (
            <ButtonLink href={`/users/${user.id}/edit`} variant="secondary">
              Edit
            </ButtonLink>
          ) : null
        }
      />
      <dl className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 text-sm md:grid-cols-2">
        <div>
          <dt className="text-slate-500">Employee code</dt>
          <dd>{user.employeeCode}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Mobile</dt>
          <dd>{user.mobile}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Designation</dt>
          <dd>{user.designation ? `${user.designation.code} — ${user.designation.name}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Joining date</dt>
          <dd>{user.joiningDate}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last working date</dt>
          <dd>{user.lastWorkingDate ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Employment</dt>
          <dd>{user.employmentStatus}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Account</dt>
          <dd>{user.accountStatus}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Office</dt>
          <dd>{user.office ? `${user.office.code} — ${user.office.name}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Department</dt>
          <dd>{user.department ? `${user.department.code} — ${user.department.name}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Team</dt>
          <dd>{user.team ? `${user.team.code} — ${user.team.name}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">User type</dt>
          <dd>{user.userType ? `${user.userType.code} — ${user.userType.name}` : "Unassigned"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">MFA enabled</dt>
          <dd>{user.mfaEnabled ? "Yes (not enforced)" : "No"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 text-sm">
        {can("Users.AssignUserType") ? (
          <select
            className={controlClass}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                void action(`/api/v1/users/${user.id}/assign-type`, {
                  user_type_id: event.target.value,
                });
              }
            }}
          >
            <option value="">Assign user type</option>
            {types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}
              </option>
            ))}
          </select>
        ) : null}
        {can("Users.Activate") ? (
          <button className={secondaryButtonClass} type="button" onClick={() => void action(`/api/v1/users/${user.id}/activate`)}>
            Activate
          </button>
        ) : null}
        {can("Users.Deactivate") ? (
          <button className={secondaryButtonClass} type="button" onClick={() => void action(`/api/v1/users/${user.id}/deactivate`)}>
            Deactivate
          </button>
        ) : null}
        {can("Users.Unlock") ? (
          <button className={secondaryButtonClass} type="button" onClick={() => void action(`/api/v1/users/${user.id}/unlock`)}>
            Unlock
          </button>
        ) : null}
        {can("Users.Edit") && user.accountStatus === "deactivated" ? (
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={() =>
              void action(`/api/v1/users/${user.id}/rehire`, {
                joining_date: new Date().toISOString().slice(0, 10),
                employment_status: "Active",
              })
            }
          >
            Rehire
          </button>
        ) : null}
        {can("Users.GenerateSetupLink") ? (
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={async () => {
              try {
                const result = await apiRequest<{ url: string }>(
                  `/api/v1/auth/users/${user.id}/setup-link`,
                  api,
                  { method: "POST" },
                );
                setMessage(`Share this one-time setup link: ${result.url}`);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Failed");
              }
            }}
          >
            Generate setup link
          </button>
        ) : null}
        {can("Users.GenerateResetLink") ? (
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={async () => {
              try {
                const result = await apiRequest<{ url: string }>(
                  `/api/v1/auth/users/${user.id}/reset-link`,
                  api,
                  { method: "POST" },
                );
                setMessage(`Share this one-time reset link: ${result.url}`);
              } catch (err) {
                setMessage(err instanceof Error ? err.message : "Failed");
              }
            }}
          >
            Generate reset link
          </button>
        ) : null}
      </div>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-4 text-sm">
          <h3 className="font-semibold">Employee code history</h3>
          <ul className="mt-2 space-y-1">
            <li>Current: {user.employeeCode}</li>
            {history?.employeeCodes.map((row) => (
              <li key={`${row.employeeCode}-${row.effectiveFrom}`}>
                {row.employeeCode} — {row.effectiveFrom}
                {row.effectiveTo ? ` to ${row.effectiveTo}` : " (current)"}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm">
          <h3 className="font-semibold">Email history</h3>
          <ul className="mt-2 space-y-1">
            <li>Current: {user.email}</li>
            {history?.emails.map((row) => (
              <li key={row.changedAt}>
                {row.email} — {row.changedAt}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {history?.events.length ? (
        <div className="rounded-xl border bg-white p-4 text-sm">
          <h3 className="font-semibold">Audit</h3>
          <ul className="mt-2 space-y-1">
            {history.events.map((event) => (
              <li key={event.id}>
                {event.createdAt}: {event.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
