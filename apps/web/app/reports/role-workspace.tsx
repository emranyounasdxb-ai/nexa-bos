import Link from "next/link";
import { IconArrowUpRight } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import styles from "./overview.module.css";

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
    <section data-testid="role-workspace" className={styles.workspace}>
      <div><h2>{focus[user?.userType?.code ?? ""] ?? "Personal workspace"}</h2>
      <p>{user?.userType?.name ?? "Your account"} · Your effective permissions and reporting scope apply.</p></div>
      {links.length ? <details className={styles.workAreas}><summary>Work areas</summary><nav aria-label="Permitted work areas">
        {links.map(([, href, label]) => <Link key={href} href={href}>{label}<IconArrowUpRight className="size-4" /></Link>)}
      </nav></details> : <p>Your personal performance and attendance are available below.</p>}
    </section>
  );
}
