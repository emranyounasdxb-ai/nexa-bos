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

async function createSalesExecutive(request: APIRequestContext, tag: string) {
  const headers = await ownerHeaders(request);
  const types = ((await (
    await request.get(`${apiOrigin}/api/v1/user-types`, { headers })
  ).json()) as { items: Array<{ id: string; code: string }> }).items;
  const seType = types.find((item) => item.code === "SE")!;
  for (const [path, data] of [
    [
      "permissions",
      {
        permissions: [
          "Dashboard.View",
          "Notifications.View",
          "Notifications.ManageRules",
          "Notifications.SendUrgent",
          "Notifications.ViewAudit",
          "Customers.View",
          "Customers.Create",
          "Customers.Edit",
          "Applications.View",
          "Applications.Create",
          "Applications.Edit",
        ],
      },
    ],
    ["application-scope", { application_visibility_scope: "own" }],
    ["customer-scope", { customer_visibility_scope: "own" }],
    ["case-owner", { can_be_case_owner: true }],
  ] as const) {
    const configured = await request.put(`${apiOrigin}/api/v1/user-types/${seType.id}/${path}`, {
      headers,
      data,
    });
    expect(configured.ok(), await configured.text()).toBeTruthy();
  }
  const designations = ((await (
    await request.get(`${apiOrigin}/api/v1/designations`, { headers })
  ).json()) as { items: Ref[] }).items;
  const created = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Disposable SE ${tag}`,
      employee_code: `SE${tag}`,
      email: `se-application-${tag}@example.com`,
      mobile: testMobile(`se-${tag}`),
      designation_id: designations[0]!.id,
      employment_status: "Active",
      joining_date: "2026-09-04",
      user_type_id: seType.id,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const user = (await created.json()) as { id: string; email: string };
  expect(
    (await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers })).ok(),
  ).toBeTruthy();
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${user.id}/setup-link`, {
    headers,
  });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  expect(
    (
      await request.post(`${apiOrigin}/api/v1/auth/setup`, {
        data: { token, password: "UserPass1!" },
      })
    ).ok(),
  ).toBeTruthy();
  return user;
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
  await page.goto("/applications");
  await page.getByRole("button", { name: "Create application" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create application" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel("Customer Emirates ID").fill(`784-APP-${suffix}`);
  await createDialog.getByLabel("Customer Full Name").fill(`App Customer ${suffix}`);
  await createDialog.getByLabel("Customer Mobile").fill(`+97155${suffix}`);
  await selectBrandedOption(createDialog.getByLabel("Bank", { exact: true }), { label: /\(DIB\)$/ });
  await selectBrandedOption(createDialog.getByLabel("Product", { exact: true }), { label: /\(PF\)$/ });
  await selectBrandedOption(createDialog.getByLabel("Product Variant", { exact: true }), { label: `${prerequisites.variant.name} (${prerequisites.variant.code})` });
  await expect(createDialog.getByText(/Initial Case Owner:.*Platform Owner/)).toBeVisible();
  await createDialog.getByLabel("Requested amount").fill("15000");
  await createDialog.getByRole("button", { name: "Create application" }).click();
  await expect(createDialog).toHaveCount(0, { timeout: 30_000 });
  const createdRow = page.getByRole("row").filter({ hasText: `App Customer ${suffix}` });
  await expect(createdRow).toBeVisible();
  await expect(createdRow).toContainText("Not assigned");
  const applicationLink = createdRow.getByRole("link");
  const applicationId = (await applicationLink.textContent())?.trim() ?? "";
  expect(applicationId).toMatch(/^PF-DIB-/);
  await expect(page.getByRole("status")).toContainText(`Application ${applicationId} created successfully.`);
  await applicationLink.click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]+$/, { timeout: 30_000 });
  const createdApplicationId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const createdApplication = await page.request.get(
    `${apiOrigin}/api/v1/applications/${createdApplicationId}`,
  );
  expect(createdApplication.ok(), await createdApplication.text()).toBeTruthy();
  expect(((await createdApplication.json()) as { applicationCode: string }).applicationCode).toBe(applicationId);
  await expect(page.getByRole("heading", { name: "Workflow timeline" })).toBeVisible();
  await expect(page.getByLabel("Search applications")).toHaveCount(0);
  await expect(page.getByLabel("Filter by bank")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Workflow & TAT" }).click();
  await expect(page.getByRole("heading", { name: "Current workflow state" })).toBeVisible();
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
  await page.getByLabel("Search applications").fill(replacementCode);
  const variantRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: applicationId }) });
  await expect(variantRow).toContainText(replacementName);
  await expect(variantRow).toContainText(replacementCode);
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
  const submittedRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: applicationId }) });
  await expect(submittedRow).toContainText(`REVIEW-${suffix}`);
  await selectBrandedOption(page.getByLabel("Filter by bank"), prerequisites.bank.id);
  await selectBrandedOption(page.getByLabel("Filter product"), prerequisites.product.id);
  const submittedStage = prerequisites.workflow.stages.find(
    (stage) => stage.systemKey === "submitted",
  );
  expect(submittedStage).toBeTruthy();
  await selectBrandedOption(page.getByLabel("Filter current stage"), submittedStage!.id);
  await selectBrandedOption(page.getByLabel("Filter terminal outcome"), "Completed");
  await page.getByLabel("Created Date").fill("2099-01-01 – 2099-01-31");
  await page.getByLabel("Created Date").press("Tab");
  const filteredRequest = page.waitForRequest((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === "/api/v1/applications" &&
      url.searchParams.get("bank_id") === prerequisites.bank.id &&
      url.searchParams.get("product_id") === prerequisites.product.id &&
      url.searchParams.get("current_stage_id") === submittedStage!.id &&
      url.searchParams.get("terminal_outcome") === "Completed" &&
      url.searchParams.get("created_from") === "2099-01-01" &&
      url.searchParams.get("created_to") === "2099-01-31"
    );
  });
  await page.getByRole("button", { name: "Apply filters" }).click();
  await filteredRequest;
  await expect(page.getByRole("link", { name: applicationId })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: applicationId })).toBeVisible();
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

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTestId("sidebar-footer").getByLabel("Open user menu").click();
  await page.getByRole("menu", { name: "User account" }).getByRole("menuitem", { name: "Sign out" }).click();
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

test("SE creates through exact identity matching without Customer directory or administrative notification access", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString().slice(-8);
  const prerequisites = await prepareApplicationPrereqs(request);
  const emiratesId = `784-SE-${suffix}`;
  const passport = `PSE${suffix}`;
  const customerResponse = await request.post(`${apiOrigin}/api/v1/customers`, {
    headers: prerequisites.headers,
    data: {
      customer_type: "individual",
      full_name: `Canonical SE Customer ${suffix}`,
      mobile: `+97154${suffix}`,
      emirates_id: emiratesId,
      passport,
    },
  });
  expect(customerResponse.ok(), await customerResponse.text()).toBeTruthy();
  const customer = (await customerResponse.json()) as { id: string };
  const salesExecutive = await createSalesExecutive(request, suffix);

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, salesExecutive.email, "UserPass1!");
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByLabel("Customers")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/api/v1/customers`)).status()).toBe(403);
  expect((await page.request.get(`${apiOrigin}/api/v1/customers/${customer.id}`)).status()).toBe(403);
  await page.goto("/customers");
  await expect(page.getByText("You do not have permission to view Customers.")).toBeVisible();
  await page.goto("/notifications/manage");
  await expect(page.getByText("You do not have permission to administer notifications.")).toBeVisible();
  expect((await page.request.get(`${apiOrigin}/api/v1/notifications/rules`)).status()).toBe(403);

  await page.goto("/applications");
  for (const label of [
    "Search applications",
    "Filter by bank",
    "Filter product",
    "Filter current stage",
    "Filter terminal outcome",
    "Created Date",
  ]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  for (const label of [
    "Filter product variant",
    "Filter case owner",
    "Filter office",
    "Filter department",
    "Filter team",
    "Submission date",
    "Bank stage date",
    "Filter requested min",
  ]) {
    await expect(page.getByLabel(label)).toHaveCount(0);
  }

  await page.getByRole("button", { name: "Create application" }).click();
  const dialog = page.getByRole("dialog", { name: "Create application" });
  const individualType = dialog.getByRole("radio", { name: "Individual" });
  const companyType = dialog.getByRole("radio", { name: "Company / Business" });
  await expect(individualType).toBeChecked();
  await expect(companyType).not.toBeChecked();
  await dialog.getByText("Company / Business", { exact: true }).click();
  await expect(companyType).toBeChecked();
  await dialog.getByText("Individual", { exact: true }).click();
  await expect(individualType).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "Customer type" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Check exact identity" })).toHaveCount(0);

  const desktopPairs = [
    [dialog.getByLabel("Customer Emirates ID"), dialog.getByLabel("Customer Passport Number")],
    [dialog.getByLabel("Customer Full Name"), dialog.getByLabel("Customer Employer")],
    [dialog.getByLabel("Customer Mobile"), dialog.getByLabel("Customer Email")],
  ];
  for (const [left, right] of desktopPairs) {
    const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()]);
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThanOrEqual(1);
  }

  const emiratesIdInput = dialog.getByLabel("Customer Emirates ID");
  await emiratesIdInput.fill(emiratesId);
  await expect(dialog.getByText("This customer already exists in the system.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(emiratesIdInput).toHaveAttribute("data-identity-match", "true");
  await expect(emiratesIdInput).toHaveClass(/border-danger/);
  await expect(dialog.getByLabel("Customer Full Name")).toHaveValue(
    `Canonical SE Customer ${suffix}`,
  );
  await expect(dialog.getByLabel("Customer Full Name")).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("Customer Emirates ID")).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("Customer Passport Number")).toHaveValue(passport);
  await expect(dialog.getByLabel("Customer Passport Number")).toHaveAttribute("readonly", "");
  const matchDetailsTrigger = dialog.getByRole("button", { name: "Check exact identity" });
  await matchDetailsTrigger.click();
  const matchDetails = page.getByRole("dialog", { name: "Customer match details" });
  await expect(matchDetails).toBeVisible();
  await expect(matchDetails.getByText(`Canonical SE Customer ${suffix}`)).toBeVisible();
  await expect(
    matchDetails.getByText("No applications are visible in your authorized scope."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(matchDetails).toHaveCount(0);
  await expect(matchDetailsTrigger).toBeFocused();
  await dialog.getByLabel("Customer Mobile").fill(`+97153${suffix}`);
  await selectBrandedOption(dialog.getByLabel("Bank", { exact: true }), prerequisites.bank.id);
  await selectBrandedOption(dialog.getByLabel("Product", { exact: true }), prerequisites.product.id);
  await selectBrandedOption(
    dialog.getByLabel("Product Variant", { exact: true }),
    prerequisites.variant.id,
  );
  await dialog.getByLabel("Requested amount").fill("19000");
  await dialog.getByRole("button", { name: "Create application" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  const applicationRow = page.getByRole("row").filter({ hasText: `Canonical SE Customer ${suffix}` });
  await expect(applicationRow).toBeVisible();
  await expect(applicationRow).toContainText("Not assigned");
  const applicationLink = applicationRow.getByRole("link");
  const applicationCode = (await applicationLink.textContent())!.trim();
  await page.getByLabel("Search applications").fill(applicationCode);
  await expect(applicationLink).toBeVisible();
  await applicationLink.click();
  await expect(page.getByRole("heading", { name: "Workflow timeline" })).toBeVisible();
  await expect(page.getByText("Application Created", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Search applications")).toHaveCount(0);
  await expect(page.getByLabel("Filter by bank")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: applicationCode })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();

  await page.goto("/applications");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  const listFilters = page.getByTestId("application-filters");
  const alignedControls = [
    page.getByLabel("Filter by bank"),
    page.getByLabel("Filter product"),
    page.getByLabel("Filter current stage"),
    page.getByLabel("Filter terminal outcome"),
    page.getByLabel("Created Date"),
    page.getByRole("button", { name: "Apply filters" }),
    page.getByRole("button", { name: "Clear filters" }),
  ];
  await expect(listFilters).toBeVisible();
  const alignedBoxes = await Promise.all(alignedControls.map((control) => control.boundingBox()));
  expect(alignedBoxes.every(Boolean)).toBeTruthy();
  const alignedBottoms = alignedBoxes.map((box) => box!.y + box!.height);
  expect(Math.max(...alignedBottoms) - Math.min(...alignedBottoms)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Create application" }).click();
  const duplicateDialog = page.getByRole("dialog", { name: "Create application" });
  await expect(duplicateDialog.getByRole("radio", { name: "Individual" })).toBeChecked();
  const duplicateIdentity = duplicateDialog.getByLabel("Customer Emirates ID");
  await duplicateIdentity.fill(emiratesId);
  await expect(duplicateDialog.getByText("This customer already exists in the system.")).toBeVisible({
    timeout: 15_000,
  });
  const duplicateMatchTrigger = duplicateDialog.getByRole("button", {
    name: "Check exact identity",
  });
  await duplicateMatchTrigger.click();
  const duplicateMatchDetails = page.getByRole("dialog", { name: "Customer match details" });
  await expect(duplicateMatchDetails.getByText(applicationCode, { exact: true })).toBeVisible();
  await expect(duplicateMatchDetails).toContainText(prerequisites.bank.code);
  await expect(duplicateMatchDetails).toContainText(prerequisites.product.code);
  await duplicateMatchDetails.getByRole("button", { name: "Close", exact: true }).click();
  await expect(duplicateMatchDetails).toHaveCount(0);
  await expect(duplicateMatchTrigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
  await selectBrandedOption(
    duplicateDialog.getByLabel("Bank", { exact: true }),
    prerequisites.bank.id,
  );
  await selectBrandedOption(
    duplicateDialog.getByLabel("Product", { exact: true }),
    prerequisites.product.id,
  );
  await selectBrandedOption(
    duplicateDialog.getByLabel("Product Variant", { exact: true }),
    prerequisites.variant.id,
  );
  await duplicateDialog.getByLabel("Requested amount").fill("19000");
  await duplicateDialog.getByRole("button", { name: "Create application" }).click();
  await expect(
    duplicateDialog.getByText("This customer already has an active application for this Bank and Product"),
  ).toBeVisible();
  await expect(duplicateDialog.getByRole("radio", { name: "Individual" })).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBeTruthy();
});
