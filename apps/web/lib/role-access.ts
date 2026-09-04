import type { UserRecord } from "@/lib/types";

const ORGANIZATION_CATALOG_READ_TYPES = new Set([
  "OWNER",
  "GM",
  "ITM",
  "BDM",
  "SM",
  "COD",
  "TL",
  "OM",
]);

const ORGANIZATION_MANAGE_PERMISSIONS = [
  "Offices.Manage",
  "Departments.Manage",
  "Teams.Manage",
  "Designations.Manage",
];

const CATALOG_MANAGE_PREFIXES = ["Banks.", "Products.", "BankProducts.", "ProductVariants."];

export function canReadOrganization(user: UserRecord | null): boolean {
  if (!user) return false;
  return (
    ORGANIZATION_CATALOG_READ_TYPES.has(user.userType?.code ?? "") ||
    ORGANIZATION_MANAGE_PERMISSIONS.some((permission) => user.permissions.includes(permission))
  );
}

export function canReadCatalog(user: UserRecord | null): boolean {
  if (!user) return false;
  return (
    ORGANIZATION_CATALOG_READ_TYPES.has(user.userType?.code ?? "") ||
    user.permissions.some((permission) =>
      CATALOG_MANAGE_PREFIXES.some((prefix) => permission.startsWith(prefix)),
    )
  );
}

export function canReadWorkflows(user: UserRecord | null): boolean {
  return user?.userType?.code === "OWNER" || user?.userType?.code === "GM";
}

export function canManageCustomers(user: UserRecord | null): boolean {
  return user?.userType?.code === "OWNER" || user?.userType?.code === "GM";
}
