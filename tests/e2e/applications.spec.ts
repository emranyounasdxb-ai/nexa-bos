import { expect, test, type APIRequestContext } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) {
    return;
  }
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
  expect(created.ok()).toBeTruthy();
}

async function ownerHeaders(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok()).toBeTruthy();
  const body = (await login.json()) as { csrfToken: string };
  return { "X-CSRF-Token": body.csrfToken };
}

async function prepareApplicationPrereqs(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const types = (
    (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as {
      items: { id: string; code: string; canBeCaseOwner: boolean }[];
    }
  ).items;
  const ownerType = types.find((item) => item.code === "OWNER");
  expect(ownerType).toBeTruthy();
  if (!ownerType!.canBeCaseOwner) {
    const enabled = await request.put(`${apiOrigin}/api/v1/user-types/${ownerType!.id}/case-owner`, {
      headers,
      data: { can_be_case_owner: true },
    });
    expect(enabled.ok()).toBeTruthy();
  }
  const banks = (
    (await (await request.get(`${apiOrigin}/api/v1/banks`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const products = (
    (await (await request.get(`${apiOrigin}/api/v1/products`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const dib = banks.find((item) => item.code === "DIB");
  const pf = products.find((item) => item.code === "PF");
  expect(dib && pf).toBeTruthy();
  const workflows = (
    (await (
      await request.get(`${apiOrigin}/api/v1/workflows?bank_id=${dib!.id}&product_id=${pf!.id}`)
    ).json()) as { items: { id: string; status: string }[] }
  ).items;
  if (!workflows.some((item) => item.status === "active")) {
    const created = await request.post(`${apiOrigin}/api/v1/workflows`, {
      headers,
      data: { bank_id: dib!.id, product_id: pf!.id },
    });
    expect(created.ok()).toBeTruthy();
  }
  const mappings = (
    (await (
      await request.get(
        `${apiOrigin}/api/v1/bank-products?bankId=${dib!.id}&productId=${pf!.id}`,
      )
    ).json()) as { items: { id: string }[] }
  ).items;
  expect(mappings).toHaveLength(1);
  let variants = (
    (await (
      await request.get(`${apiOrigin}/api/v1/product-variants?bankProductId=${mappings[0].id}`)
    ).json()) as { items: { id: string; name: string; code: string }[] }
  ).items;
  if (variants.length === 0) {
    const created = await request.post(`${apiOrigin}/api/v1/product-variants`, {
      headers,
      data: {
        bank_product_id: mappings[0].id,
        name: "Personal Finance Standard",
        code: "PF-STANDARD",
        description: "Playwright application variant",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    variants = [
      (await created.json()) as { id: string; name: string; code: string },
    ];
  }
  return { bank: dib!, product: pf!, mappingId: mappings[0].id, variant: variants[0], headers };
}

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("owner can create an application and filter the list", async ({ page, request }) => {
  test.setTimeout(120_000);
  const prerequisites = await prepareApplicationPrereqs(request);
  await signIn(page);
  const suffix = Date.now().toString().slice(-8);
  await page.goto("/customers/new");
  await page.getByLabel("Full name").fill(`App Customer ${suffix}`);
  await page.getByLabel("Mobile").fill(`+97155${suffix}`);
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.goto("/applications/new");
  const customerOption = page.getByLabel("Customer", { exact: true }).locator("option").filter({
    hasText: `App Customer ${suffix}`,
  });
  await expect(customerOption).toHaveCount(1, { timeout: 30_000 });
  const customerLabel = (await customerOption.textContent())?.trim() ?? "";
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: customerLabel });
  const bankOption = page.getByLabel("Bank", { exact: true }).locator("option").filter({ hasText: "(DIB)" });
  await expect(bankOption).toHaveCount(1, { timeout: 30_000 });
  const bankLabel = (await bankOption.textContent())?.trim() ?? "";
  await page.getByLabel("Bank", { exact: true }).selectOption({ label: bankLabel });
  const productOption = page.getByLabel("Product Category", { exact: true }).locator("option").filter({ hasText: "(PF)" });
  await expect(productOption).toHaveCount(1);
  const productLabel = (await productOption.textContent())?.trim() ?? "";
  await page.getByLabel("Product Category", { exact: true }).selectOption({ label: productLabel });
  await page.getByLabel("Product Variant", { exact: true }).selectOption({ label: `${prerequisites.variant.name} (${prerequisites.variant.code})` });
  const ownerOption = page.getByLabel("Case Owner").locator("option").filter({ hasText: "Platform Owner" });
  await expect(ownerOption).toHaveCount(1, { timeout: 30_000 });
  const ownerLabel = (await ownerOption.textContent())?.trim() ?? "";
  await page.getByLabel("Case Owner").selectOption({ label: ownerLabel });
  await page.getByLabel("Requested amount").fill("15000");
  await page.getByRole("button", { name: "Create application" }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]+$/, { timeout: 30_000 });
  const createdApplicationId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const createdApplication = await page.request.get(
    `${apiOrigin}/api/v1/applications/${createdApplicationId}`,
  );
  expect(createdApplication.ok(), await createdApplication.text()).toBeTruthy();
  const applicationId = ((await createdApplication.json()) as { applicationCode: string })
    .applicationCode;
  expect(applicationId).toMatch(/^PF-DIB-/);
  await expect(page.getByText("Application Created").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByText("application created", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product classification" })).toBeVisible();
  await expect(page.getByLabel("Product Variant", { exact: true })).toHaveValue(prerequisites.variant.id);

  const replacementName = `PF Premium ${suffix}`;
  const replacementCode = `PFP${suffix}`;
  const browserSession = await page.request.get(`${apiOrigin}/api/v1/auth/me`);
  expect(browserSession.ok(), await browserSession.text()).toBeTruthy();
  const variantHeaders = {
    "X-CSRF-Token": ((await browserSession.json()) as { csrfToken: string }).csrfToken,
  };
  const replacement = await page.request.post(`${apiOrigin}/api/v1/product-variants`, {
    headers: variantHeaders,
    data: {
      bank_product_id: prerequisites.mappingId,
      name: replacementName,
      code: replacementCode,
    },
  });
  expect(replacement.ok(), await replacement.text()).toBeTruthy();
  const replacementBody = (await replacement.json()) as { id: string };
  await page.reload();
  await page.getByLabel("Product Variant", { exact: true }).selectOption({ label: `${replacementName} (${replacementCode})` });
  await page.getByRole("button", { name: "Save Product Variant" }).click();
  await expect(page.getByRole("status")).toContainText("Product Variant saved");
  await expect(page.getByLabel("Product Variant", { exact: true })).toHaveValue(replacementBody.id);
  const deactivate = await page.request.post(
    `${apiOrigin}/api/v1/product-variants/${replacementBody.id}/deactivate`,
    { headers: variantHeaders },
  );
  expect(deactivate.ok(), await deactivate.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel("Product Variant", { exact: true })).toHaveValue(replacementBody.id);
  await expect(page.getByLabel("Product Variant", { exact: true }).locator("option:checked")).toContainText("unavailable for new selection");
  await expect(page.getByText("inactive", { exact: true }).first()).toBeVisible();
  await page.goto("/applications");
  await page.getByLabel("Search applications").fill(applicationId);
  await page.getByLabel("Filter by bank").selectOption({ label: "DIB" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: applicationId })).toBeVisible();
  await page.getByLabel("Filter by bank").selectOption({ label: "EIB" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: applicationId })).toHaveCount(0);
  const me = await page.request.get(`${apiOrigin}/api/v1/auth/me`);
  expect(me.ok()).toBeTruthy();
  const csrf = ((await me.json()) as { csrfToken: string }).csrfToken;
  const types = (
    (await (await page.request.get(`${apiOrigin}/api/v1/user-types`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const ownerType = types.find((item) => item.code === "OWNER");
  expect(ownerType).toBeTruthy();
  const disabled = await page.request.put(
    `${apiOrigin}/api/v1/user-types/${ownerType!.id}/case-owner`,
    {
      headers: { "X-CSRF-Token": csrf },
      data: { can_be_case_owner: false },
    },
  );
  expect(disabled.ok()).toBeTruthy();
  const referenced = await page.request.get(`${apiOrigin}/api/v1/applications/case-owners`);
  expect(referenced.ok()).toBeTruthy();
  const ownerNames = ((await referenced.json()) as { items: { fullName: string }[] }).items.map(
    (item) => item.fullName,
  );
  expect(ownerNames).toContain("Platform Owner");
  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
  await page.getByLabel("Search applications").fill(applicationId);
  await expect(
    page.getByLabel("Filter case owner").locator("option").filter({ hasText: "Platform Owner" }),
  ).toHaveCount(1, { timeout: 30_000 });
  await page.getByLabel("Filter case owner").selectOption({ label: "Platform Owner" });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: applicationId })).toBeVisible();
});
