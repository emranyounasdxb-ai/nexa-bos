import { SmokeStatus } from "@/components/smoke-status";
import { Card, PageHeader } from "@/components/ui";

export default function StatusPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-4 px-4 py-3 sm:py-4">
      <Card>
        <h1 className="mb-2 text-xl font-semibold text-text-primary">Foundation smoke page</h1>
        <PageHeader
          title="Foundation smoke page"
          description="This screen verifies that the Next.js application starts and can reach the FastAPI service over /api/v1."
        />
      </Card>
      <SmokeStatus />
    </section>
  );
}
