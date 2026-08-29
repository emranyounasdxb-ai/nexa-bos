export type ReportPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
};

export type KpiValue = { count: number; value?: string | null };

export type DashboardPayload = {
  reportingScope: string | null;
  currency: string;
  period: ReportPeriod;
  empty: boolean;
  generatedAt?: string;
  kpis: {
    applicationsOwned: KpiValue;
    submitted: KpiValue;
    approved: KpiValue;
    booked: KpiValue;
    funded: KpiValue;
    pending: KpiValue;
    returnedRequirementPending: KpiValue;
    resubmitted: KpiValue;
    finalRejected: KpiValue;
    cancelled: KpiValue;
    withdrawn: KpiValue;
    completed: KpiValue;
    personalFinance: KpiValue;
    creditCard: KpiValue;
    totalBusinessValue: string;
  };
  conversions: Record<string, number | null>;
  stageBreakdown: { stageId: string | null; name: string; count: number }[];
  activeDelays: { Bank: number; Customer: number; Internal: number; Other: number; total: number };
  rankings: {
    metric: string;
    employees: RankingRow[];
    teams: RankingRow[];
    offices: RankingRow[];
    bankProducts: RankingRow[];
  };
  trend: { month: string; submitted: number; funded: number; fundedValue: string }[];
  targetsSummary?: {
    currency: string;
    count: number;
    items: {
      id: string;
      level: string;
      entityName: string | null;
      productCode: string | null;
      bankCode: string | null;
      result: {
        actual: string;
        achievementPct: number | null;
        gap: string;
        dailyRequiredRunRate: string | null;
        effectiveTarget: string;
      } | null;
    }[];
  } | null;
};

export type RankingRow = {
  id: string;
  name: string;
  rank: number;
  value: string | number;
  count?: number | null;
  employeeCode?: string | null;
  bankId?: string;
  productId?: string;
  dimension?: string;
};

export type FilterOptions = {
  reportingScope: string | null;
  periods: { key: string; label: string }[];
  offices: { id: string; name: string; code: string }[];
  departments: { id: string; name: string; code: string }[];
  teams: { id: string; name: string; code: string }[];
  employees: { id: string; name: string; employeeCode: string; userCode: string }[];
  banks: { id: string; name: string; code: string }[];
  products: { id: string; name: string; code: string }[];
  stages: { id: string; name: string }[];
  terminalOutcomes: string[];
};

export type ReportQuery = {
  period: string;
  date_from: string;
  date_to: string;
  office_id: string;
  department_id: string;
  team_id: string;
  employee_id: string;
  bank_id: string;
  product_id: string;
  stage_id: string;
  terminal_outcome: string;
  ranking_metric: string;
};

export const emptyQuery = (): ReportQuery => ({
  period: "mtd",
  date_from: "",
  date_to: "",
  office_id: "",
  department_id: "",
  team_id: "",
  employee_id: "",
  bank_id: "",
  product_id: "",
  stage_id: "",
  terminal_outcome: "",
  ranking_metric: "funded_value",
});

export function toSearchParams(query: ReportQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) {
    if (value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

export function queryFromSearch(search: string): ReportQuery {
  const params = new URLSearchParams(search);
  const query = emptyQuery();
  for (const key of Object.keys(query) as (keyof ReportQuery)[]) {
    query[key] = params.get(key) ?? query[key];
  }
  return query;
}

export function formatAed(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return `AED ${value}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return `${value}%`;
}
