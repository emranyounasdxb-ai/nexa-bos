"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { ManagerOption, OrgRef } from "@/lib/types";

export default function OrganizationPage() {
  const { can } = useAuth();
  const [offices, setOffices] = useState<OrgRef[]>([]);
  const [departments, setDepartments] = useState<(OrgRef & { officeId?: string })[]>([]);
  const [designations, setDesignations] = useState<OrgRef[]>([]);
  const [teams, setTeams] = useState<OrgRef[]>([]);
  const [leadersByTeam, setLeadersByTeam] = useState<Record<string, ManagerOption[]>>({});
  const [message, setMessage] = useState("");
  const api = getBrowserApiUrl();
  const canManageTeams = can("Teams.Manage");

  const refresh = useCallback(async () => {
    const [officeData, deptData, desigData, teamData] = await Promise.all([
      apiGet<{ items: OrgRef[] }>("/api/v1/offices?includeInactive=true", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/departments?includeInactive=true", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/designations?includeInactive=true", api),
      apiGet<{ items: OrgRef[] }>("/api/v1/teams?includeInactive=true", api),
    ]);
    setOffices(officeData.items);
    setDepartments(deptData.items);
    setDesignations(desigData.items);
    setTeams(teamData.items);
    if (canManageTeams) {
      const leaders = await Promise.all(
        teamData.items.map(async (team) => {
          const data = await apiGet<{ items: ManagerOption[] }>(
            `/api/v1/teams/${team.id}/eligible-leaders`,
            api,
          );
          return [team.id, data.items] as const;
        }),
      );
      setLeadersByTeam(Object.fromEntries(leaders));
    }
  }, [api, canManageTeams]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Load failed"));
  }, [refresh]);

  async function createMaster(path: string, body: Record<string, string>) {
    setMessage("");
    try {
      await apiRequest(path, api, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function assignLeader(teamId: string, userId: string) {
    setMessage("");
    try {
      await apiRequest(`/api/v1/teams/${teamId}/leader`, api, {
        method: "PUT",
        body: JSON.stringify({ user_id: userId || null }),
      });
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Team leader update failed");
    }
  }

  return (
    <section className="space-y-8">
      <h2 className="text-xl font-semibold">Organization masters</h2>
      {message ? <p className="text-sm text-red-700">{message}</p> : null}
      <MasterSection
        title="Offices"
        items={offices}
        canManage={can("Offices.Manage")}
        onCreate={(name, code) => void createMaster("/api/v1/offices", { name, code })}
      />
      <MasterSection
        title="Designations"
        items={designations}
        canManage={can("Designations.Manage")}
        onCreate={(name, code) => void createMaster("/api/v1/designations", { name, code })}
      />
      <section className="space-y-3">
        <h3 className="font-semibold">Departments</h3>
        {can("Departments.Manage") && offices[0] ? (
          <CreateForm
            extra={
              <select id="dept-office" className="rounded-md border px-3 py-2 text-sm" defaultValue={offices[0].id}>
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.code}
                  </option>
                ))}
              </select>
            }
            onCreate={(name, code) => {
              const officeId = (document.getElementById("dept-office") as HTMLSelectElement).value;
              void createMaster("/api/v1/departments", { name, code, office_id: officeId });
            }}
          />
        ) : null}
        <ItemTable items={departments} />
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Teams</h3>
        {canManageTeams && offices[0] && departments[0] ? (
          <CreateForm
            extra={
              <>
                <select id="team-office" className="rounded-md border px-3 py-2 text-sm" defaultValue={offices[0].id}>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.code}
                    </option>
                  ))}
                </select>
                <select
                  id="team-department"
                  className="rounded-md border px-3 py-2 text-sm"
                  defaultValue={departments[0].id}
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.code}
                    </option>
                  ))}
                </select>
              </>
            }
            onCreate={(name, code) => {
              const officeId = (document.getElementById("team-office") as HTMLSelectElement).value;
              const departmentId = (document.getElementById("team-department") as HTMLSelectElement)
                .value;
              void createMaster("/api/v1/teams", {
                name,
                code,
                office_id: officeId,
                department_id: departmentId,
              });
            }}
          />
        ) : null}
        <TeamTable
          items={teams}
          leadersByTeam={leadersByTeam}
          canManage={canManageTeams}
          onAssign={(teamId, userId) => void assignLeader(teamId, userId)}
        />
      </section>
    </section>
  );
}

function MasterSection({
  title,
  items,
  canManage,
  onCreate,
}: {
  title: string;
  items: OrgRef[];
  canManage: boolean;
  onCreate: (name: string, code: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {canManage ? <CreateForm onCreate={onCreate} /> : null}
      <ItemTable items={items} />
    </section>
  );
}

function CreateForm({
  onCreate,
  extra,
}: {
  onCreate: (name: string, code: string) => void;
  extra?: ReactNode;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(name, code);
        setName("");
        setCode("");
      }}
    >
      {extra}
      <input
        className="rounded-md border px-3 py-2 text-sm"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <input
        className="rounded-md border px-3 py-2 text-sm"
        placeholder="Immutable code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        required
      />
      <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white" type="submit">
        Create
      </button>
    </form>
  );
}

function ItemTable({ items }: { items: OrgRef[] }) {
  return (
    <table className="min-w-full rounded-xl border bg-white text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className="px-3 py-2 text-left">Code</th>
          <th className="px-3 py-2 text-left">Name</th>
          <th className="px-3 py-2 text-left">Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-t">
            <td className="px-3 py-2">{item.code}</td>
            <td className="px-3 py-2">{item.name}</td>
            <td className="px-3 py-2">{item.status ?? "active"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamTable({
  items,
  leadersByTeam,
  canManage,
  onAssign,
}: {
  items: OrgRef[];
  leadersByTeam: Record<string, ManagerOption[]>;
  canManage: boolean;
  onAssign: (teamId: string, userId: string) => void;
}) {
  return (
    <table className="min-w-full rounded-xl border bg-white text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className="px-3 py-2 text-left">Code</th>
          <th className="px-3 py-2 text-left">Name</th>
          <th className="px-3 py-2 text-left">Status</th>
          <th className="px-3 py-2 text-left">Team leader</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const leaders = leadersByTeam[item.id] ?? [];
          return (
            <tr key={item.id} className="border-t">
              <td className="px-3 py-2">{item.code}</td>
              <td className="px-3 py-2">{item.name}</td>
              <td className="px-3 py-2">{item.status ?? "active"}</td>
              <td className="px-3 py-2">
                {canManage ? (
                  <select
                    aria-label={`Team leader for ${item.code}`}
                    className="rounded-md border px-2 py-1"
                    value={item.teamLeaderId ?? ""}
                    onChange={(event) => onAssign(item.id, event.target.value)}
                  >
                    <option value="">No team leader</option>
                    {leaders.map((leader) => (
                      <option key={leader.id} value={leader.id}>
                        {leader.userCode} — {leader.fullName}
                      </option>
                    ))}
                  </select>
                ) : (
                  item.teamLeaderId ?? "None"
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
