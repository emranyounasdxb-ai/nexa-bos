import { SmokeStatus } from "@/components/smoke-status";

export default function StatusPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Foundation smoke page</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          This screen verifies that the Next.js application starts and can reach the FastAPI
          service over <code className="rounded bg-slate-100 px-1 py-0.5">/api/v1</code>.
        </p>
      </div>
      <SmokeStatus />
    </section>
  );
}
