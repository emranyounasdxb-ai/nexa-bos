import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

type Ref = { id: string; code: string; name: string };

function testMobile(tag: string): string {
  let hash = 2166136261;
  for (const character of tag) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `+9715${String(hash >>> 0).padStart(8, "0").slice(-8)}`;
}

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
  return {
    bank: dib!,
    product: pf!,
    mappingId: mappings[0].id,
    variant: variants[0],
    workflow,
    headers,
  };
}

async function createApplicationFixture(request: APIRequestContext, tag: string) {
  const prerequisites = await prepareApplicationPrereqs(request);
  const meResponse = await request.get(`${apiOrigin}/api/v1/auth/me`);
  expect(meResponse.ok(), await meResponse.text()).toBeTruthy();
  const owner = (await meResponse.json()) as { id: string };
  const customerResponse = await request.post(`${apiOrigin}/api/v1/customers`, {
    headers: prerequisites.headers,
    data: {
      customer_type: "individual",
      full_name: `Application Workspace ${tag}`,
      mobile: testMobile(tag),
      email: `application-${tag.toLowerCase()}@example.com`,
    },
  });
  expect(customerResponse.ok(), await customerResponse.text()).toBeTruthy();
  const customer = (await customerResponse.json()) as { id: string };
  const applicationResponse = await request.post(`${apiOrigin}/api/v1/applications`, {
    headers: prerequisites.headers,
    data: {
      customer_id: customer.id,
      bank_id: prerequisites.bank.id,
      product_id: prerequisites.product.id,
      product_variant_id: prerequisites.variant.id,
      case_owner_id: owner.id,
      requested_amount: "17500",
    },
  });
  expect(applicationResponse.ok(), await applicationResponse.text()).toBeTruthy();
  const application = (await applicationResponse.json()) as {
    id: string;
    applicationCode: string;
  };
  const submitted = await request.post(
    `${apiOrigin}/api/v1/applications/${application.id}/case-number`,
    {
      headers: prerequisites.headers,
      data: { bank_case_number: `CASE-${tag}` },
    },
  );
  expect(submitted.ok(), await submitted.text()).toBeTruthy();

  const workflowResponse = await request.get(
    `${apiOrigin}/api/v1/workflows?bank_id=${prerequisites.bank.id}&product_id=${prerequisites.product.id}`,
  );
  expect(workflowResponse.ok(), await workflowResponse.text()).toBeTruthy();
  let workflows = (await workflowResponse.json()) as {
    items: { id: string; version: number; stages: { id: string; name: string }[] }[];
  };
  if (!workflows.items.some((entry) => entry.id !== prerequisites.workflow!.id)) {
    const created = await request.post(`${apiOrigin}/api/v1/workflows`, {
      headers: prerequisites.headers,
      data: { bank_id: prerequisites.bank.id, product_id: prerequisites.product.id },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const createdWorkflow = (await created.json()) as {
      id: string;
      version: number;
      stages: { id: string; name: string }[];
    };
    workflows = { items: [...workflows.items, createdWorkflow] };
  }
  const migrationTarget = workflows.items.find(
    (entry) => entry.id !== prerequisites.workflow!.id,
  );
  expect(migrationTarget?.stages.length).toBeGreaterThan(0);
  return { application, migrationTarget: migrationTarget! };
}

async function createViewer(request: APIRequestContext, tag: string) {
  const headers = await ownerHeaders(request);
  const typesResponse = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Application Viewer ${tag}`, code: `AV${tag}` },
  });
  expect(typesResponse.ok(), await typesResponse.text()).toBeTruthy();
  const userType = (await typesResponse.json()) as { id: string };
  expect((await request.post(`${apiOrigin}/api/v1/user-types/${userType.id}/activate`, { headers })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/permissions`, { headers, data: { permissions: ["Applications.View"] } })).ok()).toBeTruthy();
  expect((await request.put(`${apiOrigin}/api/v1/user-types/${userType.id}/application-scope`, { headers, data: { application_visibility_scope: "company" } })).ok()).toBeTruthy();
  const designations = ((await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: Ref[] }).items;
  const userResponse = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Application Viewer ${tag}`,
      employee_code: `EMP-AV-${tag}`,
      email: `application-viewer-${tag}@example.com`,
      mobile: testMobile(`viewer-${tag}`),
      designation_id: designations[0]!.id,
      employment_status: "Active",
      joining_date: "2026-02-01",
    },
  });
  expect(userResponse.ok(), await userResponse.text()).toBeTruthy();
  const viewer = (await userResponse.json()) as { id: string; email: string };
  expect((await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/assign-type`, { headers, data: { user_type_id: userType.id } })).ok()).toBeTruthy();
  expect((await request.post(`${apiOrigin}/api/v1/users/${viewer.id}/activate`, { headers })).ok()).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${viewer.id}/setup-link`, { headers });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  expect((await request.post(`${apiOrigin}/api/v1/auth/setup`, { data: { token, password: "UserPass1!" } })).ok()).toBeTruthy();
  return viewer;
}

async function signIn(page: Page, email = "owner@example.com", password = "OwnerPass1!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("banner")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Save corrections" })).toBeVisible();
  await page.goto("/applications/new");
  await page.getByLabel("Link visible existing customer").check();
  await selectBrandedOption(page.getByLabel("Customer", { exact: true }), { label: new RegExp(`App Customer ${suffix}`) });
  await selectBrandedOption(page.getByLabel("Bank", { exact: true }), { label: /\(DIB\)$/ });
  await selectBrandedOption(page.getByLabel("Product Category", { exact: true }), { label: /\(PF\)$/ });
  await selectBrandedOption(page.getByLabel("Product Variant", { exact: true }), { label: `${prerequisites.variant.name} (${prerequisites.variant.code})` });
  await expect(page.getByText(/Initial Case Owner:.*Platform Owner/)).toBeVisible();
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
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Workflow & TAT" }).click();
  await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByRole("heading", { name: "Immutable timeline" })).toBeVisible();
  await expect(page.getByText("Application Created", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
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
  await page.getByRole("tab", { name: "Corrections & Actions" }).click();
  await page.getByLabel("Bank File / Case Number").fill(`REVIEW-${suffix}`);
  await page.getByRole("button", { name: "Save and submit" }).click();
  await expect(page.getByRole("status")).toContainText("Application submitted", {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Correct submitted data" })).toBeVisible();
  await selectBrandedOption(page.getByLabel("Corrected Product Variant"), prerequisites.variant.id);
  await page.getByLabel("Submitted data correction reason").fill("Correct Variant classification");
  await page.getByRole("button", { name: "Correct submitted data" }).click();
  await expect(page.getByRole("alertdialog", { name: "Correct submitted application data?" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm correction" }).click();
  await expect(page.getByRole("status")).toContainText("Submitted data correction recorded");
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText(`${prerequisites.variant.name} (${prerequisites.variant.code})`, { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Timeline" }).click();
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

test("application detail sections, confirmations, timeline filters, permissions, and responsive layout", async ({ page, request }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString().slice(-7);
  const { application, migrationTarget } = await createApplicationFixture(request, suffix);
  const viewer = await createViewer(request, suffix);

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto(`/applications/${application.id}?tab=timeline`);
  await expect(page.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/tab=timeline/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Application Created", { exact: true }).first()).toBeVisible();
  await selectBrandedOption(page.getByLabel("Filter timeline by event type"), "application_created");
  await expect(page.getByText(/1 of \d+ events/)).toBeVisible();
  await page.getByLabel("Search timeline").fill("no matching lifecycle event");
  await expect(page.getByText("No timeline events match the current filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear timeline filters" }).click();

  const timelineTab = page.getByRole("tab", { name: "Timeline" });
  await timelineTab.focus();
  await timelineTab.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Corrections & Actions" })).toBeFocused();
  await expect(page).toHaveURL(/tab=actions/);

  const caseCorrection = page.getByRole("button", { name: "Correct case number" });
  await expect(page.getByLabel("Bank File / Case Number")).toHaveValue(`CASE-${suffix}`);
  await page.getByLabel("Case number correction reason").fill("Verify confirmation only");
  await caseCorrection.click();
  await expect(page.getByRole("alertdialog", { name: "Correct submitted case number?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(caseCorrection).toBeFocused();

  const submittedCorrection = page.getByRole("button", { name: "Correct submitted data" });
  await page.getByLabel("Submitted data correction reason").fill("Verify submitted correction confirmation");
  await submittedCorrection.click();
  await expect(page.getByRole("alertdialog", { name: "Correct submitted application data?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(submittedCorrection).toBeFocused();

  await selectBrandedOption(page.getByLabel("Corrected stage"), { label: "Application Created" });
  await page.getByLabel("Stage correction reason").fill("Verify stage correction confirmation");
  const stageCorrection = page.getByRole("button", { name: "Append correction" });
  await stageCorrection.click();
  await expect(page.getByRole("alertdialog", { name: "Append stage correction?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stageCorrection).toBeFocused();

  await selectBrandedOption(page.getByLabel("New Case Owner"), { label: /Platform Owner/ });
  const reassign = page.getByRole("button", { name: "Reassign", exact: true });
  await reassign.click();
  await expect(page.getByRole("alertdialog", { name: "Reassign Case Owner?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reassign).toBeFocused();

  await selectBrandedOption(page.getByLabel("Target workflow"), migrationTarget.id);
  await selectBrandedOption(page.getByLabel("Migration target stage"), migrationTarget.stages[0].id);
  await page.getByLabel("Migration reason").fill("Verify migration confirmation");
  const migrate = page.getByRole("button", { name: "Migrate this application" });
  await migrate.click();
  await expect(page.getByRole("alertdialog", { name: "Migrate workflow version?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(migrate).toBeFocused();

  await page.getByLabel("Outcome reason").fill("Verify terminal confirmation");
  const close = page.getByRole("button", { name: "Close application" });
  await close.click();
  await expect(page.getByRole("alertdialog", { name: "Close application as Final Rejected?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(close).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: application.applicationCode })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();

  await page.getByLabel("Open user menu").click();
  await page.locator("header").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await signIn(page, viewer.email, "UserPass1!");
  await page.goto(`/applications/${application.id}?tab=actions`);
  await expect(page.getByRole("tab", { name: "Corrections & Actions" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Save and submit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Correct case number" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Append correction" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reassign", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Migrate this application" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close application" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});
