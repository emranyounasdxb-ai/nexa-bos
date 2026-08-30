"use client";

import { useCallback, useEffect, useState } from "react";

import { DatePicker } from "@/components/date-picker";
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
type StatementItem = Payout & {
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

function SlabEditor({
  slabs,
  onChange,
  basis,
}: {
  slabs: SlabDraft[];
  onChange: (slabs: SlabDraft[]) => void;
  basis: "eligible" | "production";
}) {
  const label = basis === "eligible" ? "eligible value" : "production";
  return (
    <div className="space-y-2 md:col-span-4">
      {slabs.map((slab, index) => (
        <div key={slab.sort_order} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-4">
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
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                onChange(
                  slabs
                    .filter((_, i) => i !== index)
                    .map((row, i) => ({ ...row, sort_order: i })),
                )
              }
            >
              Remove slab
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...slabs, newSlab(slabs.length)])}
      >
        Add slab
      </Button>
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
  const [components, setComponents] = useState<Component[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
        const nextPeriods = await apiGet<{ items: Period[] }>("/api/v1/finance/periods", api);
        setPeriods(nextPeriods.items);
        if (nextPeriods.items.some((item) => item.periodMonth === month)) {
          const statement = await apiGet<{ items: StatementItem[] }>(
            `/api/v1/finance/statements?period_month=${encodeURIComponent(month)}`,
            api,
          );
          setStatementItems(statement.items);
        } else {
          setStatementItems([]);
        }
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load Finance");
    }
  }, [api, can, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(path: string, success: string, body?: object) {
    setError("");
    setMessage("");
    try {
      await apiRequest(path, api, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setMessage(success);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Finance action failed");
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
    await action("/api/v1/finance/commission-rules", "Commission rule version created.", {
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
  }

  async function createIncentivePlan() {
    await action("/api/v1/finance/incentive-plans", "Incentive plan version created.", {
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
    setPlanName("");
    setPlanSlabs([newSlab(0)]);
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
      link.download = result.filename ?? `nexa-bos-finance.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Finance export failed");
    }
  }

  if (!can("Finance.View") && !can("Finance.ViewCommissionRules")) {
    return (
      <section>
        <PageHeader title="Finance" />
        <EmptyState>You do not have permission to access Finance.</EmptyState>
      </section>
    );
  }

  const selectedPeriod = periods.find((item) => item.periodMonth === month);
  const statementsByRecipient = new Map(
    statementItems.map((item) => [item.recipientId, item]),
  );
  const payoutRows = (selectedPeriod?.payouts ?? []).map((payout) => ({
    ...payout,
    eligibleCases: statementsByRecipient.get(payout.recipientId)?.eligibleCases ?? 0,
    eligibleValue: statementsByRecipient.get(payout.recipientId)?.eligibleValue ?? "0.00",
    grossAmount: statementsByRecipient.get(payout.recipientId)?.grossAmount ?? "0.00",
  }));

  return (
    <section className="space-y-6">
      <PageHeader
        title="Finance"
        description="Commission, incentives, clawbacks, adjustments, and monthly payout statements."
        actions={
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}

      {can("Finance.View") ? (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Payout month">
              <DatePicker
                aria-label="Finance payout month"
                value={month}
                onChange={(value) => setMonth(monthFirst(value))}
              />
            </Field>
            {can("Finance.GeneratePayout") && !selectedPeriod ? (
              <Button
                type="button"
                onClick={() =>
                  void action(
                    `/api/v1/finance/periods/${month}/generate`,
                    "Payout period generated in Draft.",
                  )
                }
              >
                Generate payout
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => void exportStatement("xlsx")}>
              Excel
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportStatement("pdf")}>
              PDF
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportStatement("print")}>
              Print
            </Button>
          </div>
          {selectedPeriod ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge>{selectedPeriod.status}</Badge>
              {selectedPeriod.status === "draft" && can("Finance.Review") ? (
                <Button
                  type="button"
                  onClick={() =>
                    void action(
                      `/api/v1/finance/periods/${month}/review`,
                      "Payout period moved to Review.",
                    )
                  }
                >
                  Submit for review
                </Button>
              ) : null}
              {selectedPeriod.status === "review" && can("Finance.Finalize") ? (
                <Button
                  type="button"
                  onClick={() =>
                    void action(
                      `/api/v1/finance/periods/${month}/finalize`,
                      "Payout period finalized and locked.",
                    )
                  }
                >
                  Finalize / Lock
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {payoutRows.length ? (
        <TableShell>
          <TableHead>
            <tr>
              <Th>Recipient</Th>
              <Th>Eligible cases</Th>
              <Th>Eligible value</Th>
              <Th>Commission</Th>
              <Th>Incentive</Th>
              <Th>Clawback</Th>
              <Th>Adjustment</Th>
              <Th>Previous carry</Th>
              <Th>Gross</Th>
              <Th>Payable</Th>
              <Th>Next carry</Th>
              <Th>Drill-down</Th>
            </tr>
          </TableHead>
          <tbody>
            {payoutRows.map((payout) => (
              <tr key={payout.id}>
                <Td>{payout.recipientName} ({payout.recipientCode})</Td>
                <Td>{payout.eligibleCases}</Td>
                <Td>{formatAed(payout.eligibleValue)}</Td>
                <Td>{formatAed(payout.commission)}</Td>
                <Td>{formatAed(payout.incentive)}</Td>
                <Td>{formatAed(payout.clawback)}</Td>
                <Td>{formatAed(payout.adjustment)}</Td>
                <Td>{formatAed(payout.previousCarryForward)}</Td>
                <Td>{formatAed(payout.grossAmount)}</Td>
                <Td>{formatAed(payout.finalPayable)}</Td>
                <Td>{formatAed(payout.carryForward)}</Td>
                <Td>
                  <Button type="button" variant="secondary" onClick={() => void loadComponents(payout.id)}>
                    Components
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : can("Finance.View") ? (
        <EmptyState>No payout rows exist for the selected month.</EmptyState>
      ) : null}

      {components.length ? (
        <Card>
          <h3 className="text-sm font-semibold">Finance component drill-down</h3>
          <TableShell>
            <TableHead>
              <tr>
                <Th>Application</Th>
                <Th>Component</Th>
                <Th>Role</Th>
                <Th>Eligible value</Th>
                <Th>Amount</Th>
                <Th>Reason</Th>
              </tr>
            </TableHead>
            <tbody>
              {components.map((item) => (
                <tr key={item.id}>
                  <Td>{item.applicationCode ?? "Monthly"}</Td>
                  <Td>{item.componentType}</Td>
                  <Td>{item.roleName ?? "—"}</Td>
                  <Td>{item.eligibleAmount ? formatAed(item.eligibleAmount) : "—"}</Td>
                  <Td>{formatAed(item.amount)}</Td>
                  <Td>{item.reason ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      ) : null}

      {selectedPeriod && selectedPeriod.status !== "finalized" && can("Finance.EditAdjustment") ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="text-sm font-semibold">Adjustment</h3>
            <div className="mt-3 grid gap-3">
              <Field label="Application ID"><TextInput value={adjustApplication} onChange={(event) => setAdjustApplication(event.target.value)} /></Field>
              <Field label="Recipient ID"><TextInput value={adjustRecipient} onChange={(event) => setAdjustRecipient(event.target.value)} /></Field>
              <Field label="Amount (+/-)"><TextInput value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} /></Field>
              <Field label="Reason"><Textarea value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} /></Field>
              <Button type="button" onClick={() => void action(`/api/v1/finance/periods/${month}/adjustments`, "Adjustment recorded.", { application_id: adjustApplication, recipient_id: adjustRecipient, amount: adjustAmount, reason: adjustReason })}>Record adjustment</Button>
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold">Clawback</h3>
            <div className="mt-3 grid gap-3">
              <Field label="Original component ID"><TextInput value={clawbackOriginal} onChange={(event) => setClawbackOriginal(event.target.value)} /></Field>
              <Field label="Amount"><TextInput value={clawbackAmount} onChange={(event) => setClawbackAmount(event.target.value)} /></Field>
              <Field label="Reason"><Textarea value={clawbackReason} onChange={(event) => setClawbackReason(event.target.value)} /></Field>
              <Button type="button" onClick={() => void action(`/api/v1/finance/periods/${month}/clawbacks`, "Clawback recorded in the current month.", { original_component_id: clawbackOriginal, amount: clawbackAmount, reason: clawbackReason })}>Record clawback</Button>
            </div>
          </Card>
        </div>
      ) : null}

      {selectedPeriod?.status === "finalized" && can("Finance.ReopenPeriod") ? (
        <Card>
          <h3 className="text-sm font-semibold">Reopen finalized period</h3>
          <Field label="Mandatory reason" className="mt-3">
            <Textarea value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} />
          </Field>
          <Button className="mt-3" type="button" onClick={() => void action(`/api/v1/finance/periods/${month}/reopen`, "Period reopened to Review without regeneration.", { reason: reopenReason })}>Reopen to Review</Button>
        </Card>
      ) : null}

      {can("Finance.ManageCommissionRules") && options ? (
        <Card>
          <h3 className="text-sm font-semibold">New commission rule version</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Bank"><Select value={bankId} onChange={(event) => setBankId(event.target.value)}>{options.banks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Product"><Select value={productId} onChange={(event) => setProductId(event.target.value)}>{options.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Eligibility"><Select value={milestone} onChange={(event) => setMilestone(event.target.value)}><option value="booked">Booked</option><option value="funded">Funded</option></Select></Field>
            <Field label="Effective from"><DatePicker value={effectiveFrom} onChange={setEffectiveFrom} /></Field>
            <Field label="Effective to"><DatePicker value={effectiveTo} onChange={setEffectiveTo} /></Field>
            <Field label="Payout mode"><Select value={payoutMode} onChange={(event) => setPayoutMode(event.target.value)}><option value="percentage_split">Percentage Split</option><option value="independent_role_rate">Independent Role Rate</option></Select></Field>
          </div>
          {payoutMode === "percentage_split" ? (
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Field label="Calculation">
                <Select value={calculationMethod} onChange={(event) => setCalculationMethod(event.target.value)}>
                  <option value="fixed">Fixed</option>
                  <option value="percentage">Percentage</option>
                  <option value="slab">Single applicable slab</option>
                  <option value="flat_percentage">Flat + Percentage</option>
                </Select>
              </Field>
              {calculationMethod === "fixed" ? (
                <Field label="Fixed amount">
                  <TextInput inputMode="decimal" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} />
                </Field>
              ) : null}
              {["percentage", "flat_percentage"].includes(calculationMethod) ? (
                <Field label="Rate %">
                  <TextInput inputMode="decimal" value={percentageRate} onChange={(event) => setPercentageRate(event.target.value)} />
                </Field>
              ) : null}
              {calculationMethod === "flat_percentage" ? (
                <Field label="Flat amount">
                  <TextInput inputMode="decimal" value={flatAmount} onChange={(event) => setFlatAmount(event.target.value)} />
                </Field>
              ) : null}
              {calculationMethod === "slab" ? (
                <SlabEditor slabs={sharedSlabs} onChange={setSharedSlabs} basis="eligible" />
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {recipients.map((recipient, index) => (
              <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-4">
                <Field label="Role code"><TextInput value={recipient.role_code} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, role_code: event.target.value } : row))} /></Field>
                <Field label="Display label"><TextInput value={recipient.role_name} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, role_name: event.target.value } : row))} /></Field>
                <Field label="Authoritative source"><Select value={recipient.recipient_source} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, recipient_source: event.target.value as RecipientDraft["recipient_source"], hierarchy_level: event.target.value === "case_owner" ? "" : row.hierarchy_level || "1" } : row))}><option value="case_owner">Case Owner</option><option value="reporting_manager">Reporting Manager</option></Select></Field>
                {recipient.recipient_source === "reporting_manager" ? <Field label="Manager level"><TextInput value={recipient.hierarchy_level} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, hierarchy_level: event.target.value } : row))} /></Field> : null}
                {payoutMode === "percentage_split" ? (
                  <Field label="Split %">
                    <TextInput
                      inputMode="decimal"
                      value={recipient.split_percent}
                      onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, split_percent: event.target.value } : row))}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Calculation">
                      <Select value={recipient.calculation_method} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, calculation_method: event.target.value } : row))}>
                        <option value="fixed">Fixed</option>
                        <option value="percentage">Percentage</option>
                        <option value="slab">Single applicable slab</option>
                        <option value="flat_percentage">Flat + Percentage</option>
                      </Select>
                    </Field>
                    {recipient.calculation_method === "fixed" ? (
                      <Field label="Fixed amount">
                        <TextInput inputMode="decimal" value={recipient.fixed_amount} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, fixed_amount: event.target.value } : row))} />
                      </Field>
                    ) : null}
                    {["percentage", "flat_percentage"].includes(recipient.calculation_method) ? (
                      <Field label="Rate %">
                        <TextInput inputMode="decimal" value={recipient.percentage_rate} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, percentage_rate: event.target.value } : row))} />
                      </Field>
                    ) : null}
                    {recipient.calculation_method === "flat_percentage" ? (
                      <Field label="Flat amount">
                        <TextInput inputMode="decimal" value={recipient.flat_amount} onChange={(event) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, flat_amount: event.target.value } : row))} />
                      </Field>
                    ) : null}
                    {recipient.calculation_method === "slab" ? (
                      <SlabEditor
                        slabs={recipient.slabs}
                        basis="eligible"
                        onChange={(slabs) => setRecipients((rows) => rows.map((row, i) => i === index ? { ...row, slabs } : row))}
                      />
                    ) : null}
                  </>
                )}
                {recipients.length > 1 ? (
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRecipients((rows) => rows.filter((_, i) => i !== index).map((row, i) => ({ ...row, sort_order: i })))}
                    >
                      Remove role
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setRecipients((rows) => [...rows, newRecipient(rows.length)])}>Add recipient role</Button>
            <Button type="button" onClick={() => void createRule()}>Create draft version</Button>
          </div>
        </Card>
      ) : null}

      {can("Finance.ManageCommissionRules") ? (
        <Card>
          <h3 className="text-sm font-semibold">New monthly incentive plan version</h3>
          <p className="mt-1 text-sm text-slate-600">
            The highest single matching achieved-production slab is paid; slabs are not progressive.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Plan name">
              <TextInput value={planName} onChange={(event) => setPlanName(event.target.value)} />
            </Field>
            <Field label="Effective from">
              <DatePicker value={planFrom} onChange={setPlanFrom} />
            </Field>
            <Field label="Effective to">
              <DatePicker value={planTo} onChange={setPlanTo} />
            </Field>
            <SlabEditor slabs={planSlabs} onChange={setPlanSlabs} basis="production" />
          </div>
          <Button className="mt-4" type="button" onClick={() => void createIncentivePlan()}>
            Create draft plan version
          </Button>
        </Card>
      ) : null}

      {can("Finance.ViewCommissionRules") ? (
        <TableShell>
          <TableHead><tr><Th>Bank / Product</Th><Th>Milestone</Th><Th>Version</Th><Th>Effective</Th><Th>Mode</Th><Th>Recipients</Th><Th>Status</Th><Th>Actions</Th></tr></TableHead>
          <tbody>{rules.map((rule) => <tr key={rule.id}><Td>{rule.bankName} / {rule.productName}</Td><Td>{rule.eligibilityMilestone}</Td><Td>{rule.version}</Td><Td>{rule.effectiveFrom} – {rule.effectiveTo ?? "open"}</Td><Td>{rule.payoutMode}</Td><Td>{rule.recipients.map((row) => `${row.roleName}: ${row.recipientSource}${row.hierarchyLevel ? ` ${row.hierarchyLevel}` : ""}`).join(", ")}</Td><Td><Badge>{rule.status}</Badge></Td><Td>{can("Finance.ManageCommissionRules") ? rule.status === "active" ? <Button type="button" variant="secondary" onClick={() => void action(`/api/v1/finance/commission-rules/${rule.id}/deactivate`, "Rule deactivated.")}>Deactivate</Button> : <Button type="button" onClick={() => void action(`/api/v1/finance/commission-rules/${rule.id}/activate`, "Rule activated.")}>Activate</Button> : null}</Td></tr>)}</tbody>
        </TableShell>
      ) : null}

      {can("Finance.ViewCommissionRules") ? (
        <TableShell>
          <TableHead>
            <tr>
              <Th>Incentive plan</Th>
              <Th>Version</Th>
              <Th>Effective</Th>
              <Th>Slabs</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </TableHead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <Td>{plan.name}</Td>
                <Td>{plan.version}</Td>
                <Td>{plan.effectiveFrom} – {plan.effectiveTo ?? "open"}</Td>
                <Td>
                  {plan.slabs
                    .map((slab) => `${slab.minimumProduction}–${slab.maximumProduction ?? "open"}: ${formatAed(slab.payoutAmount)}`)
                    .join(", ")}
                </Td>
                <Td><Badge>{plan.status}</Badge></Td>
                <Td>
                  {can("Finance.ManageCommissionRules") ? (
                    plan.status === "active" ? (
                      <Button type="button" variant="secondary" onClick={() => void action(`/api/v1/finance/incentive-plans/${plan.id}/deactivate`, "Incentive plan deactivated.")}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => void action(`/api/v1/finance/incentive-plans/${plan.id}/activate`, "Incentive plan activated.")}>
                        Activate
                      </Button>
                    )
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}
    </section>
  );
}
