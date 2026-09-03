import { expect, test, type APIRequestContext } from "@playwright/test";
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
    ).json()) as {
      items: {
        id: string;
        status: string;
        stages: { id: string; systemKey: string | null }[];
      }[];
    }
  ).items;
  let workflow = workflows.find(
    (item) =>
      item.status === "active" &&
      item.stages.some((stage) => stage.systemKey === "submitted"),
  );
  if (!workflow) {
    const created = await request.post(`${apiOrigin}/api/v1/workflows`, {
      headers,
      data: { bank_id: dib!.id, product_id: pf!.id },
    });
    expect(created.ok()).toBeTruthy();
    const createdWorkflow = (await created.json()) as {
      id: string;
      stages: { id: string; systemKey: string | null }[];
    };
    const added = await request.post(
      `${apiOrigin}/api/v1/workflows/${createdWorkflow.id}/stages`,
      {
        headers,
        data: { name: "Submitted", code: "SUBMITTED", sort_order: 2 },
      },
    );
    expect(added.ok(), await added.text()).toBeTruthy();
    const refreshed = (await (
      await request.get(`${apiOrigin}/api/v1/workflows/${createdWorkflow.id}`)
    ).json()) as { stages: { id: string; systemKey: string | null }[] };
    const entry = refreshed.stages.find(
      (stage) => stage.systemKey === "application_created",
    );
    const submitted = refreshed.stages.find((stage) => stage.systemKey === "submitted");
    expect(entry && submitted).toBeTruthy();
    const transitions = await request.put(
      `${apiOrigin}/api/v1/workflows/${createdWorkflow.id}/transitions`,
      {
        headers,
        data: {
          items: [{ from_stage_id: entry!.id, to_stage_id: submitted!.id }],
        },
      },
    );
    expect(transitions.ok(), await transitions.text()).toBeTruthy();
    workflow = {
      id: createdWorkflow.id,
      status: "active",
      stages: refreshed.stages,
    };
  }
  expect(workflow).toBeTruthy();
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
  await selectBrandedOption(page.getByLabel("Customer", { exact: true }), { label: new RegExp(`App Customer ${suffix}`) });
  await selectBrandedOption(page.getByLabel("Bank", { exact: true }), { label: /\(DIB\)$/ });
  await selectBrandedOption(page.getByLabel("Product Category", { exact: true }), { label: /\(PF\)$/ });
  await selectBrandedOption(page.getByLabel("Product Variant", { exact: true }), { label: `${prerequisites.variant.name} (${prerequisites.variant.code})` });
  await selectBrandedOption(page.getByLabel("Case Owner"), { label: /Platform Owner/ });
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
  await expect(page.getByLabel("Product Variant", { exact: true })).toHaveAttribute("value", prerequisites.variant.id);

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
  const detailVariant = page.getByLabel("Product Variant", { exact: true });
  await expect(detailVariant).toHaveAttribute("value", prerequisites.variant.id);
  await selectBrandedOption(detailVariant, { label: `${replacementName} (${replacementCode})` });
  await expect(detailVariant).toHaveAttribute("value", replacementBody.id);
  await page.getByRole("button", { name: "Save Product Variant" }).click();
  await expect(page.getByRole("status")).toContainText("Product Variant saved");
  await expect(page.getByLabel("Product Variant", { exact: true })).toHaveAttribute("value", replacementBody.id);
  const deactivate = await page.request.post(
    `${apiOrigin}/api/v1/product-variants/${replacementBody.id}/deactivate`,
    { headers: variantHeaders },
  );
  expect(deactivate.ok(), await deactivate.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel("Product Variant", { exact: true })).toHaveAttribute("value", replacementBody.id);
  await expect(page.getByLabel("Product Variant", { exact: true })).toContainText("unavailable for new selection");
  await expect(page.getByText("inactive", { exact: true }).first()).toBeVisible();
  await page.goto("/applications");
  await selectBrandedOption(page.getByLabel("Filter product variant"), {
    label: `${replacementName} (${replacementCode}) — Inactive`,
  });
  await page.getByRole("button", { name: "Apply filters" }).click();
  const variantRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: applicationId }) });
  await expect(variantRow).toContainText(replacementName);
  await expect(variantRow).toContainText(replacementCode);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search applications").fill(replacementCode);
  await expect(page.getByRole("link", { name: applicationId })).toBeVisible();
  await page.getByRole("link", { name: applicationId }).click();
  await page.getByLabel("Bank File / Case Number").fill(`REVIEW-${suffix}`);
  await page.getByRole("button", { name: "Save and submit" }).click();
  await expect(page.getByRole("heading", { name: "Correct submitted data" })).toBeVisible();
  await selectBrandedOption(page.getByLabel("Corrected Product Variant"), prerequisites.variant.id);
  await page.getByLabel("Submitted data correction reason").fill("Correct Variant classification");
  await page.getByRole("button", { name: "Correct submitted data" }).click();
  await expect(page.getByText(`${prerequisites.variant.name} (${prerequisites.variant.code})`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Product Variant: .* → /)).toContainText(prerequisites.variant.code);
  await page.goto("/applications");
  await page.getByLabel("Search applications").fill(applicationId);
  await selectBrandedOption(page.getByLabel("Filter by bank"), prerequisites.bank.id);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: applicationId })).toBeVisible();
  await selectBrandedOption(page.getByLabel("Filter by bank"), { label: /\(EIB\)$/ });
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
  await selectBrandedOption(page.getByLabel("Filter case owner"), { label: /Platform Owner/ });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: applicationId })).toBeVisible();
});
