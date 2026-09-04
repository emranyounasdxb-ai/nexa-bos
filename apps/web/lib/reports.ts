export type ReportPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
};

export type KpiValue = { count: number; value?: string | null };

export type DashboardKpis = {
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

export type DashboardPayload = {
  reportingScope: string | null;
  currency: string;
  period: ReportPeriod;
  empty: boolean;
  generatedAt?: string;
  kpis: DashboardKpis;
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
  personalPerformance: PersonalPerformance;
  personalAttendance: PersonalAttendance;
  seWorkspace: SeDashboardWorkspace | null;
  codWorkspace: CodDashboardWorkspace | null;
};

export type PersonalTargetProgress = {
  count: number;
  measurement: "amount" | "count" | null;
  assigned: string | null;
  achieved: string | null;
  remaining: string | null;
  achievementPct: number | null;
  items: Array<{
    id: string;
    productCode: string | null;
    productName: string | null;
    bankCode: string | null;
    milestone: string;
    measurement: string;
    result: {
      effectiveTarget: string;
      actual: string;
      gap: string;
      achievementPct: number | null;
    } | null;
  }>;
  kpi: {
    scorecardName: string;
    score: string;
    components: Array<{ metric: string; label: string; actual: string | null; baseline: string | null }>;
  } | null;
};

export type PersonalPerformance = {
  target: PersonalTargetProgress;
  currentMonthTarget: PersonalTargetProgress;
  previousMonthTarget: PersonalTargetProgress;
  applicationMetrics: null | {
    applications: KpiValue;
    submitted: KpiValue;
    approved: KpiValue;
    funded: KpiValue;
    rejected: KpiValue;
    pending: KpiValue;
    creditCard: KpiValue;
    personalFinance: KpiValue;
    currentMonthApplications: number;
    previousMonthApplications: number;
  };
};

export type PersonalAttendance = {
  month: string;
  today: {
    date: string;
    status: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    actualCheckIn: string | null;
    actualCheckOut: string | null;
    workedMinutes: number | null;
    lateMinutes: number;
    earlyDepartureMinutes: number;
    overtimeConfigured: boolean;
    overtimeMinutes: number | null;
  };
  summary: {
    presentCount: number;
    absentCount: number;
    lateCount: number;
    leaveCount: number;
  };
  items: Array<{
    id: string;
    date: string;
    status: string;
    checkIn: string | null;
    checkOut: string | null;
    workedMinutes: number | null;
    lateMinutes: number;
    earlyDepartureMinutes: number;
  }>;
};

export type SeApplicationSummary = {
  id: string;
  localFileNumber: string;
  bankCaseNumber: string | null;
  customer: string;
  bank: string;
  product: string;
  productCode: string;
  stage: string;
  stageId: string;
  lastUpdate: string;
};

export type SeDashboardWorkspace = {
  kpis: {
    applications: KpiValue;
    submitted: KpiValue;
    approved: KpiValue;
    funded: KpiValue;
    inProgress: KpiValue;
    targetAchievementPct: number | null;
  };
  trend: Array<{ month: string; created: number; submitted: number; approved: number; funded: number }>;
  stages: Array<{ stageId: string; name: string; count: number }>;
  products: Array<{ code: string; name: string; count: number }>;
  targetProgress: PersonalTargetProgress;
  actionRequired: Array<SeApplicationSummary & { reasons: string[] }>;
  recentApplications: SeApplicationSummary[];
};

export type CodApplicationSummary = {
  id: string;
  localFileNumber: string;
  bankCaseNumber: string | null;
  customer: string;
  caseOwner: string;
  caseOwnerRole: string | null;
  bank: string;
  product: string;
  stage: string;
  stageId: string;
  tatSeconds: number;
  delayed: boolean;
  delayType: string | null;
  lastUpdate: string;
  actions: Array<{ key: string; label: string }>;
};

export type CodDashboardWorkspace = {
  office: { id: string | null; name: string; scope: string };
  kpis: {
    newCases: number;
    awaitingSubmission: number;
    missingBankNumber: number;
    submitted: number;
    requirementsPending: number;
    delayed: number;
    approved: number;
    completedFunded: number;
  };
  queues: {
    awaitingReview: CodApplicationSummary[];
    bankSubmission: CodApplicationSummary[];
    missingBankNumber: CodApplicationSummary[];
    misUpdate: CodApplicationSummary[];
    requirements: CodApplicationSummary[];
    returned: CodApplicationSummary[];
    delayed: CodApplicationSummary[];
    recentUpdates: CodApplicationSummary[];
  };
  charts: {
    pipeline: Array<{ stageId: string; name: string; count: number }>;
    trend: Array<{ month: string; created: number; submitted: number }>;
    outcomes: Array<{ name: string; count: number }>;
    workload: Array<{ name: string; count: number }>;
    tat: Array<{ name: string; count: number }>;
    requirementReasons: Array<{ name: string; count: number }>;
  };
  staff: Array<{
    id: string;
    name: string;
    role: "SM" | "TL" | "SE";
    team: string | null;
    openCases: number;
    delayedCases: number;
    downline: boolean;
  }>;
  activity: { reviewed: number; submitted: number; stageUpdates: number };
};

export type ReportComparisonPayload = {
  metric: string;
  current: string | number;
  previous: string | number;
  absoluteDifference: string | number;
  percentageChange: number | null;
  reportingScope: string | null;
  kind: "period" | "entity";
  currency: string;
  currentPeriod?: ReportPeriod;
  previousPeriod?: ReportPeriod;
  currentKpis?: DashboardKpis;
  previousKpis?: DashboardKpis;
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
