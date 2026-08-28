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
  mfaRequired: boolean;
  canBeReportingManager?: boolean;
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
};

export type BankProductRecord = {
  id: string;
  bankId: string;
  productId: string;
  status: string;
  bank: CatalogItem | null;
  product: CatalogItem | null;
};
