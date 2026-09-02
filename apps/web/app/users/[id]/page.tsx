"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  ButtonLink,
  EmptyState,
  PageHeader,
  TableHead,
  TableShell,
  Td,
  Th,
  controlClass,
  secondaryButtonClass,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type {
  AssetAllocationRecord,
  AssetRecord,
  UserRecord,
  UserTypeSummary,
} from "@/lib/types";

type History = {
  emails: { email: string; changedAt: string }[];
  employeeCodes: { employeeCode: string; effectiveFrom: string; effectiveTo: string | null }[];
  events: { id: string; action: string; createdAt: string }[];
};

type EmployeeAssets = {
  current: { asset: AssetRecord; allocation: AssetAllocationRecord }[];
  history: { asset: AssetRecord; allocation: AssetAllocationRecord }[];
};

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [types, setTypes] = useState<UserTypeSummary[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [assets, setAssets] = useState<EmployeeAssets | null>(null);
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();

  const refresh = useCallback(async () => {
    const data = await apiGet<UserRecord>(`/api/v1/users/${params.id}`, api);
    setUser(data);
    const hist = await apiGet<History>(`/api/v1/users/${params.id}/history`, api);
    setHistory(hist);
    if (can("Assets.View")) {
      const employeeAssets = await apiGet<EmployeeAssets>(`/api/v1/assets/employees/${params.id}`, api);
      setAssets(employeeAssets);
    }
  }, [api, can, params.id]);

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
    <section className="space-y-4">
      <PageHeader
        title={user.fullName}
        description={user.userCode}
        actions={
          <div className="flex flex-wrap gap-2">
            {can("Dashboard.View") || can("Reports.View") ? (
              <ButtonLink href={`/reports/employees/${user.id}`} variant="secondary">
                Performance profile
              </ButtonLink>
            ) : null}
            {can("Users.Edit") ? (
              <ButtonLink href={`/users/${user.id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
            ) : null}
          </div>
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
          <dd>{user.mfaEnabled ? "Yes" : "No"}</dd>
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
      {can("Assets.View") ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Current Assets</h3>
            <p className="text-sm text-slate-600">
              Active company Asset custody for this employee, including outstanding offboarding items.
            </p>
          </div>
          {assets?.current.length ? (
            <TableShell>
              <TableHead><tr><Th>Asset</Th><Th>Category</Th><Th>Identity</Th><Th>Issue date</Th><Th>Condition</Th><Th>Status</Th></tr></TableHead>
              <tbody>
                {assets.current.map(({ asset, allocation }) => (
                  <tr key={allocation.id} className="border-t border-slate-100">
                    <Td><ButtonLink href={`/assets/${asset.id}`} variant="secondary">{asset.assetCode}</ButtonLink></Td>
                    <Td>{asset.category.name}</Td>
                    <Td>{asset.serialNumber ?? asset.imei ?? asset.iccid ?? asset.mobileNumber ?? asset.model ?? "—"}</Td>
                    <Td>{allocation.issueDate}</Td>
                    <Td>{allocation.conditionAtIssue}</Td>
                    <Td>{asset.outstanding ? "Outstanding" : asset.status}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          ) : (
            <EmptyState>No current Assets are allocated to this employee.</EmptyState>
          )}

          {can("Assets.ViewAudit") ? (
            <>
              <h3 className="text-lg font-semibold text-slate-900">Asset History</h3>
              {assets?.history.length ? (
                <TableShell>
                  <TableHead><tr><Th>Asset</Th><Th>Category</Th><Th>Issue date</Th><Th>Return date</Th><Th>Issue condition</Th><Th>Return condition</Th></tr></TableHead>
                  <tbody>
                    {assets.history.map(({ asset, allocation }) => (
                      <tr key={allocation.id} className="border-t border-slate-100">
                        <Td><ButtonLink href={`/assets/${asset.id}`} variant="secondary">{asset.assetCode}</ButtonLink></Td>
                        <Td>{asset.category.name}</Td>
                        <Td>{allocation.issueDate}</Td>
                        <Td>{allocation.returnDate ?? "—"}</Td>
                        <Td>{allocation.conditionAtIssue}</Td>
                        <Td>{allocation.returnCondition ?? "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              ) : (
                <EmptyState>No returned Asset history is recorded for this employee.</EmptyState>
              )}
            </>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
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
