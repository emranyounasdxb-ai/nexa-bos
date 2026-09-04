"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { IconX } from "@/components/icons";
import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
  useClientPagination,
} from "@/components/pagination";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  Textarea,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Named = { id: string; name: string; employeeCode?: string };
type EventOption = { value: string; category: string };
type Options = {
  categories: string[];
  severities: string[];
  eventTypes: EventOption[];
  targetTypes: string[];
  companyAvailable: boolean;
  users: Named[];
  userTypes: Named[];
  offices: Named[];
  teams: Named[];
};
type Target = { target_type: string; target_id: string | null };
type Rule = {
  id: string;
  name: string;
  eventType: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  acknowledgementRequired: boolean;
  status: string;
  targets: Array<{ targetType: string; targetId: string | null; label: string | null }>;
};
type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  note: string | null;
};

type RuleDraft = {
  name: string;
  event_type: string;
  severity: string;
  title: string;
  message: string;
  acknowledgement_required: boolean;
  targets: Target[];
};

const emptyRule = (): RuleDraft => ({
  name: "",
  event_type: "operations.application_stage_changed",
  severity: "info",
  title: "",
  message: "",
  acknowledgement_required: false,
  targets: [],
});

const friendly = (value: string) =>
  value
    .replaceAll(".", " · ")
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

function targetChoices(options: Options, type: string): Named[] {
  if (type === "affected_user" || type === "reporting_manager") return options.users;
  if (type === "user_type") return options.userTypes;
  if (type === "office") return options.offices;
  if (type === "team") return options.teams;
  return [];
}

function TargetBuilder({
  options,
  targets,
  onChange,
  urgent,
  affectedUserId,
  onAffectedUserChange,
}: {
  options: Options;
  targets: Target[];
  onChange: (targets: Target[]) => void;
  urgent?: boolean;
  affectedUserId?: string;
  onAffectedUserChange?: (value: string) => void;
}) {
  const [targetType, setTargetType] = useState("affected_user");
  const choices = targetChoices(options, targetType);
  const [targetId, setTargetId] = useState("");
  const dynamic = ["affected_user", "reporting_manager", "company"].includes(targetType);

  function addTarget() {
    if (targets.some((item) => item.target_type === targetType && item.target_id === (dynamic ? null : targetId))) {
      return;
    }
    if (!dynamic && !targetId) return;
    onChange([...targets, { target_type: targetType, target_id: dynamic ? null : targetId }]);
    setTargetId("");
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Recipient target">
          <Select value={targetType} onChange={(event) => { setTargetType(event.target.value); setTargetId(""); }}>
            {options.targetTypes
              .filter((item) => options.companyAvailable || item !== "company")
              .map((item) => <option key={item} value={item}>{friendly(item)}</option>)}
          </Select>
        </Field>
        {!dynamic ? (
          <Field label="Target value">
            <Select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">Select target</option>
              {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </Field>
        ) : <div />}
        <div className="flex items-end">
          <Button type="button" variant="secondary" onClick={addTarget}>Add target</Button>
        </div>
      </div>
      {urgent && targets.some((item) => ["affected_user", "reporting_manager"].includes(item.target_type)) ? (
        <Field label="Affected user">
          <Select value={affectedUserId} onChange={(event) => onAffectedUserChange?.(event.target.value)}>
            <option value="">Select affected user</option>
            {options.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {targets.map((item, index) => (
          <Button
            key={`${item.target_type}:${item.target_id ?? "dynamic"}`}
            type="button"
            variant="secondary"
            onClick={() => onChange(targets.filter((_target, targetIndex) => index !== targetIndex))}
          >
            {friendly(item.target_type)}{item.target_id ? " (selected)" : ""}
            <IconX className="size-4" />
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function NotificationManagementPage() {
  const { can, user } = useAuth();
  const salesExecutive = user?.userType?.code === "SE";
  const manageRules = !salesExecutive && can("Notifications.ManageRules");
  const sendUrgent = !salesExecutive && can("Notifications.SendUrgent");
  const viewAudit = !salesExecutive && can("Notifications.ViewAudit");
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<Options | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState<ServerPageSize>(10);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(emptyRule);
  const [urgentDraft, setUrgentDraft] = useState({
    category: "operations",
    title: "",
    message: "",
    acknowledgement_required: false,
    affected_user_id: "",
    targets: [] as Target[],
  });
  const rulesPagination = useClientPagination(rules);

  const load = useCallback(async () => {
    try {
      const requests: Promise<unknown>[] = [];
      if (manageRules || sendUrgent) {
        requests.push(apiGet<Options>("/api/v1/notifications/options", api).then(setOptions));
      }
      if (manageRules) {
        requests.push(apiGet<{ items: Rule[] }>("/api/v1/notifications/rules", api).then((data) => setRules(data.items)));
      }
      if (viewAudit) {
        const query = new URLSearchParams({
          page: String(auditPage),
          page_size: String(auditPageSize),
        });
        requests.push(
          apiGet<PaginatedResponse<AuditItem>>(`/api/v1/notifications/audit?${query}`, api).then(
            (data) => {
              setAudit(data.items);
              setAuditTotal(data.pagination.total);
              setAuditTotalPages(data.pagination.totalPages);
            },
          ),
        );
      }
      await Promise.all(requests);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load notification administration");
    }
  }, [api, auditPage, auditPageSize, manageRules, sendUrgent, viewAudit]);

  useEffect(() => { void load(); }, [load]);

  const selectedCategory = useMemo(
    () => options?.eventTypes.find((item) => item.value === ruleDraft.event_type)?.category,
    [options, ruleDraft.event_type],
  );

  if (!manageRules && !sendUrgent && !viewAudit) {
    return <ErrorText>You do not have permission to administer notifications.</ErrorText>;
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    try {
      const path = editingId ? `/api/v1/notifications/rules/${editingId}` : "/api/v1/notifications/rules";
      await apiRequest(path, api, { method: editingId ? "PUT" : "POST", body: JSON.stringify(ruleDraft) });
      setRuleDraft(emptyRule());
      setEditingId(null);
      setMessage(editingId ? "Notification rule updated." : "Notification rule created as draft.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save notification rule");
    }
  }

  function editRule(rule: Rule) {
    setEditingId(rule.id);
    setRuleDraft({
      name: rule.name,
      event_type: rule.eventType,
      severity: rule.severity,
      title: rule.title,
      message: rule.message,
      acknowledgement_required: rule.acknowledgementRequired,
      targets: rule.targets.map((item) => ({ target_type: item.targetType, target_id: item.targetId })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function changeStatus(rule: Rule) {
    try {
      const action = rule.status === "active" ? "deactivate" : "activate";
      await apiRequest(`/api/v1/notifications/rules/${rule.id}/${action}`, api, { method: "POST" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change notification rule status");
    }
  }

  async function submitUrgent(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest("/api/v1/notifications/urgent", api, {
        method: "POST",
        body: JSON.stringify({ ...urgentDraft, affected_user_id: urgentDraft.affected_user_id || null }),
      });
      setUrgentDraft({ category: "operations", title: "", message: "", acknowledgement_required: false, affected_user_id: "", targets: [] });
      setMessage("Urgent in-app notification sent.");
      window.dispatchEvent(new Event("nexa-notifications-changed"));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send urgent notification");
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader title="Notification administration" description="Configure deterministic in-app alerts, send urgent notices, and review audited actions." />
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-700" aria-live="polite">{message}</p> : null}

      {manageRules && options ? (
        <Card>
          <form className="space-y-4" onSubmit={(event) => void saveRule(event)}>
            <h3 className="font-semibold text-slate-900">{editingId ? "Edit notification rule" : "New notification rule"}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Rule name"><TextInput required maxLength={120} value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} /></Field>
              <Field label="Source event">
                <Select value={ruleDraft.event_type} onChange={(event) => setRuleDraft({ ...ruleDraft, event_type: event.target.value })}>
                  {options.eventTypes.map((item) => <option key={item.value} value={item.value}>{friendly(item.value)}</option>)}
                </Select>
              </Field>
              <Field label="Category"><TextInput value={friendly(selectedCategory ?? "")} disabled /></Field>
              <Field label="Severity">
                <Select value={ruleDraft.severity} onChange={(event) => setRuleDraft({ ...ruleDraft, severity: event.target.value, acknowledgement_required: ["critical", "urgent"].includes(event.target.value) ? ruleDraft.acknowledgement_required : false })}>
                  {options.severities.map((item) => <option key={item} value={item}>{friendly(item)}</option>)}
                </Select>
              </Field>
              <Field label="Notification title"><TextInput required maxLength={200} value={ruleDraft.title} onChange={(event) => setRuleDraft({ ...ruleDraft, title: event.target.value })} /></Field>
              <Field label="Notification message"><Textarea required maxLength={1000} value={ruleDraft.message} onChange={(event) => setRuleDraft({ ...ruleDraft, message: event.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input type="checkbox" disabled={!(["critical", "urgent"].includes(ruleDraft.severity))} checked={ruleDraft.acknowledgement_required} onChange={(event) => setRuleDraft({ ...ruleDraft, acknowledgement_required: event.target.checked })} /> Require acknowledgement
            </label>
            <TargetBuilder options={options} targets={ruleDraft.targets} onChange={(targets) => setRuleDraft({ ...ruleDraft, targets })} />
            <div className="flex gap-2">
              <Button type="submit" disabled={ruleDraft.targets.length === 0}>{editingId ? "Save rule changes" : "Create draft rule"}</Button>
              {editingId ? <Button type="button" variant="secondary" onClick={() => { setEditingId(null); setRuleDraft(emptyRule()); }}>Cancel edit</Button> : null}
            </div>
          </form>
        </Card>
      ) : null}

      {manageRules ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900">Notification rules</h3>
          {rules.length === 0 ? <Card><EmptyState>No notification rules have been configured.</EmptyState></Card> : (
            <><TableShell className="rounded-b-none"><TableHead><tr><Th>Name</Th><Th>Event</Th><Th>Category</Th><Th>Severity</Th><Th>Status</Th><Th>Actions</Th></tr></TableHead><tbody>
              {rulesPagination.pagedItems.map((rule) => <tr key={rule.id} className="border-t border-slate-100"><Td>{rule.name}</Td><Td>{friendly(rule.eventType)}</Td><Td>{friendly(rule.category)}</Td><Td><Badge>{friendly(rule.severity)}</Badge></Td><Td><Badge>{friendly(rule.status)}</Badge></Td><Td><div className="flex gap-1.5"><Button type="button" variant="secondary" size="compact" onClick={() => editRule(rule)}>Edit</Button><Button type="button" variant="secondary" size="compact" onClick={() => void changeStatus(rule)}>{rule.status === "active" ? "Deactivate" : "Activate"}</Button></div></Td></tr>)}
            </tbody></TableShell>
            <Pagination className="-mt-3 rounded-b-[10px] border border-slate-200" page={rulesPagination.page} pageSize={rulesPagination.pageSize} total={rulesPagination.total} totalPages={rulesPagination.totalPages} onPageChange={rulesPagination.setPage} onPageSizeChange={rulesPagination.setPageSize} /></>
          )}
        </div>
      ) : null}

      {sendUrgent && options ? (
        <Card>
          <form className="space-y-4" onSubmit={(event) => void submitUrgent(event)}>
            <h3 className="font-semibold text-slate-900">Send urgent in-app notification</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Urgent category"><Select value={urgentDraft.category} onChange={(event) => setUrgentDraft({ ...urgentDraft, category: event.target.value })}>{options.categories.map((item) => <option key={item} value={item}>{friendly(item)}</option>)}</Select></Field>
              <Field label="Urgent title"><TextInput required maxLength={200} value={urgentDraft.title} onChange={(event) => setUrgentDraft({ ...urgentDraft, title: event.target.value })} /></Field>
              <Field label="Urgent message" className="md:col-span-2"><Textarea required maxLength={1000} value={urgentDraft.message} onChange={(event) => setUrgentDraft({ ...urgentDraft, message: event.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-900"><input type="checkbox" checked={urgentDraft.acknowledgement_required} onChange={(event) => setUrgentDraft({ ...urgentDraft, acknowledgement_required: event.target.checked })} /> Require acknowledgement</label>
            <TargetBuilder options={options} urgent targets={urgentDraft.targets} affectedUserId={urgentDraft.affected_user_id} onAffectedUserChange={(affected_user_id) => setUrgentDraft({ ...urgentDraft, affected_user_id })} onChange={(targets) => setUrgentDraft({ ...urgentDraft, targets })} />
            <Button type="submit" disabled={urgentDraft.targets.length === 0}>Send urgent notification</Button>
          </form>
        </Card>
      ) : null}

      {viewAudit ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900">Notification audit</h3>
          {audit.length === 0 ? <Card><EmptyState>No notification administration audit events are available.</EmptyState></Card> : (
            <TableShell><TableHead><tr><Th>Timestamp</Th><Th>Action</Th><Th>Entity</Th><Th>Note</Th></tr></TableHead><tbody>
              {audit.map((item) => <tr key={item.id} className="border-t border-slate-100"><Td>{new Date(item.createdAt).toLocaleString()}</Td><Td>{item.action}</Td><Td>{item.entityType} · {item.entityId}</Td><Td>{item.note ?? "—"}</Td></tr>)}
            </tbody></TableShell>
          )}
          <Pagination
            page={auditPage}
            pageSize={auditPageSize}
            total={auditTotal}
            totalPages={auditTotalPages}
            pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS}
            onPageChange={setAuditPage}
            onPageSizeChange={(value) => {
              if (value !== "all") setAuditPageSize(value);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
