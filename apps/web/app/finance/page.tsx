"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  IconChevronDown,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconPrinter,
  IconRefresh,
  IconX,
} from "@/components/icons";
import {
  PaginatedResponse,
  Pagination,
  SERVER_PAGE_SIZE_OPTIONS,
  ServerPageSize,
  useClientPagination,
} from "@/components/pagination";
import {
  Badge,
  Button,
  Card,
  cx,
  DialogPanel,
  EmptyState,
  ErrorText,
  Field,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  TableHead,
  TableShell,
  Td,
  Textarea,
  TextInput,
  Th,
} from "@/components/ui";
import { apiDownload, apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { formatAed } from "@/lib/reports";

type Named = { id: string; code: string; name: string };
type Options = {
  banks: Named[];
  products: Named[];
  eligibilityMilestones: string[];
  calculationMethods: string[];
  payoutModes: string[];
};
type SlabDraft = {
  minimum: string;
  maximum: string;
  payout: string;
  sort_order: number;
};
type RecipientDraft = {
  role_code: string;
  role_name: string;
  recipient_source: "case_owner" | "reporting_manager";
  hierarchy_level: string;
  sort_order: number;
  split_percent: string;
  calculation_method: string;
  fixed_amount: string;
  percentage_rate: string;
  flat_amount: string;
  slabs: SlabDraft[];
};
type Rule = {
  id: string;
  bankName: string;
  productName: string;
  eligibilityMilestone: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  payoutMode: string;
  recipients: Array<{ roleName: string; recipientSource: string; hierarchyLevel: number | null }>;
};
type Payout = {
  id: string;
  recipientId: string;
  recipientCode: string;
  recipientName: string;
  previousCarryForward: string;
  commission: string;
  incentive: string;
  clawback: string;
  adjustment: string;
  finalPayable: string;
  carryForward: string;
};
type StatementItem = Omit<Payout, "id"> & {
  payoutId: string;
  eligibleCases: number;
  eligibleValue: string;
  grossAmount: string;
};
type Period = {
  id: string;
  periodMonth: string;
  status: string;
  reportingScope: string | null;
  payouts: Payout[];
};
type Component = {
  id: string;
  applicationId: string | null;
  applicationCode: string | null;
  componentType: string;
  amount: string;
  eligibleAmount: string | null;
  roleName: string | null;
  reason: string | null;
};
type IncentivePlan = {
  id: string;
  name: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  slabs: Array<{
    minimumProduction: string;
    maximumProduction: string | null;
    payoutAmount: string;
  }>;
};
type FinanceTab = "payouts" | "commission-rules" | "incentive-plans";
type Drawer = "commission-rule" | "incentive-plan" | null;
type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  path: string;
  success: string;
  body?: object;
  danger?: boolean;
};

const newSlab = (index: number): SlabDraft => ({
  minimum: "",
  maximum: "",
  payout: "",
  sort_order: index,
});

const newRecipient = (index: number): RecipientDraft => ({
  role_code: index === 0 ? "case_owner" : `manager_${index}`,
  role_name: index === 0 ? "Case Owner" : `Manager ${index}`,
  recipient_source: index === 0 ? "case_owner" : "reporting_manager",
  hierarchy_level: index === 0 ? "" : String(index),
  sort_order: index,
  split_percent: index === 0 ? "100" : "",
  calculation_method: "fixed",
  fixed_amount: "",
  percentage_rate: "",
  flat_amount: "",
  slabs: [],
});

const monthFirst = (value: string) => (value ? `${value.slice(0, 7)}-01` : "");

const validNonNegative = (value: string) =>
  value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;

function slabValidation(slabs: SlabDraft[]): string | null {
  if (!slabs.length) return "Add at least one slab.";
  const parsed = slabs.map((slab) => ({
    minimum: Number(slab.minimum),
    maximum: slab.maximum === "" ? null : Number(slab.maximum),
    payout: Number(slab.payout),
  }));
  if (
    slabs.some(
      (slab, index) =>
        !validNonNegative(slab.minimum) ||
        !validNonNegative(slab.payout) ||
        (slab.maximum !== "" && !validNonNegative(slab.maximum)) ||
        (parsed[index].maximum !== null && parsed[index].maximum! < parsed[index].minimum),
    )
  ) {
    return "Every slab needs valid non-negative values, and a maximum cannot be below its minimum.";
  }
  for (let index = 0; index < parsed.length; index += 1) {
    for (let other = index + 1; other < parsed.length; other += 1) {
      const first = parsed[index];
      const second = parsed[other];
      const overlaps =
        (first.maximum === null || second.minimum <= first.maximum) &&
        (second.maximum === null || first.minimum <= second.maximum);
      if (overlaps) return "Slab ranges cannot overlap or be ambiguous.";
    }
  }
  return null;
}

function calculationValidation(
  method: string,
  fixedAmount: string,
  percentageRate: string,
  flatAmount: string,
  slabs: SlabDraft[],
): string | null {
  if (method === "fixed" && !validNonNegative(fixedAmount)) return "Enter a valid fixed amount.";
  if (method === "percentage" && !validNonNegative(percentageRate)) return "Enter a valid rate.";
  if (
    method === "flat_percentage" &&
    (!validNonNegative(flatAmount) || !validNonNegative(percentageRate))
  ) {
    return "Enter valid flat amount and rate values.";
  }
  if (method === "slab") return slabValidation(slabs);
  return null;
}

function SlabEditor({
  slabs,
  onChange,
  basis,
  showAdd = true,
}: {
  slabs: SlabDraft[];
  onChange: (slabs: SlabDraft[]) => void;
  basis: "eligible" | "production";
  showAdd?: boolean;
}) {
  const label = basis === "eligible" ? "eligible value" : "production";
  return (
    <div className="space-y-2">
      {slabs.map((slab, index) => (
        <div key={slab.sort_order} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slab {index + 1}</p>
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() =>
                onChange(
                  slabs
                    .filter((_, i) => i !== index)
                    .map((row, i) => ({ ...row, sort_order: i })),
                )
              }
            >
              Remove
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
          <Field label={`Minimum ${label}`}>
            <TextInput
              inputMode="decimal"
              value={slab.minimum}
              onChange={(event) =>
                onChange(slabs.map((row, i) => (i === index ? { ...row, minimum: event.target.value } : row)))
              }
            />
          </Field>
          <Field label={`Maximum ${label} (optional)`}>
            <TextInput
              inputMode="decimal"
              value={slab.maximum}
              onChange={(event) =>
                onChange(slabs.map((row, i) => (i === index ? { ...row, maximum: event.target.value } : row)))
              }
            />
          </Field>
          <Field label="Payout amount">
            <TextInput
              inputMode="decimal"
              value={slab.payout}
              onChange={(event) =>
                onChange(slabs.map((row, i) => (i === index ? { ...row, payout: event.target.value } : row)))
              }
            />
          </Field>
          </div>
        </div>
      ))}
      {showAdd ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...slabs, newSlab(slabs.length)])}
        >
          Add slab
        </Button>
      ) : null}
    </div>
  );
}

export default function FinancePage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [options, setOptions] = useState<Options | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [plans, setPlans] = useState<IncentivePlan[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [statementItems, setStatementItems] = useState<StatementItem[]>([]);
  const [statementPage, setStatementPage] = useState(1);
  const [statementPageSize, setStatementPageSize] = useState<ServerPageSize>(10);
  const [statementTotal, setStatementTotal] = useState(0);
  const [statementTotalPages, setStatementTotalPages] = useState(0);
  const [statementLoading, setStatementLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [components, setComponents] = useState<Component[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<FinanceTab>("payouts");
  const [exportOpen, setExportOpen] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [saving, setSaving] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");
  const [planSearch, setPlanSearch] = useState("");
  const drawerReturnFocus = useRef<HTMLElement | null>(null);
  const [month, setMonth] = useState(monthFirst(new Date().toISOString().slice(0, 10)));
  const [bankId, setBankId] = useState("");
  const [productId, setProductId] = useState("");
  const [milestone, setMilestone] = useState("booked");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [payoutMode, setPayoutMode] = useState("percentage_split");
  const [calculationMethod, setCalculationMethod] = useState("fixed");
  const [fixedAmount, setFixedAmount] = useState("");
  const [percentageRate, setPercentageRate] = useState("");
  const [flatAmount, setFlatAmount] = useState("");
  const [sharedSlabs, setSharedSlabs] = useState<SlabDraft[]>([]);
  const [recipients, setRecipients] = useState<RecipientDraft[]>([newRecipient(0)]);
  const [planName, setPlanName] = useState("");
  const [planFrom, setPlanFrom] = useState(new Date().toISOString().slice(0, 10));
  const [planTo, setPlanTo] = useState("");
  const [planSlabs, setPlanSlabs] = useState<SlabDraft[]>([newSlab(0)]);
  const [reopenReason, setReopenReason] = useState("");
  const [adjustApplication, setAdjustApplication] = useState("");
  const [adjustRecipient, setAdjustRecipient] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [clawbackOriginal, setClawbackOriginal] = useState("");
  const [clawbackAmount, setClawbackAmount] = useState("");
  const [clawbackReason, setClawbackReason] = useState("");
  const filteredRules = useMemo(() => {
    const query = ruleSearch.trim().toLowerCase();
    if (!query) return rules;
    return rules.filter((rule) =>
      [
        rule.bankName,
        rule.productName,
        rule.eligibilityMilestone,
        rule.status,
        rule.payoutMode,
        ...rule.recipients.flatMap((recipient) => [recipient.roleName, recipient.recipientSource]),
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [ruleSearch, rules]);
  const filteredPlans = useMemo(() => {
    const query = planSearch.trim().toLowerCase();
    if (!query) return plans;
    return plans.filter((plan) =>
      [plan.name, plan.status, String(plan.version), plan.effectiveFrom, plan.effectiveTo ?? ""].some(
        (value) => value.toLowerCase().includes(query),
      ),
    );
  }, [planSearch, plans]);
  const rulesPagination = useClientPagination(filteredRules);
  const plansPagination = useClientPagination(filteredPlans);

  const availableTabs = useMemo(
    () => [
      ...(can("Finance.View") ? (["payouts"] as FinanceTab[]) : []),
      ...(can("Finance.ViewCommissionRules")
        ? (["commission-rules", "incentive-plans"] as FinanceTab[])
        : []),
    ],
    [can],
  );

  useEffect(() => {
    if (!availableTabs.length) return;
    const syncTabFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get("tab") as FinanceTab | null;
      setActiveTab(requested && availableTabs.includes(requested) ? requested : availableTabs[0]);
    };
    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, [availableTabs]);

  useEffect(() => {
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (!drawerDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () => window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [drawerDirty]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (exportOpen) {
        setExportOpen(false);
        return;
      }
      if (!drawer || discardConfirmOpen) return;
      if (drawerDirty) setDiscardConfirmOpen(true);
      else {
        setDrawer(null);
        window.setTimeout(() => {
          drawerReturnFocus.current?.focus();
          drawerReturnFocus.current = null;
        }, 0);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [discardConfirmOpen, drawer, drawerDirty, exportOpen]);

  const load = useCallback(async () => {
    setError("");
    try {
      if (can("Finance.ViewCommissionRules")) {
        const [nextOptions, nextRules, nextPlans] = await Promise.all([
          apiGet<Options>("/api/v1/finance/options", api),
          apiGet<{ items: Rule[] }>("/api/v1/finance/commission-rules", api),
          apiGet<{ items: IncentivePlan[] }>("/api/v1/finance/incentive-plans", api),
        ]);
        setOptions(nextOptions);
        setRules(nextRules.items);
        setPlans(nextPlans.items);
        setBankId((current) => current || nextOptions.banks[0]?.id || "");
        setProductId((current) => current || nextOptions.products[0]?.id || "");
      }
      if (can("Finance.View")) {
        const nextPeriods = await apiGet<{ items: Period[] }>(
          "/api/v1/finance/periods?include_payouts=false",
          api,
        );
        setPeriods(nextPeriods.items);
        if (nextPeriods.items.some((item) => item.periodMonth === month)) {
          setStatementLoading(true);
          try {
            const statement = await apiGet<PaginatedResponse<StatementItem>>(
              `/api/v1/finance/statements?period_month=${encodeURIComponent(month)}&page=${statementPage}&page_size=${statementPageSize}`,
              api,
            );
            setStatementItems(statement.items);
            setStatementPage(statement.pagination.page);
            setStatementTotal(statement.pagination.total);
            setStatementTotalPages(statement.pagination.totalPages);
          } finally {
            setStatementLoading(false);
          }
        } else {
          setStatementItems([]);
          setStatementTotal(0);
          setStatementTotalPages(0);
        }
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load Finance");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, can, month, statementPage, statementPageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
  }

  async function action(path: string, success: string, body?: object) {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await apiRequest(path, api, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setMessage(success);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Finance action failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createRule() {
    const independent = payoutMode === "independent_role_rate";
    const serializeSlabs = (slabs: SlabDraft[]) =>
      slabs.map((slab) => ({
        minimum_eligible: slab.minimum,
        maximum_eligible: slab.maximum || null,
        payout_amount: slab.payout,
        sort_order: slab.sort_order,
      }));
    const created = await action("/api/v1/finance/commission-rules", "Commission rule version created.", {
      bank_id: bankId,
      product_id: productId,
      eligibility_milestone: milestone,
      effective_from: effectiveFrom,
      effective_to: effectiveTo || null,
      payout_mode: payoutMode,
      calculation_method: independent ? null : calculationMethod,
      fixed_amount: !independent && calculationMethod === "fixed" ? fixedAmount : null,
      percentage_rate:
        !independent && ["percentage", "flat_percentage"].includes(calculationMethod)
          ? percentageRate
          : null,
      flat_amount:
        !independent && calculationMethod === "flat_percentage" ? flatAmount : null,
      slabs:
        !independent && calculationMethod === "slab" ? serializeSlabs(sharedSlabs) : [],
      recipients: recipients.map((item) => ({
        role_code: item.role_code,
        role_name: item.role_name,
        recipient_source: item.recipient_source,
        hierarchy_level:
          item.recipient_source === "reporting_manager" ? Number(item.hierarchy_level) : null,
        sort_order: item.sort_order,
        split_percent: independent ? null : item.split_percent,
        calculation_method: independent ? item.calculation_method : null,
        fixed_amount:
          independent && item.calculation_method === "fixed" ? item.fixed_amount : null,
        percentage_rate:
          independent && ["percentage", "flat_percentage"].includes(item.calculation_method)
            ? item.percentage_rate
            : null,
        flat_amount:
          independent && item.calculation_method === "flat_percentage" ? item.flat_amount : null,
        slabs:
          independent && item.calculation_method === "slab" ? serializeSlabs(item.slabs) : [],
      })),
    });
    if (created) {
      closeDrawer("reset");
    }
  }

  async function createIncentivePlan() {
    const created = await action("/api/v1/finance/incentive-plans", "Incentive plan version created.", {
      name: planName,
      effective_from: planFrom,
      effective_to: planTo || null,
      slabs: planSlabs.map((slab) => ({
        minimum_production: slab.minimum,
        maximum_production: slab.maximum || null,
        payout_amount: slab.payout,
        sort_order: slab.sort_order,
      })),
    });
    if (created) {
      closeDrawer("reset");
    }
  }

  async function loadComponents(payoutId: string) {
    setError("");
    try {
      const data = await apiGet<{ items: Component[] }>(
        `/api/v1/finance/payouts/${payoutId}/components`,
        api,
      );
      setComponents(data.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load drill-down");
    }
  }

  async function exportStatement(format: "xlsx" | "pdf" | "print") {
    setError("");
    try {
      const result = await apiDownload("/api/v1/finance/export", api, {
        method: "POST",
        body: JSON.stringify({ format, period_month: month, recipient_id: null }),
      });
      if (format === "print") {
        const url = URL.createObjectURL(result.blob);
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? `amafh-core-finance.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Finance export failed");
    } finally {
      setExportOpen(false);
    }
  }

  function selectTab(tab: FinanceTab) {
    setActiveTab(tab);
    setExportOpen(false);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function openDrawer(nextDrawer: Exclude<Drawer, null>) {
    setError("");
    setMessage("");
    setDrawerDirty(false);
    drawerReturnFocus.current = document.activeElement as HTMLElement | null;
    setDrawer(nextDrawer);
  }

  function closeDrawer(mode: "preserve" | "reset" = "preserve") {
    if (mode === "reset") {
      if (drawer === "commission-rule") {
        setMilestone("booked");
        setEffectiveFrom(new Date().toISOString().slice(0, 10));
        setEffectiveTo("");
        setPayoutMode("percentage_split");
        setCalculationMethod("fixed");
        setFixedAmount("");
        setPercentageRate("");
        setFlatAmount("");
        setSharedSlabs([]);
        setRecipients([newRecipient(0)]);
      } else if (drawer === "incentive-plan") {
        setPlanName("");
        setPlanFrom(new Date().toISOString().slice(0, 10));
        setPlanTo("");
        setPlanSlabs([newSlab(0)]);
      }
    }
    setDrawerDirty(false);
    setDrawer(null);
    window.setTimeout(() => {
      drawerReturnFocus.current?.focus();
      drawerReturnFocus.current = null;
    }, 0);
  }

  function requestDrawerClose() {
    if (drawerDirty) setDiscardConfirmOpen(true);
    else closeDrawer();
  }

  function updateRecipient(index: number, patch: Partial<RecipientDraft>) {
    setDrawerDirty(true);
    setRecipients((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  const ruleValidation = (() => {
    if (!bankId || !productId) return "Choose a bank and product.";
    if (!effectiveFrom) return "Choose an effective-from date.";
    if (effectiveTo && effectiveTo < effectiveFrom) return "Effective To cannot be before Effective From.";
    if (!recipients.length) return "Add at least one recipient role.";
    const roleCodes = new Set<string>();
    for (const recipient of recipients) {
      const code = recipient.role_code.trim().toLowerCase();
      if (!code || !/^[a-z0-9_.-]+$/i.test(code)) return "Every recipient needs a valid role code.";
      if (!recipient.role_name.trim()) return "Every recipient needs a display label.";
      if (roleCodes.has(code)) return "Recipient role codes must be unique.";
      roleCodes.add(code);
      if (
        recipient.recipient_source === "reporting_manager" &&
        (!Number.isInteger(Number(recipient.hierarchy_level)) ||
          Number(recipient.hierarchy_level) < 1 ||
          Number(recipient.hierarchy_level) > 20)
      ) {
        return "Reporting Manager recipients need a manager level from 1 to 20.";
      }
    }
    if (payoutMode === "percentage_split") {
      const invalidSplit = recipients.some(
        (recipient) =>
          !Number.isFinite(Number(recipient.split_percent)) ||
          Number(recipient.split_percent) <= 0 ||
          Number(recipient.split_percent) > 100,
      );
      if (invalidSplit) return "Every recipient split must be greater than 0% and no more than 100%.";
      const total = recipients.reduce((sum, recipient) => sum + Number(recipient.split_percent), 0);
      if (Math.abs(total - 100) > 0.000001) return "Percentage Split recipients must total exactly 100%.";
      return calculationValidation(calculationMethod, fixedAmount, percentageRate, flatAmount, sharedSlabs);
    }
    for (const recipient of recipients) {
      const issue = calculationValidation(
        recipient.calculation_method,
        recipient.fixed_amount,
        recipient.percentage_rate,
        recipient.flat_amount,
        recipient.slabs,
      );
      if (issue) return `${recipient.role_name || "Recipient"}: ${issue}`;
    }
    return null;
  })();

  const planValidation = (() => {
    if (!planName.trim()) return "Enter a plan name.";
    if (!planFrom) return "Choose an effective-from date.";
    if (planTo && planTo < planFrom) return "Effective To cannot be before Effective From.";
    return slabValidation(planSlabs);
  })();

  if (!can("Finance.View") && !can("Finance.ViewCommissionRules")) {
    return (
      <section>
        <PageHeader title="Finance" />
        <EmptyState>You do not have permission to access Finance.</EmptyState>
      </section>
    );
  }

  const selectedPeriod = periods.find((item) => item.periodMonth === month);
  const payoutRows = statementItems.map((item) => ({ ...item, id: item.payoutId }));
  const currentTab = availableTabs.includes(activeTab) ? activeTab : availableTabs[0];
  const splitTotal = recipients.reduce((sum, recipient) => sum + (Number(recipient.split_percent) || 0), 0);

  return (
    <section className="min-w-0 space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-sm text-slate-600">
            Manage monthly payouts, effective-dated commission rules, and non-progressive incentive plans.
          </p>
          <Badge>{currentTab === "payouts" ? "Monthly operations" : "Versioned configuration"}</Badge>
        </div>
        <div
          role="tablist"
          aria-label="Finance workspace"
          className="flex overflow-x-auto px-2"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = availableTabs.indexOf(currentTab);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? availableTabs.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % availableTabs.length
                    : (index - 1 + availableTabs.length) % availableTabs.length;
            const next = availableTabs[nextIndex];
            selectTab(next);
            document.getElementById(`finance-tab-${next}`)?.focus();
          }}
        >
          {availableTabs.map((tab) => {
            const labels: Record<FinanceTab, string> = {
              payouts: "Payouts",
              "commission-rules": "Commission Rules",
              "incentive-plans": "Incentive Plans",
            };
            const selected = currentTab === tab;
            return (
              <button
                key={tab}
                id={`finance-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`finance-panel-${tab}`}
                tabIndex={selected ? 0 : -1}
                className={cx(
                  "h-10 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0f4c81]",
                  selected
                    ? "border-[#0f4c81] text-[#0f4c81]"
                    : "border-transparent text-slate-600 hover:text-slate-900",
                )}
                onClick={() => selectTab(tab)}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </Card>

      <div aria-live="polite" className="space-y-2">
        <ErrorText>{error}</ErrorText>
        {message ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
      </div>

      {loading ? <LoadingState>Loading Finance workspace…</LoadingState> : null}

      {!loading && currentTab === "payouts" ? (
        <div id="finance-panel-payouts" role="tabpanel" aria-labelledby="finance-tab-payouts" className="space-y-4">
          <Card className="p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
                <Field label="Payout month" className="w-full sm:w-56">
                  <DatePicker
                    aria-label="Finance payout month"
                    value={month}
                    onChange={(value) => {
                      setStatementPage(1);
                      setComponents([]);
                      setMonth(monthFirst(value));
                    }}
                  />
                </Field>
                {can("Finance.GeneratePayout") && !selectedPeriod ? (
                  <div>
                    <Button
                      type="button"
                      disabled={!month || saving}
                      title={!month ? "Choose a payout month before generating." : undefined}
                      onClick={() =>
                        setConfirmation({
                          title: "Generate payout period?",
                          description: `Generate ${month.slice(0, 7)} as a Draft payout period using the existing active Finance configuration.`,
                          confirmLabel: "Generate payout",
                          path: `/api/v1/finance/periods/${month}/generate`,
                          success: "Payout period generated in Draft.",
                        })
                      }
                    >
                      Generate payout
                    </Button>
                    {!month ? <p className="mt-1 text-xs text-slate-500">Choose a month to enable generation.</p> : null}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedPeriod ? <StatusBadge value={selectedPeriod.status} /> : null}
                {selectedPeriod?.status === "draft" && can("Finance.Review") ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setConfirmation({
                        title: "Submit payout for review?",
                        description: `Move ${month.slice(0, 7)} from Draft to Review.`,
                        confirmLabel: "Submit for review",
                        path: `/api/v1/finance/periods/${month}/review`,
                        success: "Payout period moved to Review.",
                      })
                    }
                  >
                    Submit for review
                  </Button>
                ) : null}
                {selectedPeriod?.status === "review" && can("Finance.Finalize") ? (
                  <Button
                    type="button"
                    onClick={() =>
                      setConfirmation({
                        title: "Finalize and lock payout?",
                        description: `Finalize ${month.slice(0, 7)} and lock its Finance components.`,
                        confirmLabel: "Finalize / Lock",
                        path: `/api/v1/finance/periods/${month}/finalize`,
                        success: "Payout period finalized and locked.",
                      })
                    }
                  >
                    Finalize / Lock
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void refresh()}>
                  <IconRefresh className={cx("size-4", refreshing && "animate-spin")} />
                  Refresh
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="secondary"
                    aria-haspopup="menu"
                    aria-expanded={exportOpen}
                    aria-controls="finance-export-menu"
                    disabled={!selectedPeriod}
                    title={!selectedPeriod ? "Generate or select an existing payout period to export." : undefined}
                    onClick={() => setExportOpen((open) => !open)}
                  >
                    Export
                    <IconChevronDown className={cx("size-4 transition-transform", exportOpen && "rotate-180")} />
                  </Button>
                  {exportOpen ? (
                    <div
                      id="finance-export-menu"
                      role="menu"
                      className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                    >
                      <button role="menuitem" type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0f4c81]" onClick={() => void exportStatement("xlsx")}><IconFileSpreadsheet className="size-4" />Excel</button>
                      <button role="menuitem" type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0f4c81]" onClick={() => void exportStatement("pdf")}><IconFileTypePdf className="size-4" />PDF</button>
                      <button role="menuitem" type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0f4c81]" onClick={() => void exportStatement("print")}><IconPrinter className="size-4" />Print</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>

          {!month ? (
            <Card><EmptyState>Choose a payout month to view or generate its statement.</EmptyState></Card>
          ) : statementLoading ? (
            <LoadingState>Loading payout statement…</LoadingState>
          ) : payoutRows.length ? (
            <div aria-busy={statementLoading}>
              <TableShell>
                <TableHead><tr><Th>Recipient</Th><Th>Eligible cases</Th><Th>Eligible value</Th><Th>Commission</Th><Th>Incentive</Th><Th>Clawback</Th><Th>Adjustment</Th><Th>Previous carry</Th><Th>Gross</Th><Th>Payable</Th><Th>Next carry</Th><Th>Drill-down</Th></tr></TableHead>
                <tbody>
                  {payoutRows.map((payout) => (
                    <tr key={payout.id}>
                      <Td>{payout.recipientName} ({payout.recipientCode})</Td><Td>{payout.eligibleCases}</Td><Td>{formatAed(payout.eligibleValue)}</Td><Td>{formatAed(payout.commission)}</Td><Td>{formatAed(payout.incentive)}</Td><Td>{formatAed(payout.clawback)}</Td><Td>{formatAed(payout.adjustment)}</Td><Td>{formatAed(payout.previousCarryForward)}</Td><Td>{formatAed(payout.grossAmount)}</Td><Td>{formatAed(payout.finalPayable)}</Td><Td>{formatAed(payout.carryForward)}</Td>
                      <Td><Button type="button" variant="secondary" size="compact" onClick={() => void loadComponents(payout.id)}>Components</Button></Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          ) : (
            <Card><EmptyState>{selectedPeriod ? "No payout rows exist for the selected month." : "No payout period exists for the selected month."}</EmptyState></Card>
          )}

          {selectedPeriod && statementTotalPages > 1 ? (
            <Pagination page={statementPage} pageSize={statementPageSize} pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS} total={statementTotal} totalPages={statementTotalPages} onPageChange={setStatementPage} onPageSizeChange={(nextPageSize) => { setStatementPage(1); setStatementPageSize(nextPageSize as ServerPageSize); }} />
          ) : null}

          {components.length ? (
            <Card>
              <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-900">Finance component drill-down</h2><Button type="button" variant="ghost" size="compact" onClick={() => setComponents([])}>Close</Button></div>
              <TableShell><TableHead><tr><Th>Application</Th><Th>Component</Th><Th>Role</Th><Th>Eligible value</Th><Th>Amount</Th><Th>Reason</Th></tr></TableHead><tbody>{components.map((item) => <tr key={item.id}><Td>{item.applicationCode ?? "Monthly"}</Td><Td>{item.componentType}</Td><Td>{item.roleName ?? "—"}</Td><Td>{item.eligibleAmount ? formatAed(item.eligibleAmount) : "—"}</Td><Td>{formatAed(item.amount)}</Td><Td>{item.reason ?? "—"}</Td></tr>)}</tbody></TableShell>
            </Card>
          ) : null}

          {selectedPeriod && selectedPeriod.status !== "finalized" && can("Finance.EditAdjustment") ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><h2 className="text-sm font-semibold text-slate-900">Adjustment</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Application ID"><TextInput value={adjustApplication} onChange={(event) => setAdjustApplication(event.target.value)} /></Field><Field label="Recipient ID"><TextInput value={adjustRecipient} onChange={(event) => setAdjustRecipient(event.target.value)} /></Field><Field label="Amount (+/-)"><TextInput value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} /></Field><Field label="Reason" className="sm:col-span-2"><Textarea value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} /></Field><Button type="button" disabled={saving} onClick={() => void action(`/api/v1/finance/periods/${month}/adjustments`, "Adjustment recorded.", { application_id: adjustApplication, recipient_id: adjustRecipient, amount: adjustAmount, reason: adjustReason })}>Record adjustment</Button></div></Card>
              <Card><h2 className="text-sm font-semibold text-slate-900">Clawback</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Original component ID" className="sm:col-span-2"><TextInput value={clawbackOriginal} onChange={(event) => setClawbackOriginal(event.target.value)} /></Field><Field label="Amount"><TextInput value={clawbackAmount} onChange={(event) => setClawbackAmount(event.target.value)} /></Field><Field label="Reason" className="sm:col-span-2"><Textarea value={clawbackReason} onChange={(event) => setClawbackReason(event.target.value)} /></Field><Button type="button" disabled={saving} onClick={() => void action(`/api/v1/finance/periods/${month}/clawbacks`, "Clawback recorded in the current month.", { original_component_id: clawbackOriginal, amount: clawbackAmount, reason: clawbackReason })}>Record clawback</Button></div></Card>
            </div>
          ) : null}

          {selectedPeriod?.status === "finalized" && can("Finance.ReopenPeriod") ? (
            <Card><h2 className="text-sm font-semibold text-slate-900">Reopen finalized period</h2><Field label="Mandatory reason" className="mt-3"><Textarea value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /></Field><Button className="mt-3" type="button" disabled={!reopenReason.trim()} onClick={() => setConfirmation({ title: "Reopen finalized period?", description: "Return this locked period to Review without regenerating its Finance components.", confirmLabel: "Reopen to Review", path: `/api/v1/finance/periods/${month}/reopen`, success: "Period reopened to Review without regeneration.", body: { reason: reopenReason } })}>Reopen to Review</Button></Card>
          ) : null}
        </div>
      ) : null}

      {!loading && currentTab === "commission-rules" ? (
        <div id="finance-panel-commission-rules" role="tabpanel" aria-labelledby="finance-tab-commission-rules" className="space-y-4">
          <Card className="p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Search commission rules" className="min-w-0 flex-1"><TextInput value={ruleSearch} onChange={(event) => { setRuleSearch(event.target.value); rulesPagination.setPage(1); }} placeholder="Bank, product, milestone, recipient, or status" /></Field>
              <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void refresh()}><IconRefresh className={cx("size-4", refreshing && "animate-spin")} />Refresh</Button>
              {can("Finance.ManageCommissionRules") && options ? <Button type="button" onClick={() => openDrawer("commission-rule")}>Create commission rule</Button> : null}
            </div>
            <p className="mt-2 text-xs text-slate-500">Rule versions are immutable. Status actions apply to the selected version.</p>
          </Card>
          {rulesPagination.pagedItems.length ? (
            <TableShell><TableHead><tr><Th>Bank / Product</Th><Th>Milestone</Th><Th>Version</Th><Th>Effective period</Th><Th>Payout mode</Th><Th>Recipients</Th><Th>Status</Th><Th>Actions</Th></tr></TableHead><tbody>{rulesPagination.pagedItems.map((rule) => <tr key={rule.id}><Td><span className="font-medium text-slate-900">{rule.bankName}</span><span className="block text-xs text-slate-500">{rule.productName}</span></Td><Td className="capitalize">{rule.eligibilityMilestone}</Td><Td>Version {rule.version}</Td><Td>{rule.effectiveFrom}<span className="block text-xs text-slate-500">to {rule.effectiveTo ?? "open-ended"}</span></Td><Td>{rule.payoutMode === "percentage_split" ? "Percentage Split" : "Independent Role Rate"}</Td><Td className="min-w-56">{rule.recipients.map((row) => `${row.roleName}: ${row.recipientSource === "case_owner" ? "Case Owner" : `Manager level ${row.hierarchyLevel}`}`).join(", ")}</Td><Td><StatusBadge value={rule.status} /></Td><Td>{can("Finance.ManageCommissionRules") ? <Button type="button" variant={rule.status === "active" ? "secondary" : "primary"} size="compact" onClick={() => setConfirmation({ title: `${rule.status === "active" ? "Deactivate" : "Activate"} commission rule?`, description: `${rule.status === "active" ? "Deactivate" : "Activate"} version ${rule.version} for ${rule.bankName} / ${rule.productName}.`, confirmLabel: rule.status === "active" ? "Deactivate" : "Activate", path: `/api/v1/finance/commission-rules/${rule.id}/${rule.status === "active" ? "deactivate" : "activate"}`, success: `Rule ${rule.status === "active" ? "deactivated" : "activated"}.`, danger: rule.status === "active" })}>{rule.status === "active" ? "Deactivate" : "Activate"}</Button> : null}</Td></tr>)}</tbody></TableShell>
          ) : <Card><EmptyState>{ruleSearch ? "No commission rules match your search." : "No commission rule versions exist yet."}</EmptyState></Card>}
          {rulesPagination.totalPages > 1 ? <Pagination page={rulesPagination.page} pageSize={rulesPagination.pageSize} total={rulesPagination.total} totalPages={rulesPagination.totalPages} onPageChange={rulesPagination.setPage} onPageSizeChange={rulesPagination.setPageSize} /> : null}
        </div>
      ) : null}

      {!loading && currentTab === "incentive-plans" ? (
        <div id="finance-panel-incentive-plans" role="tabpanel" aria-labelledby="finance-tab-incentive-plans" className="space-y-4">
          <Card className="p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Search incentive plans" className="min-w-0 flex-1"><TextInput value={planSearch} onChange={(event) => { setPlanSearch(event.target.value); plansPagination.setPage(1); }} placeholder="Plan name, version, effective date, or status" /></Field>
              <Button type="button" variant="secondary" disabled={refreshing} onClick={() => void refresh()}><IconRefresh className={cx("size-4", refreshing && "animate-spin")} />Refresh</Button>
              {can("Finance.ManageCommissionRules") ? <Button type="button" onClick={() => openDrawer("incentive-plan")}>Create incentive plan</Button> : null}
            </div>
            <p className="mt-2 text-xs text-slate-500">Plan versions are immutable and pay the highest single matching slab, not cumulative tiers.</p>
          </Card>
          {plansPagination.pagedItems.length ? (
            <TableShell><TableHead><tr><Th>Incentive plan</Th><Th>Version</Th><Th>Effective period</Th><Th>Production slabs</Th><Th>Status</Th><Th>Actions</Th></tr></TableHead><tbody>{plansPagination.pagedItems.map((plan) => <tr key={plan.id}><Td className="font-medium text-slate-900">{plan.name}</Td><Td>Version {plan.version}</Td><Td>{plan.effectiveFrom}<span className="block text-xs text-slate-500">to {plan.effectiveTo ?? "open-ended"}</span></Td><Td className="min-w-64">{plan.slabs.map((slab) => `${slab.minimumProduction}–${slab.maximumProduction ?? "open"}: ${formatAed(slab.payoutAmount)}`).join(", ")}</Td><Td><StatusBadge value={plan.status} /></Td><Td>{can("Finance.ManageCommissionRules") ? <Button type="button" variant={plan.status === "active" ? "secondary" : "primary"} size="compact" onClick={() => setConfirmation({ title: `${plan.status === "active" ? "Deactivate" : "Activate"} incentive plan?`, description: `${plan.status === "active" ? "Deactivate" : "Activate"} ${plan.name}, version ${plan.version}.`, confirmLabel: plan.status === "active" ? "Deactivate" : "Activate", path: `/api/v1/finance/incentive-plans/${plan.id}/${plan.status === "active" ? "deactivate" : "activate"}`, success: `Incentive plan ${plan.status === "active" ? "deactivated" : "activated"}.`, danger: plan.status === "active" })}>{plan.status === "active" ? "Deactivate" : "Activate"}</Button> : null}</Td></tr>)}</tbody></TableShell>
          ) : <Card><EmptyState>{planSearch ? "No incentive plans match your search." : "No incentive plan versions exist yet."}</EmptyState></Card>}
          {plansPagination.totalPages > 1 ? <Pagination page={plansPagination.page} pageSize={plansPagination.pageSize} total={plansPagination.total} totalPages={plansPagination.totalPages} onPageChange={plansPagination.setPage} onPageSizeChange={plansPagination.setPageSize} /> : null}
        </div>
      ) : null}

      {drawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) requestDrawerClose(); }}>
          <aside role="dialog" aria-modal="true" aria-labelledby="finance-drawer-title" className="flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div><h2 id="finance-drawer-title" className="text-lg font-semibold text-slate-900">{drawer === "commission-rule" ? "Create commission rule" : "Create incentive plan"}</h2><p className="mt-0.5 text-sm text-slate-500">{drawer === "commission-rule" ? "Create a new immutable Draft rule version." : "Create a new immutable monthly Draft plan version."}</p></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close drawer" onClick={requestDrawerClose}><IconX className="size-4" /></Button>
            </div>
            {drawer === "commission-rule" && options ? (
              <form id="commission-rule-form" className="min-h-0 flex-1 overflow-y-auto" onChange={() => setDrawerDirty(true)} onSubmit={(event) => { event.preventDefault(); if (!ruleValidation) void createRule(); }}>
                <div className="space-y-5 p-4 sm:p-5">
                  <section aria-labelledby="rule-bank-product"><h3 id="rule-bank-product" className="text-sm font-semibold text-slate-900">1. Bank &amp; Product</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Bank"><Select autoFocus value={bankId} onChange={(event) => setBankId(event.target.value)}>{options.banks.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</Select></Field><Field label="Product"><Select value={productId} onChange={(event) => setProductId(event.target.value)}>{options.products.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</Select></Field></div></section>
                  <section aria-labelledby="rule-eligibility"><h3 id="rule-eligibility" className="text-sm font-semibold text-slate-900">2. Eligibility &amp; Effective Period</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label="Eligibility milestone"><Select value={milestone} onChange={(event) => setMilestone(event.target.value)}><option value="booked">Booked</option><option value="funded">Funded</option></Select></Field><Field label="Effective from"><DatePicker value={effectiveFrom} onChange={(value) => { setDrawerDirty(true); setEffectiveFrom(value); }} /></Field><Field label="Effective to"><DatePicker value={effectiveTo} onChange={(value) => { setDrawerDirty(true); setEffectiveTo(value); }} /></Field></div><p className="mt-2 text-xs text-slate-500">Booked rules use booked amount; Funded rules use funded amount. Requested and approved amounts are not commission bases.</p></section>
                  <section aria-labelledby="rule-calculation"><h3 id="rule-calculation" className="text-sm font-semibold text-slate-900">3. Calculation Method</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Payout mode"><Select value={payoutMode} onChange={(event) => setPayoutMode(event.target.value)}><option value="percentage_split">Percentage Split</option><option value="independent_role_rate">Independent Role Rate</option></Select></Field>{payoutMode === "percentage_split" ? <Field label="Calculation"><Select value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value)}><option value="fixed">Fixed</option><option value="percentage">Percentage</option><option value="slab">Single applicable slab</option><option value="flat_percentage">Flat + Percentage</option></Select></Field> : null}{payoutMode === "percentage_split" && calculationMethod === "fixed" ? <Field label="Fixed amount"><TextInput inputMode="decimal" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} /></Field> : null}{payoutMode === "percentage_split" && ["percentage", "flat_percentage"].includes(calculationMethod) ? <Field label="Rate %"><TextInput inputMode="decimal" value={percentageRate} onChange={(event) => setPercentageRate(event.target.value)} /></Field> : null}{payoutMode === "percentage_split" && calculationMethod === "flat_percentage" ? <Field label="Flat amount"><TextInput inputMode="decimal" value={flatAmount} onChange={(event) => setFlatAmount(event.target.value)} /></Field> : null}</div>{payoutMode === "percentage_split" && calculationMethod === "slab" ? <div className="mt-3"><SlabEditor slabs={sharedSlabs} onChange={(rows) => { setDrawerDirty(true); setSharedSlabs(rows); }} basis="eligible" /></div> : null}</section>
                  <section aria-labelledby="rule-recipients"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="rule-recipients" className="text-sm font-semibold text-slate-900">4. Recipient Split</h3>{payoutMode === "percentage_split" ? <Badge tone={Math.abs(splitTotal - 100) < 0.000001 ? "green" : "amber"}>Total split {splitTotal.toLocaleString(undefined, { maximumFractionDigits: 4 })}% / 100%</Badge> : <Badge>Independent rates</Badge>}</div><p className="mt-1 text-xs text-slate-500">Recipients are resolved only from the effective-dated Case Owner or Reporting Manager chain.</p><div className="mt-3 space-y-3">{recipients.map((recipient, index) => <div key={recipient.sort_order} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"><div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recipient {index + 1}</p>{recipients.length > 1 ? <Button type="button" variant="ghost" size="compact" onClick={() => { setDrawerDirty(true); setRecipients((rows) => rows.filter((_, rowIndex) => rowIndex !== index).map((row, rowIndex) => ({ ...row, sort_order: rowIndex }))); }}>Remove</Button> : null}</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Role Code"><TextInput value={recipient.role_code} onChange={(event) => updateRecipient(index, { role_code: event.target.value })} /></Field><Field label="Display Label"><TextInput value={recipient.role_name} onChange={(event) => updateRecipient(index, { role_name: event.target.value })} /></Field><Field label="Authoritative Source"><Select value={recipient.recipient_source} onChange={(event) => updateRecipient(index, { recipient_source: event.target.value as RecipientDraft["recipient_source"], hierarchy_level: event.target.value === "case_owner" ? "" : recipient.hierarchy_level || "1" })}><option value="case_owner">Case Owner</option><option value="reporting_manager">Reporting Manager</option></Select></Field>{recipient.recipient_source === "reporting_manager" ? <Field label="Manager Level"><TextInput inputMode="numeric" value={recipient.hierarchy_level} onChange={(event) => updateRecipient(index, { hierarchy_level: event.target.value })} /></Field> : null}{payoutMode === "percentage_split" ? <Field label="Split %"><TextInput inputMode="decimal" value={recipient.split_percent} onChange={(event) => updateRecipient(index, { split_percent: event.target.value })} /></Field> : <><Field label="Calculation"><Select value={recipient.calculation_method} onChange={(event) => updateRecipient(index, { calculation_method: event.target.value })}><option value="fixed">Fixed</option><option value="percentage">Percentage</option><option value="slab">Single applicable slab</option><option value="flat_percentage">Flat + Percentage</option></Select></Field>{recipient.calculation_method === "fixed" ? <Field label="Fixed amount"><TextInput inputMode="decimal" value={recipient.fixed_amount} onChange={(event) => updateRecipient(index, { fixed_amount: event.target.value })} /></Field> : null}{["percentage", "flat_percentage"].includes(recipient.calculation_method) ? <Field label="Rate %"><TextInput inputMode="decimal" value={recipient.percentage_rate} onChange={(event) => updateRecipient(index, { percentage_rate: event.target.value })} /></Field> : null}{recipient.calculation_method === "flat_percentage" ? <Field label="Flat amount"><TextInput inputMode="decimal" value={recipient.flat_amount} onChange={(event) => updateRecipient(index, { flat_amount: event.target.value })} /></Field> : null}</>}</div>{payoutMode === "independent_role_rate" && recipient.calculation_method === "slab" ? <div className="mt-3"><SlabEditor slabs={recipient.slabs} basis="eligible" onChange={(slabs) => updateRecipient(index, { slabs })} /></div> : null}</div>)}</div><Button className="mt-3" type="button" variant="secondary" onClick={() => { setDrawerDirty(true); setRecipients((rows) => [...rows, newRecipient(rows.length)]); }}>Add recipient role</Button></section>
                </div>
              </form>
            ) : null}
            {drawer === "incentive-plan" ? (
              <form id="incentive-plan-form" className="min-h-0 flex-1 overflow-y-auto" onChange={() => setDrawerDirty(true)} onSubmit={(event) => { event.preventDefault(); if (!planValidation) void createIncentivePlan(); }}>
                <div className="space-y-5 p-4 sm:p-5"><section aria-labelledby="plan-details"><h3 id="plan-details" className="text-sm font-semibold text-slate-900">Plan Details</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label="Plan name"><TextInput autoFocus value={planName} onChange={(event) => setPlanName(event.target.value)} /></Field><Field label="Effective from"><DatePicker value={planFrom} onChange={(value) => { setDrawerDirty(true); setPlanFrom(value); }} /></Field><Field label="Effective to"><DatePicker value={planTo} onChange={(value) => { setDrawerDirty(true); setPlanTo(value); }} /></Field></div></section><section aria-labelledby="plan-slabs"><h3 id="plan-slabs" className="text-sm font-semibold text-slate-900">Production Slabs</h3><div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">The highest single matching achieved-production slab is paid. Slabs are not progressive or cumulative.</div><p className="mt-2 text-xs text-slate-500">Each range needs a minimum, may have an open maximum, and cannot overlap another range.</p><div className="mt-3"><SlabEditor slabs={planSlabs} onChange={(rows) => { setDrawerDirty(true); setPlanSlabs(rows); }} basis="production" showAdd={false} /></div></section></div>
              </form>
            ) : null}
            <div className="sticky bottom-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-5"><div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 text-xs text-slate-500">{drawerDirty ? "Unsaved changes" : "No staged changes"}{drawer === "commission-rule" && ruleValidation ? ` · ${ruleValidation}` : ""}{drawer === "incentive-plan" && planValidation ? ` · ${planValidation}` : ""}</div><div className="flex flex-wrap justify-end gap-2">{drawer === "incentive-plan" ? <Button type="button" variant="secondary" onClick={() => { setDrawerDirty(true); setPlanSlabs((rows) => [...rows, newSlab(rows.length)]); }}>Add Slab</Button> : null}<Button type="button" variant="secondary" disabled={saving} onClick={requestDrawerClose}>Cancel</Button><Button type="submit" form={drawer === "commission-rule" ? "commission-rule-form" : "incentive-plan-form"} disabled={saving || (drawer === "commission-rule" ? Boolean(ruleValidation) : Boolean(planValidation))} title={drawer === "commission-rule" ? ruleValidation ?? undefined : planValidation ?? undefined}>{saving ? "Saving…" : "Create Draft"}</Button></div></div>{error ? <div className="mt-2"><ErrorText>{error}</ErrorText></div> : null}</div>
          </aside>
        </div>
      ) : null}

      {confirmation ? (
        <DialogPanel title={confirmation.title} description={confirmation.description} onClose={() => setConfirmation(null)}><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => setConfirmation(null)}>Cancel</Button><Button type="button" variant={confirmation.danger ? "danger" : "primary"} disabled={saving} onClick={async () => { const next = confirmation; const completed = await action(next.path, next.success, next.body); if (completed) setConfirmation(null); }}>{saving ? "Working…" : confirmation.confirmLabel}</Button></div></DialogPanel>
      ) : null}

      {discardConfirmOpen ? (
        <DialogPanel title="Discard unsaved changes?" description="Your staged Finance configuration will be lost." onClose={() => setDiscardConfirmOpen(false)}><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDiscardConfirmOpen(false)}>Keep editing</Button><Button type="button" variant="danger" onClick={() => { setDiscardConfirmOpen(false); closeDrawer("reset"); }}>Discard changes</Button></div></DialogPanel>
      ) : null}
    </section>
  );
}
