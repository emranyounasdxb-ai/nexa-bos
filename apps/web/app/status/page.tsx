import { SmokeStatus } from "@/components/smoke-status";
import { PublicScreen } from "@/components/ui";

export default function StatusPage() {
  return (
    <PublicScreen
      title="Foundation smoke page"
      description="This screen verifies that the Next.js application starts and can reach the FastAPI service over /api/v1."
      wide
    >
      <div className="mt-6"><SmokeStatus /></div>
    </PublicScreen>
  );
}
