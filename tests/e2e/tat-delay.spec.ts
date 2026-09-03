import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

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

async function csrfHeaders(page: Page) {
  const me = await page.request.get(`${apiOrigin}/api/v1/auth/me`);
  expect(me.ok()).toBeTruthy();
  const csrf = ((await me.json()) as { csrfToken: string }).csrfToken;
  return { "X-CSRF-Token": csrf };
}

async function preparePrereqs(request: APIRequestContext) {
  await ensureOwner(request);
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok()).toBeTruthy();
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const headers = { "X-CSRF-Token": csrf };
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
    ).json()) as { items: { status: string }[] }
  ).items;
  if (!workflows.some((item) => item.status === "active")) {
    const created = await request.post(`${apiOrigin}/api/v1/workflows`, {
      headers,
      data: { bank_id: dib!.id, product_id: pf!.id },
    });
    expect(created.ok()).toBeTruthy();
  }
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 30_000,
  });
}

test("elapsed TAT, mark delay, list badge, timeline, and correction", async ({ page, request }) => {
  test.setTimeout(120_000);
  await preparePrereqs(request);
  await signIn(page);
  const suffix = Date.now().toString().slice(-8);
  const headers = await csrfHeaders(page);
  const customer = await page.request.post(`${apiOrigin}/api/v1/customers`, {
    headers,
    data: {
      customer_type: "individual",
      full_name: `TAT Customer ${suffix}`,
      mobile: `+97156${suffix}`,
    },
  });
  expect(customer.ok()).toBeTruthy();
  const customerBody = (await customer.json()) as { id: string };
  const banks = (
    (await (await page.request.get(`${apiOrigin}/api/v1/banks`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const products = (
    (await (await page.request.get(`${apiOrigin}/api/v1/products`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const owners = (
    (await (await page.request.get(`${apiOrigin}/api/v1/users/case-owners`)).json()) as {
      items: { id: string }[];
    }
  ).items;
  const dib = banks.find((item) => item.code === "DIB");
  const pf = products.find((item) => item.code === "PF");
  const mapping = (
    (await (
      await page.request.get(
        `${apiOrigin}/api/v1/bank-products?bankId=${dib!.id}&productId=${pf!.id}`,
      )
    ).json()) as { items: { id: string }[] }
  ).items[0];
  let variant = (
    (await (
      await page.request.get(`${apiOrigin}/api/v1/product-variants?bankProductId=${mapping.id}`)
    ).json()) as { items: { id: string }[] }
  ).items[0];
  if (!variant) {
    const createdVariant = await page.request.post(`${apiOrigin}/api/v1/product-variants`, {
      headers,
      data: {
        bank_product_id: mapping.id,
        name: "TAT Personal Finance",
        code: `TAT-PF-${Date.now()}`,
      },
    });
    expect(createdVariant.ok(), await createdVariant.text()).toBeTruthy();
    variant = (await createdVariant.json()) as { id: string };
  }
  const created = await page.request.post(`${apiOrigin}/api/v1/applications`, {
    headers,
    data: {
      customer_id: customerBody.id,
      bank_id: dib!.id,
      product_id: pf!.id,
      product_variant_id: variant.id,
      case_owner_id: owners[0]!.id,
      requested_amount: "12000",
    },
  });
  expect(created.ok()).toBeTruthy();
  const app = (await created.json()) as { id: string; applicationCode: string };
  await page.goto(`/applications/${app.id}`);
  await expect(page).toHaveURL(`/applications/${app.id}`);
  await expect(page.getByRole("heading", { name: "Turnaround time" })).toBeVisible();
  await expect(page.getByText("Elapsed TAT", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stage durations" })).toBeVisible();
  await selectBrandedOption(page.getByLabel("Delay type"), "Bank");
  await page.getByLabel("Delay reason").fill("Waiting for bank checklist");
  await page.getByRole("button", { name: "Mark Delay" }).click();
  await expect(page.getByText("Delay · Bank").first()).toBeVisible();
  await expect(page.getByText("Active delay · Bank", { exact: false })).toBeVisible();
  await expect(page.getByText("delay marked", { exact: true })).toBeVisible();
  await page.goto("/applications");
  await page.getByLabel("Search applications").fill(app.applicationCode);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: app.applicationCode })).toHaveCount(1);
  const delayedRow = page.getByRole("row").filter({ hasText: app.applicationCode });
  await expect(delayedRow.getByText("Delay · Bank")).toBeVisible();
  await delayedRow.getByRole("link", { name: app.applicationCode }).click();
  await selectBrandedOption(page.getByLabel("Correction action"), "cancel");
  await page.getByRole("textbox", { name: "Correction reason", exact: true }).fill("Marked in error");
  await page.getByRole("button", { name: "Correct Delay" }).click();
  await expect(page.getByText("delay cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mark Delay" })).toBeVisible();
  await page.goto("/applications");
  await page.getByLabel("Search applications").fill(app.applicationCode);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: app.applicationCode })).toHaveCount(1);
  await expect(
    page.getByRole("row").filter({ hasText: app.applicationCode }).getByText("Delay · Bank"),
  ).toHaveCount(0);
});
