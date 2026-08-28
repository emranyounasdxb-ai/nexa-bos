export type OrgRef = {
  id: string;
  code: string;
  name: string;
  status?: string;
  officeId?: string;
  departmentId?: string;
  teamLeaderId?: string | null;
};

export type ManagerOption = {
  id: string;
  userCode: string;
  fullName: string;
  officeId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
};

export type UserTypeSummary = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  status: string;
  visibilityScope: string | null;
  customerVisibilityScope: string | null;
    applicationVisibilityScope?: string | null;
    reportingVisibilityScope?: string | null;
  mfaRequired: boolean;
  canBeReportingManager?: boolean;
  canBeCaseOwner?: boolean;
  permissions?: string[];
};

export type UserRecord = {
  id: string;
  userCode: string;
  employeeCode: string;
  fullName: string;
  email: string;
  mobile: string;
  designation: OrgRef | null;
  employmentStatus: string;
  joiningDate: string;
  lastWorkingDate: string | null;
  office: OrgRef | null;
  department: OrgRef | null;
  team: OrgRef | null;
  reportingManagerId: string | null;
  hasPhoto: boolean;
  userType: UserTypeSummary | null;
  accountStatus: string;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  permissions: string[];
  csrfToken?: string;
};

export type AuthResponse = {
  csrfToken: string;
  user: UserRecord;
};

export type BootstrapStatus = {
  available: boolean;
  ownerExists: boolean;
};

export type CustomerRecord = {
  id: string;
  customerCode: string;
  customerType: "individual" | "company";
  customerTypeLabel: string;
  status: string;
  fullName: string | null;
  companyName: string | null;
  contactPerson: string | null;
  mobile: string;
  email: string | null;
  emiratesId: string | null;
  passport: string | null;
  employer: string | null;
  tradeLicense: string | null;
  mergedIntoId: string | null;
};

export type CatalogItem = {
  id: string;
  code: string;
  name: string;
  status: string;
  requestedAmountRequired?: boolean;
  approvedAmountRequired?: boolean;
  bookedAmountRequired?: boolean;
  fundedAmountRequired?: boolean;
};

export type BankProductRecord = {
  id: string;
  bankId: string;
  productId: string;
  status: string;
  bank: CatalogItem | null;
  product: CatalogItem | null;
};

export type ApplicationRecord = {
  id: string;
  applicationCode: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerMobile: string | null;
  bankId: string;
  bankCode: string | null;
  bankName: string | null;
  productId: string;
  productCode: string | null;
  productName: string | null;
  workflowId: string;
  workflowVersion: number | null;
  currentStageId: string;
  currentStage: string | null;
  currentStageKey: string | null;
  terminalOutcome: string | null;
  terminalReason: string | null;
  caseOwnerId: string;
  caseOwnerName: string | null;
  requestedAmount: string | null;
  approvedAmount: string | null;
  bookedAmount: string | null;
  fundedAmount: string | null;
  bankCaseNumber: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  bookedAt: string | null;
  fundReleasedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submitted: boolean;
  terminal: boolean;
  tatStartedAt: string;
  tatStoppedAt: string | null;
  totalDurationSeconds: number | null;
  currentElapsedSeconds: number | null;
  currentStageEnteredAt: string | null;
  currentStageElapsedSeconds: number | null;
  stageDurations: StageDurationRecord[];
  activeDelay: DelayRecord | null;
  hasActiveDelay: boolean;
};

export type StageDurationRecord = {
  id: string;
  stageId: string;
  stageName: string | null;
  enteredAt: string;
  exitedAt: string | null;
  durationSeconds: number;
  completed: boolean;
  bankStageDate: string | null;
  stageNote: string | null;
  bosUpdatedAt: string;
  updatedBy: string | null;
  updatedById: string;
};

export type DelayRecord = {
  id: string;
  delayType: string;
  reason: string;
  otherExplanation: string | null;
  stageId: string;
  stageName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  markedById: string;
  markedBy: string | null;
  closedCause: string | null;
  active: boolean;
};

export type ApplicationEventRecord = {
  id: string;
  eventType: string;
  previousStage: string | null;
  newStage: string | null;
  bankStageDate: string | null;
  stageNote: string | null;
  bosUpdatedAt: string;
  updatedBy: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
};

export type WorkflowStageRecord = {
  id: string;
  workflowId?: string;
  code: string;
  name: string;
  kind?: string;
  systemKey?: string | null;
  sortOrder: number;
  status?: string;
  current?: boolean;
  enteredAt?: string | null;
  exitedAt?: string | null;
  durationSeconds?: number | null;
};

export type WorkflowRecord = {
  id: string;
  bankId: string;
  productId: string;
  version: number;
  status: string;
  bank: CatalogItem | null;
  product: CatalogItem | null;
  stages: WorkflowStageRecord[];
  transitions: { id: string; fromStageId: string; toStageId: string }[];
};
