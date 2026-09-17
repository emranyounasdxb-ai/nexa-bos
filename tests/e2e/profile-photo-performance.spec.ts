import { expect, test, type APIRequestContext, type Page, type Request, type Response } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";
const baseline = process.env.PROFILE_PERF_BASELINE === "1";
const userCount = 205;
const photo = readFileSync(path.resolve(__dirname, "../../apps/web/public/brand/amafh-dubai-banking-login.webp"));

type UserRow = { id: string; fullName: string; email: string; hasPhoto: boolean; updatedAt: string };
type Measurement = {
  route: string;
  photoRequests: number;
  duplicateRequests: number;
  transferredBytes: number;
  largestResponseBytes: number;
  elapsedMs: number;
  maxConcurrentRequests: number;
};

async function ownerHeaders(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  if (((await status.json()) as { available: boolean }).available) {
    const created = await request.post(`${apiOrigin}/api/v1/auth/bootstrap`, {
      data: {
        secret,
        full_name: "Platform Owner",
        employee_code: "EMP-OWNER",
        email: "owner@example.com",
        mobile: "+971500000000",
        joining_date: "2026-01-01",
        employment_status: "Active",
        password: "OwnerPass1!",
        designation_name: "Owner",
        designation_code: "OWN",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function listUsers(request: APIRequestContext): Promise<UserRow[]> {
  const first = await request.get(`${apiOrigin}/api/v1/users?page=1&page_size=50`);
  expect(first.ok(), await first.text()).toBeTruthy();
  const body = (await first.json()) as { items: UserRow[]; pagination: { totalPages: number } };
  const users = [...body.items];
  for (let page = 2; page <= body.pagination.totalPages; page += 1) {
    const response = await request.get(`${apiOrigin}/api/v1/users?page=${page}&page_size=50`);
    expect(response.ok(), await response.text()).toBeTruthy();
    users.push(...((await response.json()) as { items: UserRow[] }).items);
  }
  return users;
}

async function seedLargeDirectory(request: APIRequestContext, headers: Record<string, string>) {
  const existing = await request.get(`${apiOrigin}/api/v1/users?q=Performance%20User%20001&page_size=10`);
  expect(existing.ok(), await existing.text()).toBeTruthy();
  if (((await existing.json()) as { items: UserRow[] }).items.length === 0) {
    const rows = Array.from({ length: userCount }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return `Performance User ${number},performance-user-${number}@example.com,+97155${String(index + 1).padStart(7, "0")}`;
    });
    const csv = `full_name,personal_email,mobile\r\n${rows.join("\r\n")}\r\n`;
    const imported = await request.post(`${apiOrigin}/api/v1/users/bulk-upload/import`, {
      headers,
      multipart: { file: { name: "performance-users.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
      timeout: 180_000,
    });
    expect(imported.ok(), await imported.text()).toBeTruthy();
    expect(((await imported.json()) as { importedCount: number }).importedCount).toBe(userCount);
  }

  const users = await listUsers(request);
  const targets = users.filter((user) => user.email === "owner@example.com" || user.email.startsWith("performance-user-"));
  expect(targets.length).toBe(userCount + 1);
  const pending = targets.filter((user) => user.email === "owner@example.com" || !user.hasPhoto);
  for (let start = 0; start < pending.length; start += 8) {
    const batch = pending.slice(start, start + 8);
    await Promise.all(batch.map(async (user) => {
      const uploaded = await request.post(`${apiOrigin}/api/v1/users/${user.id}/photo`, {
        headers,
        multipart: { file: { name: "performance-avatar.webp", mimeType: "image/webp", buffer: photo } },
        timeout: 60_000,
      });
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    }));
  }
  const missing = await request.get(`${apiOrigin}/api/v1/users?q=Performance%20Missing%20Photo&page_size=10`);
  expect(missing.ok(), await missing.text()).toBeTruthy();
  if (((await missing.json()) as { items: UserRow[] }).items.length === 0) {
    const csv = "full_name,personal_email,mobile\r\nPerformance Missing Photo,performance-missing-photo@example.com,+971559999999\r\n";
    const imported = await request.post(`${apiOrigin}/api/v1/users/bulk-upload/import`, {
      headers,
      multipart: { file: { name: "missing-photo-user.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } },
    });
    expect(imported.ok(), await imported.text()).toBeTruthy();
  }
  return listUsers(request);
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
}

function photoPath(response: Response) {
  return new URL(response.url()).pathname.match(/^\/api\/v1\/users\/[^/]+\/photo$/);
}

async function measure(page: Page, route: string, settled: (routePage: Page) => Promise<void>): Promise<Measurement> {
  const routePage = await page.context().newPage();
  await routePage.setViewportSize({ width: 1440, height: 900 });
  const responses: Array<{ url: string; bytes: number }> = [];
  const active = new Set<Request>();
  let maxConcurrentRequests = 0;
  const requestStarted = (request: Request) => {
    if (!new URL(request.url()).pathname.match(/^\/api\/v1\/users\/[^/]+\/photo$/)) return;
    active.add(request);
    maxConcurrentRequests = Math.max(maxConcurrentRequests, active.size);
  };
  const requestFinished = (request: Request) => active.delete(request);
  const collect = (response: Response) => {
    if (!photoPath(response)) return;
    responses.push({
      url: response.url(),
      bytes: Number(response.headers()["content-length"] ?? 0),
    });
  };
  routePage.on("response", collect);
  routePage.on("request", requestStarted);
  routePage.on("requestfinished", requestFinished);
  routePage.on("requestfailed", requestFinished);
  const started = performance.now();
  await routePage.goto(route);
  await settled(routePage);
  await routePage.waitForLoadState("networkidle");
  const elapsedMs = Math.round(performance.now() - started);
  routePage.off("response", collect);
  routePage.off("request", requestStarted);
  routePage.off("requestfinished", requestFinished);
  routePage.off("requestfailed", requestFinished);
  const photos = responses;
  const keys = photos.map((entry) => entry.url);
  const result = {
    route,
    photoRequests: photos.length,
    duplicateRequests: photos.length - new Set(keys).size,
    transferredBytes: photos.reduce((total, entry) => total + entry.bytes, 0),
    largestResponseBytes: Math.max(0, ...photos.map((entry) => entry.bytes)),
    elapsedMs,
    maxConcurrentRequests,
  };
  await routePage.close();
  return result;
}

test("large authenticated views bound profile-photo requests and transfer thumbnail payloads", async ({ page, request }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(30_000);
  const headers = await ownerHeaders(request);
  const users = await seedLargeDirectory(request, headers);
  expect(users.filter((user) => user.hasPhoto).length).toBeGreaterThanOrEqual(200);
  const proPage = await request.get(`${apiOrigin}/api/v1/employee-profiles/dashboards/pro?page=2&pageSize=10`);
  expect(proPage.ok(), await proPage.text()).toBeTruthy();
  const proPayload = (await proPage.json()) as {
    compliance: unknown[];
    compliancePagination: { page: number; pageSize: number; total: number };
  };
  expect(proPayload.compliance).toHaveLength(10);
  expect(proPayload.compliancePagination).toMatchObject({ page: 2, pageSize: 10 });
  expect(proPayload.compliancePagination.total).toBeGreaterThanOrEqual(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  const metrics = [
    await measure(page, "/users?pageSize=50", async (routePage) => {
      await expect(routePage.getByTestId("users-directory-table")).toBeVisible();
    }),
    await measure(page, "/organization/hierarchy", async (routePage) => {
      await expect(routePage.getByRole("heading", { name: "Organization hierarchy" })).toBeVisible();
      await routePage.getByLabel("Include inactive / historical employees").check();
      await expect(routePage.getByText(/\d+ visible employees · company scope/)).toBeVisible();
    }),
    await measure(page, "/account", async (routePage) => {
      await expect(routePage.getByLabel("Profile photo for Platform Owner").locator("img")).toBeVisible();
    }),
    await measure(page, `/users/${users.find((user) => user.email === "performance-user-001@example.com")!.id}`, async (routePage) => {
      await expect(routePage.getByRole("heading", { name: "Performance User 001" })).toBeVisible();
    }),
    await measure(page, "/reports", async (routePage) => {
      await expect(routePage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    }),
  ];

  console.log(`PROFILE_PERFORMANCE ${JSON.stringify(metrics)}`);
  if (baseline) return;

  for (const metric of metrics) {
    expect(metric.duplicateRequests, `${metric.route} duplicated a photo/version request`).toBe(0);
    expect(metric.largestResponseBytes, `${metric.route} served a full-size avatar`).toBeLessThan(80_000);
    expect(metric.maxConcurrentRequests, `${metric.route} exceeded the photo request limit`).toBeLessThanOrEqual(6);
  }
  expect(metrics[0].photoRequests).toBeLessThanOrEqual(24);
  expect(metrics[1].photoRequests).toBeLessThanOrEqual(24);
  expect(metrics[2].photoRequests).toBeLessThanOrEqual(2);
  expect(metrics[3].photoRequests).toBeLessThanOrEqual(2);
  expect(metrics[4].photoRequests).toBeLessThanOrEqual(1);

  const ownerId = users.find((user) => user.email === "owner@example.com")!.id;
  let ownerNavigationRequests = 0;
  page.on("response", (response) => {
    if (response.url().includes(`/api/v1/users/${ownerId}/photo`)) ownerNavigationRequests += 1;
  });
  await page.getByRole("button", { name: "Open user menu", exact: true }).click();
  await page.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "My profile", exact: true }).click();
  await expect(page.getByLabel("Profile photo for Platform Owner").locator("img")).toBeVisible();
  await page.locator('#application-sidebar a[aria-label="Dashboard"]').click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Open user menu", exact: true }).click();
  await page.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "My profile", exact: true }).click();
  await expect(page.getByLabel("Profile photo for Platform Owner").locator("img")).toBeVisible();
  expect(ownerNavigationRequests).toBeLessThanOrEqual(1);

  const missingPhotoUser = users.find((user) => user.email === "performance-missing-photo@example.com")!;
  const missingPage = await page.context().newPage();
  let missingPhotoRequests = 0;
  missingPage.on("request", (request) => {
    if (request.url().includes(`/api/v1/users/${missingPhotoUser.id}/photo`)) missingPhotoRequests += 1;
  });
  await missingPage.goto("/users?q=Performance%20Missing%20Photo");
  await expect(missingPage.getByRole("link", { name: "Performance Missing Photo", exact: true })).toBeVisible();
  await missingPage.waitForLoadState("networkidle");
  expect(missingPhotoRequests).toBe(0);
  await missingPage.close();

  const serviceWorkerApiEntries = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return entries.flat().map((entry) => entry.url).filter((url) => url.includes("/api/") || url.includes("/users/") && url.includes("/photo"));
  });
  expect(serviceWorkerApiEntries).toEqual([]);
});
