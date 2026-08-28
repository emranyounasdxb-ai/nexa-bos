import { SmokeStatus } from "@/components/smoke-status";
import { Card, PageHeader } from "@/components/ui";

export default function StatusPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <Card>
        <PageHeader
          title="Foundation smoke page"
          description="This screen verifies that the Next.js application starts and can reach the FastAPI service over /api/v1."
        />
      </Card>
      <SmokeStatus />
    </section>
  );
}
