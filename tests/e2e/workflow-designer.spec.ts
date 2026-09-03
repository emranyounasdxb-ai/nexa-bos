import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";

async function ensureOwner(request: APIRequestContext) {
  const status = await request.get(`${apiOrigin}/api/v1/auth/bootstrap-status`);
  const body = (await status.json()) as { available: boolean };
  if (!body.available) return;
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

async function signIn(page: Page, request: APIRequestContext) {
  await ensureOwner(request);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function ownerHeaders(request: APIRequestContext) {
  const login = await request.post(`${apiOrigin}/api/v1/auth/login`, {
    data: { email: "owner@example.com", password: "OwnerPass1!" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  return { "X-CSRF-Token": ((await login.json()) as { csrfToken: string }).csrfToken };
}

async function createBranchingWorkflow(request: APIRequestContext) {
  const headers = await ownerHeaders(request);
  const suffix = Date.now().toString(36).slice(-7).toUpperCase();
  const bankName = `Workflow Bank ${suffix}`;
  const productName = `Workflow Product ${suffix}`;
  const bank = await request.post(`${apiOrigin}/api/v1/banks`, {
    headers,
    data: { name: bankName, code: `WB${suffix}` },
  });
  const product = await request.post(`${apiOrigin}/api/v1/products`, {
    headers,
    data: { name: productName, code: `WP${suffix}` },
  });
  expect(bank.ok(), await bank.text()).toBeTruthy();
  expect(product.ok(), await product.text()).toBeTruthy();
  const bankBody = (await bank.json()) as { id: string };
  const productBody = (await product.json()) as { id: string };
  const mapping = await request.post(`${apiOrigin}/api/v1/bank-products`, {
    headers,
    data: { bank_id: bankBody.id, product_id: productBody.id },
  });
  expect(mapping.ok(), await mapping.text()).toBeTruthy();
  const workflow = await request.post(`${apiOrigin}/api/v1/workflows`, {
    headers,
    data: { bank_id: bankBody.id, product_id: productBody.id },
  });
  expect(workflow.ok(), await workflow.text()).toBeTruthy();
  const workflowBody = (await workflow.json()) as {
    id: string;
    stages: { id: string; systemKey: string | null }[];
  };
  const stageDefinitions = [
    { name: "Document Review", code: `DR${suffix}`, sort_order: 20 },
    { name: "Credit Review", code: `CR${suffix}`, sort_order: 30 },
    { name: "Final Decision", code: `FD${suffix}`, sort_order: 40 },
  ];
  const createdStages: { code: string; id: string; name: string }[] = [];
  for (const definition of stageDefinitions) {
    const response = await request.post(`${apiOrigin}/api/v1/workflows/${workflowBody.id}/stages`, {
      headers,
      data: definition,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    createdStages.push((await response.json()) as { code: string; id: string; name: string });
  }
  const entry = workflowBody.stages.find((stage) => stage.systemKey === "application_created");
  expect(entry).toBeTruthy();
  const transitions = await request.put(`${apiOrigin}/api/v1/workflows/${workflowBody.id}/transitions`, {
    headers,
    data: {
      items: [
        { from_stage_id: entry!.id, to_stage_id: createdStages[0].id },
        { from_stage_id: entry!.id, to_stage_id: createdStages[1].id },
        { from_stage_id: createdStages[0].id, to_stage_id: createdStages[2].id },
      ],
    },
  });
  expect(transitions.ok(), await transitions.text()).toBeTruthy();
  return {
    bankId: bankBody.id,
    bankName,
    documentStageLabel: `${createdStages[0].name} (${createdStages[0].code})`,
    productId: productBody.id,
    productName,
    workflowId: workflowBody.id,
  };
}

async function chooseOption(page: Page, name: string, option: string) {
  const combobox = page.getByRole("combobox", { name, exact: true });
  await combobox.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option", { name: option, exact: true }).click();
  await expect(combobox).toHaveAttribute("value", /.+/);
}

test("Workflow Designer presents dependent branded selectors, drawers, branching preview, and responsive containment", async ({ page, request }) => {
  test.setTimeout(120_000);
  await ensureOwner(request);
  const fixture = await createBranchingWorkflow(request);
  await signIn(page, request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workflows?bank=${fixture.bankId}&product=${fixture.productId}&workflow=${fixture.workflowId}&view=stages`);

  await expect(page.getByRole("heading", { name: "Workflow Designer", exact: true })).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Workflow bank" })).toContainText(fixture.bankName);
  await expect(page.getByRole("combobox", { name: "Workflow product" })).toContainText(fixture.productName);
  await expect(page.getByText("Fixed entry stage", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "About the fixed entry stage" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("system-defined entry stage");

  const addStageButton = page.getByRole("button", { name: "Add stage" });
  await addStageButton.click();
  const addStageDialog = page.getByRole("dialog", { name: "Add stage" });
  await expect(addStageDialog).toBeVisible();
  await addStageDialog.press("Escape");
  await expect(addStageDialog).toHaveCount(0);
  await expect(addStageButton).toBeFocused();

  const status = page.getByRole("combobox", { name: "Workflow status" });
  await status.focus();
  await status.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await status.press("End");
  await status.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(status).toBeFocused();

  await page.getByRole("tab", { name: "Transitions", exact: true }).click();
  await expect(page).toHaveURL(/view=transitions/);
  await expect(page.getByText("Application Created", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Document Review", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Transitions", exact: true })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Add transition" }).click();
  const transitionDialog = page.getByRole("dialog", { name: "Add transition" });
  await expect(transitionDialog).toBeVisible();
  await chooseOption(page, "From stage", "Application Created (APPLICATION_CREATED)");
  await chooseOption(page, "To stage", fixture.documentStageLabel);
  await expect(transitionDialog.getByRole("alert")).toContainText("already exists");
  page.once("dialog", (dialog) => dialog.accept());
  await transitionDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: "Workflow preview" }).click();
  const preview = page.getByTestId("workflow-preview");
  await expect(preview).toContainText("Document Review");
  await expect(preview).toContainText("Credit Review");
  await expect(preview).toContainText("Final Decision");
  await page.getByText("Accessible transition table").click();
  await expect(page.getByRole("columnheader", { name: "From stage" })).toBeVisible();

  await page.getByRole("button", { name: "Create workflow version" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create workflow version" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByRole("combobox", { name: "Bank" })).toBeVisible();
  await createDialog.getByRole("button", { name: "Close workflow drawer" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Create workflow version" }).click();
  const mobileDialog = page.getByRole("dialog", { name: "Create workflow version" });
  await expect(mobileDialog).toBeVisible();
  const dialogBox = await mobileDialog.boundingBox();
  expect(dialogBox?.width).toBeGreaterThanOrEqual(388);
  await mobileDialog.getByRole("button", { name: "Close workflow drawer" }).click();
  const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
});

test("Branded required selects preserve form validation", async ({ page, request }) => {
  await ensureOwner(request);
  await signIn(page, request);
  await page.goto("/users/new");

  await page.getByLabel("Full name").fill("Select validation check");
  await page.getByLabel("Employee code").fill("SELECT-VALIDATION");
  await page.getByLabel("Email").fill("select-validation@example.invalid");
  await page.getByLabel("Mobile number").fill("0500000000");
  await page.getByLabel("Joining date").fill("2026-09-03");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const designation = page.getByRole("combobox", { name: "Designation" });
  await expect(page).toHaveURL(/\/users\/new$/);
  await expect(designation).toHaveAttribute("aria-invalid", "true");
  await expect(designation).toBeFocused();
});
