import { expect, test, type APIRequestContext } from "@playwright/test";

const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const builtInCodes = new Set(["OWNER", "GM", "SM", "OM", "TL", "SE", "COD", "HR", "PRO", "FIN", "ITM", "BDM", "AUDITOR"]);
type Role = { id: string; code: string; isSystem: boolean; [key: string]: unknown };
const fields = [
  ["permissions", "permissions", "permissions"],
  ["visibilityScope", "scope", "visibility_scope"],
  ["customerVisibilityScope", "customer-scope", "customer_visibility_scope"],
  ["applicationVisibilityScope", "application-scope", "application_visibility_scope"],
  ["reportingVisibilityScope", "reporting-scope", "reporting_visibility_scope"],
  ["canBeCaseOwner", "case-owner", "can_be_case_owner"],
] as const;

async function owner(request: APIRequestContext) {
  // The repository Playwright configuration has already validated DATABASE_URL.
  // Never use this fixture helper against a canonical application listener.
  expect([8000, 18000]).not.toContain(Number(new URL(api).port));
  const status = await request.get(`${api}/api/v1/auth/bootstrap-status`);
  expect(status.ok(), await status.text()).toBeTruthy();
  if ((await status.json()).available) {
    const created = await request.post(`${api}/api/v1/auth/bootstrap`, { data: {
      secret: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret",
      full_name: "Platform Owner", employee_code: "EMP-OWNER", email: "owner@example.com",
      mobile: "+971500000000", joining_date: "2026-01-01", employment_status: "Active",
      password: "OwnerPass1!", designation_name: "Owner", designation_code: "OWN",
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  const login = await request.post(`${api}/api/v1/auth/login`, { data: { email: "owner@example.com", password: "OwnerPass1!" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": (await login.json()).csrfToken as string };
}

async function roles(request: APIRequestContext): Promise<Role[]> {
  const response = await request.get(`${api}/api/v1/user-types`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).items;
}

/** Restore only pre-existing role configuration changed by this spec file.
 * Tests retain their deliberately restricted actors and all allow/deny assertions.
 * No records, history, permissions, or results are mocked or silently discarded.
 */
export function preserveBuiltInRoleConfiguration() {
  let snapshot: Role[] = [];
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    try {
      await owner(request);
      snapshot = (await roles(request)).filter(role => role.isSystem || builtInCodes.has(role.code));
    } finally { await request.dispose(); }
  });
  test.afterAll(async ({ playwright }) => {
    if (!snapshot.length) return;
    const request = await playwright.request.newContext();
    try {
      const headers = await owner(request);
      const current = await roles(request);
      for (const original of snapshot) {
        const changed = current.find(role => role.id === original.id);
        expect(changed, `Existing role ${original.code} must remain present`).toBeTruthy();
        for (const [field, path, key] of fields) {
          if (JSON.stringify(changed![field]) === JSON.stringify(original[field])) continue;
          const restored = await request.put(`${api}/api/v1/user-types/${original.id}/${path}`, { headers, data: { [key]: original[field] } });
          expect(restored.ok(), `${original.code}.${field}: ${await restored.text()}`).toBeTruthy();
        }
      }
      const restored = await roles(request);
      for (const original of snapshot) {
        const actual = restored.find(role => role.id === original.id)!;
        for (const [field] of fields) expect(actual[field], `${original.code}.${field} restored`).toEqual(original[field]);
      }
    } finally { await request.dispose(); }
  });
}
