import { Badge } from "@/components/ui";
import type { AssetRecord } from "@/lib/types";

export function AssetStatusBadge({ asset }: { asset: AssetRecord }) {
  const status = asset.outstanding && asset.status === "Allocated" ? "Return Pending" : asset.status === "Allocated" ? "Assigned" : asset.status;
  const tone = status === "In Stock" ? "green" : status === "Assigned" ? "blue" : status === "Under Repair" || status === "Return Pending" ? "amber" : status === "Damaged" || status === "Lost" ? "red" : "neutral";
  return <><Badge tone={tone}>{status}</Badge>{asset.outstanding && asset.status !== "Allocated" ? <Badge tone="amber">Return Pending</Badge> : null}</>;
}

export function AssetCustodian({ asset }: { asset: AssetRecord }) {
  const allocation = asset.currentAllocation;
  return <div className="min-w-0 break-words text-sm text-text-primary">
    {asset.status === "Under Repair" ? <><p>Repair location not recorded</p><p className="mt-1 text-xs text-text-secondary">Office custody: {asset.office?.name ?? "Not recorded"}</p></> : allocation ? null : <p>{asset.office ? `${asset.office.name} Store` : "Office location not recorded"}</p>}
    {allocation ? <><p>{allocation.employeeName ?? "Employee name not recorded"}</p><p className="mt-1 text-xs text-text-secondary">{allocation.employeeCode ?? "Employee code not recorded"}{asset.status === "Under Repair" ? " · custody retained" : ""}</p></> : null}
  </div>;
}
