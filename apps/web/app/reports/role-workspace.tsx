import Link from "next/link";
import { IconArrowUpRight } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";

// Labels describe the workspace; they never grant permissions or select data scope.
const focus: Record<string, string> = {
  OWNER: "Organization overview",
  GM: "Management overview",
  SM: "Sales team workspace",
  OM: "Office operations",
  BDM: "Business development",
  FIN: "Finance workspace",
  ITM: "Technology & assets",
  HR: "People operations",
  PRO: "Document compliance",
  AUDITOR: "Review & assurance",
};

const work = [
  ["Approvals.View", "/approvals", "Approval Centre"],
  ["UserProfiles.HR.View", "/hr", "HR Dashboard"],
  ["UserProfiles.PRO.View", "/pro", "PRO Dashboard"],
  ["Applications.View", "/applications", "Applications"],
  ["Users.View", "/users", "Users"],
  ["Attendance.View", "/attendance", "Attendance"],
  ["Assets.View", "/assets", "Assets"],
  ["Finance.View", "/finance", "Finance"],
] as const;

export function RoleWorkspace() {
  const { user, can } = useAuth();
  const links = work.filter(([permission]) =>
    can(permission) || (permission === "Finance.View" && can("Finance.ViewCommissionRules")),
  );
  return (
    <section data-testid="role-workspace" className="min-w-0 border-b border-slate-200 pb-4">
      <h2 className="text-xl font-semibold text-slate-950">{focus[user?.userType?.code ?? ""] ?? "Personal workspace"}</h2>
      <p className="mt-1 text-sm text-slate-600">{user?.userType?.name ?? "Your account"} · Your effective permissions and reporting scope apply.</p>
      {links.length ? <nav aria-label="Permitted work areas" className="mt-3 flex flex-wrap gap-2">
        {links.map(([, href, label]) => <Link key={href} href={href} className="inline-flex min-h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-brand-link hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">{label}<IconArrowUpRight className="size-4" /></Link>)}
      </nav> : <p className="mt-3 text-sm text-slate-600">Your personal performance and attendance are available below.</p>}
    </section>
  );
}
