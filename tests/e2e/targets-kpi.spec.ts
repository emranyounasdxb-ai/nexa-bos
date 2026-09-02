import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

async function signIn(page: Page, email = "owner@example.com", password = "OwnerPass1!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Dashboard|User directory/ })).toBeVisible({
    timeout: 30_000,
  });
}

const STAGES = [
  ["SUBMITTED", "Submitted", 20],
  ["RETURNED_REQUIREMENT_PENDING", "Returned / Requirement Pending", 30],
  ["RESUBMITTED", "Resubmitted", 40],
  ["APPROVED", "Approved", 50],
  ["BOOKED", "Booked", 60],
  ["FUND_RELEASED", "Fund Released", 70],
] as const;
const TRANSITIONS = [
  ["application_created", "submitted"],
  ["submitted", "approved"],
  ["approved", "booked"],
  ["booked", "fund_released"],
] as const;

async function ensureWorkflow(
  request: APIRequestContext,
  headers: Record<string, string>,
  bankId: string,
  productId: string,
) {
  const listed = (await (
    await request.get(`${apiOrigin}/api/v1/workflows?bank_id=${bankId}&product_id=${productId}`)
  ).json()) as { items: { id: string; status: string; stages: { systemKey?: string }[] }[] };
  const active = listed.items.find(
    (item) => item.status === "active" && item.stages.some((stage) => stage.systemKey === "submitted"),
  );
  if (active) {
    return active;
  }
  const created = await request.post(`${apiOrigin}/api/v1/workflows`, {
    headers,
    data: { bank_id: bankId, product_id: productId },
  });
  expect(created.ok()).toBeTruthy();
  const workflow = (await created.json()) as { id: string; stages: { systemKey?: string }[] };
  if (workflow.stages.some((stage) => stage.systemKey === "submitted")) {
    return workflow;
  }
  for (const [code, name, order] of STAGES) {
    const added = await request.post(`${apiOrigin}/api/v1/workflows/${workflow.id}/stages`, {
      headers,
      data: { name, code, sort_order: order },
    });
    expect(added.ok()).toBeTruthy();
  }
  const refreshed = (await (await request.get(`${apiOrigin}/api/v1/workflows/${workflow.id}`)).json()) as {
    id: string;
    stages: { id: string; systemKey: string }[];
  };
  const byKey = Object.fromEntries(refreshed.stages.map((stage) => [stage.systemKey, stage.id]));
  const updated = await request.put(`${apiOrigin}/api/v1/workflows/${workflow.id}/transitions`, {
    headers,
    data: {
      items: TRANSITIONS.map(([source, target]) => ({
        from_stage_id: byKey[source],
        to_stage_id: byKey[target],
      })),
    },
  });
  expect(updated.ok()).toBeTruthy();
  return refreshed;
}

test("owner targets, KPI scorecards, profile section, and scoped isolation", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const headers = await ownerHeaders(request);
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const dxb = offices.find((item) => item.code === "DXB");
  const auh = offices.find((item) => item.code === "AUH");
  expect(dxb && auh).toBeTruthy();
  const tag = Date.now().toString(36);
  const dept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { name: `Tgt ${tag}`, code: `TG${tag.slice(-6).toUpperCase()}`, office_id: dxb!.id },
  });
  expect(dept.ok()).toBeTruthy();
  const departmentId = ((await dept.json()) as { id: string }).id;
  const team = await request.post(`${apiOrigin}/api/v1/teams`, {
    headers,
    data: {
      office_id: dxb!.id,
      department_id: departmentId,
      name: `Target Team ${tag}`,
      code: `TT${tag.slice(-6).toUpperCase()}`,
    },
  });
  expect(team.ok()).toBeTruthy();
  const teamId = ((await team.json()) as { id: string; name: string }).id;
  const types = (
    (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const se = types.find((item) => item.code === "SE");
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: { id: string }[] }
  ).items;
  const createdUser = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Target User ${tag}`,
      employee_code: `EMP-TG-${tag}`,
      email: `tgt-${tag}@example.com`,
      mobile: "+971500000077",
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: dxb!.id,
      department_id: departmentId,
      team_id: teamId,
    },
  });
  expect(createdUser.ok()).toBeTruthy();
  const employee = (await createdUser.json()) as { id: string; fullName: string };
  await request.post(`${apiOrigin}/api/v1/users/${employee.id}/assign-type`, {
    headers,
    data: { user_type_id: se!.id },
  });
  await request.post(`${apiOrigin}/api/v1/users/${employee.id}/activate`, { headers });
  await request.put(`${apiOrigin}/api/v1/user-types/${se!.id}/case-owner`, {
    headers,
    data: { can_be_case_owner: true },
  });
  await request.put(`${apiOrigin}/api/v1/attendance/working-days`, {
    headers,
    data: { weekdays: [0, 1, 2, 3, 4] },
  });
  const banks = (
    (await (await request.get(`${apiOrigin}/api/v1/banks`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const products = (
    (await (await request.get(`${apiOrigin}/api/v1/products`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const dib = banks.find((item) => item.code === "DIB");
  const pf = products.find((item) => item.code === "PF");
  const cc = products.find((item) => item.code === "CC");
  expect(dib && pf && cc).toBeTruthy();
  await ensureWorkflow(request, headers, dib!.id, pf!.id);
  await ensureWorkflow(request, headers, dib!.id, cc!.id);
  const mapping = (
    (await (
      await request.get(
        `${apiOrigin}/api/v1/bank-products?bankId=${dib!.id}&productId=${pf!.id}`,
      )
    ).json()) as { items: { id: string }[] }
  ).items[0];
  let variant = (
    (await (
      await request.get(`${apiOrigin}/api/v1/product-variants?bankProductId=${mapping.id}`)
    ).json()) as { items: { id: string }[] }
  ).items[0];
  if (!variant) {
    const createdVariant = await request.post(`${apiOrigin}/api/v1/product-variants`, {
      headers,
      data: {
        bank_product_id: mapping.id,
        name: "Target Personal Finance",
        code: `TARGET-PF-${Date.now()}`,
      },
    });
    expect(createdVariant.ok(), await createdVariant.text()).toBeTruthy();
    variant = (await createdVariant.json()) as { id: string };
  }
  const customer = await request.post(`${apiOrigin}/api/v1/customers`, {
    headers,
    data: {
      customer_type: "individual",
      full_name: `Tgt Cust ${tag}`,
      mobile: `+97150${tag.slice(-8)}`,
    },
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = ((await customer.json()) as { id: string }).id;
  const app = await request.post(`${apiOrigin}/api/v1/applications`, {
    headers,
    data: {
      customer_id: customerId,
      bank_id: dib!.id,
      product_id: pf!.id,
      product_variant_id: variant.id,
      case_owner_id: employee.id,
      requested_amount: "4000",
    },
  });
  expect(app.ok()).toBeTruthy();
  const application = (await app.json()) as { id: string };
  const submitted = await request.post(`${apiOrigin}/api/v1/applications/${application.id}/case-number`, {
    headers,
    data: { bank_case_number: `TGT-${tag.slice(-8)}` },
  });
  expect(submitted.ok()).toBeTruthy();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const officeMonth = `${2031 + (Number.parseInt(tag.slice(-4), 36) % 40)}-${String((Number.parseInt(tag.slice(-2), 36) % 12) + 1).padStart(2, "0")}-01`;
  const options = (await (await request.get(`${apiOrigin}/api/v1/targets/options`)).json()) as {
    lockedMonths?: string[];
  };
  if ((options.lockedMonths ?? []).includes(month)) {
    const reopened = await request.post(`${apiOrigin}/api/v1/targets/periods/${month}/reopen`, {
      headers,
      data: { reason: "E2E reset" },
    });
    expect(reopened.ok()).toBeTruthy();
  }

  const scopedType = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Scope ${tag}`, code: `ST${tag.toUpperCase().slice(-10)}` },
  });
  expect(scopedType.ok(), await scopedType.text()).toBeTruthy();
  const typeId = ((await scopedType.json()) as { id: string }).id;
  await request.post(`${apiOrigin}/api/v1/user-types/${typeId}/activate`, { headers });
  await request.put(`${apiOrigin}/api/v1/user-types/${typeId}/permissions`, {
    headers,
    data: { permissions: ["Targets.View"] },
  });
  await request.put(`${apiOrigin}/api/v1/user-types/${typeId}/reporting-scope`, {
    headers,
    data: { reporting_visibility_scope: "office" },
  });
  const scopedUser = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Scoped Tgt ${tag}`,
      employee_code: `EMP-SC-${tag}`,
      email: `scoped-tgt-${tag}@example.com`,
      mobile: "+971500000066",
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: auh!.id,
    },
  });
  expect(scopedUser.ok(), await scopedUser.text()).toBeTruthy();
  const scoped = (await scopedUser.json()) as { id: string };
  await request.post(`${apiOrigin}/api/v1/users/${scoped.id}/assign-type`, {
    headers,
    data: { user_type_id: typeId },
  });
  await request.post(`${apiOrigin}/api/v1/users/${scoped.id}/activate`, { headers });
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${scoped.id}/setup-link`, { headers });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const token = ((await setup.json()) as { token: string }).token;
  const setPw = await request.post(`${apiOrigin}/api/v1/auth/setup`, {
    data: { token, password: "UserPass1!" },
  });
  expect(setPw.ok(), await setPw.text()).toBeTruthy();

  await signIn(page);
  await page.getByRole("button", { name: "Performance menu" }).click();
  await page.getByRole("link", { name: "Targets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Targets" })).toBeVisible();

  await expect(page.getByRole("tab", { name: "Targets" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Create target" }).first().click();
  let targetDrawer = page.getByRole("dialog", { name: "Create target" });
  await expect(targetDrawer).toBeVisible();
  await expect(targetDrawer.getByRole("group", { name: "Assignment" })).toBeVisible();
  await expect(targetDrawer.getByRole("group", { name: "Target period" })).toBeVisible();
  await expect(targetDrawer.getByRole("group", { name: "Measurement" })).toBeVisible();
  await targetDrawer.getByLabel("Target level").selectOption("employee");
  await targetDrawer.getByLabel("Target entity").selectOption(employee.id);
  await targetDrawer.getByLabel("Target month").fill(month);
  await targetDrawer.getByLabel("Product", { exact: true }).selectOption(pf!.id);
  await targetDrawer.getByLabel("Milestone").selectOption("submitted");
  await targetDrawer.getByLabel("Measurement").selectOption("amount");
  await targetDrawer.getByLabel("Target value").fill("10000");
  await targetDrawer.getByLabel("Prorate").selectOption("no");
  await expect(targetDrawer.getByLabel("Target summary")).toContainText("10000");
  await targetDrawer.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target saved.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Target User ${tag}`) })).toBeVisible();
  await expect(
    page.getByRole("row", { name: new RegExp(`Target User ${tag}`) }).getByText("AED 4000.00"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create target" }).first().click();
  targetDrawer = page.getByRole("dialog", { name: "Create target" });
  await targetDrawer.getByLabel("Target level").selectOption("team");
  await targetDrawer.getByLabel("Target entity").selectOption(teamId);
  await targetDrawer.getByLabel("Product", { exact: true }).selectOption(pf!.id);
  await targetDrawer.getByLabel("Target value").fill("20000");
  await targetDrawer.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target saved.")).toBeVisible();

  await page.getByRole("button", { name: "Create target" }).first().click();
  targetDrawer = page.getByRole("dialog", { name: "Create target" });
  await targetDrawer.getByLabel("Target level").selectOption("office");
  await targetDrawer.getByLabel("Target entity").selectOption(dxb!.id);
  await targetDrawer.getByLabel("Target month").fill(officeMonth);
  await targetDrawer.getByLabel("Product", { exact: true }).selectOption(cc!.id);
  await targetDrawer.getByLabel("Measurement").selectOption("count");
  await targetDrawer.getByLabel("Target value").fill("5");
  await targetDrawer.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target saved.")).toBeVisible();
  await page.getByLabel("Target month filter").fill(month);
  await expect(page.getByRole("row", { name: new RegExp(`Target User ${tag}`) })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Run-rate" })).toBeVisible();

  await page.getByRole("row", { name: new RegExp(`Target User ${tag}`) }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Edit target value").fill("12000");
  await page.getByLabel("Edit reason").fill("Board adjustment");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect(page.getByText("Target updated.")).toBeVisible();
  await page.getByRole("row", { name: new RegExp(`Target User ${tag}`) }).getByRole("button", { name: "History" }).click();
  await expect(page.getByText("Board adjustment")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("tab", { name: "Period Management" }).click();
  await expect(page.getByRole("tab", { name: "Period Management" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Lock month" }).click();
  const lockDialog = page.getByRole("dialog", { name: "Confirm period lock" });
  await expect(lockDialog).toContainText("prevents edits");
  await lockDialog.getByRole("button", { name: "Lock month" }).click();
  await expect(page.getByText("Target period locked.")).toBeVisible();
  await page.getByRole("button", { name: "Reopen month" }).click();
  const reopenDialog = page.getByRole("dialog", { name: "Reopen target period" });
  await reopenDialog.getByLabel("Reopen reason").fill("Month-end correction");
  await reopenDialog.getByRole("button", { name: "Reopen month" }).click();
  await expect(page.getByText("Target period reopened.")).toBeVisible();

  await page.getByRole("button", { name: "Performance menu" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "KPI scorecards" }).click();
  await expect(page.getByRole("heading", { name: "KPI scorecards" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scorecards", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create scorecard" }).first().click();
  let scorecardDrawer = page.getByRole("dialog", { name: "Create KPI scorecard" });
  await expect(scorecardDrawer).toBeVisible();
  await expect(scorecardDrawer.getByRole("group", { name: "Scorecard details" })).toBeVisible();
  await expect(scorecardDrawer.getByRole("group", { name: "Metrics" })).toBeVisible();
  await scorecardDrawer.getByLabel("Scorecard name").fill(`Card ${tag}`);
  await scorecardDrawer.getByLabel("Weight 1").fill("40");
  await expect(scorecardDrawer.getByRole("button", { name: "Save scorecard" })).toBeDisabled();
  await expect(scorecardDrawer.getByLabel("Scorecard validation")).toContainText("exactly 100%");
  await scorecardDrawer.getByRole("button", { name: "Cancel" }).click();
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Keep editing" }).click();
  await scorecardDrawer.getByLabel("Weight 1").fill("100");
  await expect(scorecardDrawer.getByRole("progressbar", { name: "Metric weight total" })).toHaveAttribute("aria-valuenow", "100");
  await expect(scorecardDrawer.getByText("Scorecard configuration is ready to save.")).toBeVisible();
  await scorecardDrawer.getByRole("button", { name: "Save scorecard" }).click();
  await expect(page.getByText("KPI scorecard saved.")).toBeVisible();
  const cardRow = page.getByRole("row", { name: new RegExp(`Card ${tag}`) });
  await expect(cardRow).toBeVisible();
  await cardRow.getByRole("button", { name: "Activate" }).click();
  const activationDialog = page.getByRole("dialog", { name: "Confirm activation" });
  await expect(activationDialog).toContainText("will become active");
  await activationDialog.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("KPI scorecard activated.")).toBeVisible();

  await cardRow.getByRole("button", { name: "Edit" }).click();
  scorecardDrawer = page.getByRole("dialog", { name: "Edit KPI scorecard" });
  await scorecardDrawer.getByRole("button", { name: "Add metric" }).click();
  await scorecardDrawer.getByLabel("Metric 2", { exact: true }).selectOption("attendance_score");
  await scorecardDrawer.getByLabel("Weight 1").fill("80");
  await scorecardDrawer.getByLabel("Weight 2").fill("20");
  await scorecardDrawer.getByLabel("Baseline 2").fill("100");
  await expect(scorecardDrawer.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await scorecardDrawer.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("KPI scorecard updated.")).toBeVisible();
  await expect(cardRow).toContainText("Attendance score");

  await page.goto(`/reports/employees/${employee.id}`);
  await expect(page.getByRole("heading", { name: "Targets / KPI" })).toBeVisible();
  await expect(page.getByText(/KPI score /)).toBeVisible();
  await expect(page.getByText(/Attendance score:/)).toBeVisible();

  const context = await browser.newContext();
  const scopedPage = await context.newPage();
  await scopedPage.goto("/login");
  await scopedPage.getByLabel("Email").fill(`scoped-tgt-${tag}@example.com`);
  await scopedPage.getByLabel("Password").fill("UserPass1!");
  await scopedPage.getByRole("button", { name: "Sign in" }).click();
  await expect(scopedPage.getByRole("heading", { name: "User directory" })).toBeVisible({ timeout: 30_000 });
  await scopedPage.goto("/targets");
  await expect(scopedPage.getByRole("heading", { name: "Targets" })).toBeVisible();
  await expect(scopedPage.getByText(`Target User ${tag}`)).toHaveCount(0);
  await context.close();
});
