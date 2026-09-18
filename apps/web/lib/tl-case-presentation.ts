import type { WorkflowStageRecord } from "./types";

/** Display registration first without changing saved stages or their timestamps. */
export function orderCaseProgress(stages: WorkflowStageRecord[]): WorkflowStageRecord[] {
  return [...stages].sort((left, right) => {
    const leftCreated = left.systemKey === "application_created";
    const rightCreated = right.systemKey === "application_created";
    if (leftCreated !== rightCreated) return leftCreated ? -1 : 1;
    return left.sortOrder - right.sortOrder;
  });
}

export function tlActiveNavigationGroup(pathname: string, workspace: string | null, fallback: string): string | null {
  if (pathname !== "/reports") return fallback;
  const section = workspace ?? "dashboard";
  return section === "cases" ? "Cases" : section === "dashboard" ? "Workspace" : null;
}

export function tlNavigationActive(pathname: string, workspace: string | null, href: string, fallback: boolean): boolean {
  const [targetPath, query] = href.split("?");
  const section = pathname.startsWith("/applications") ? "cases" : workspace ?? "dashboard";
  if (targetPath === "/reports" && (pathname === "/reports" || pathname.startsWith("/applications"))) {
    return (new URLSearchParams(query).get("workspace") ?? "dashboard") === section;
  }
  if (targetPath === "/applications" && pathname === "/reports") return section === "cases";
  return fallback;
}
