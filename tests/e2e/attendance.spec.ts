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

test("owner attendance bulk entry, calculations, correction, holiday, schedule, report, and profile", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const headers = await ownerHeaders(request);
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const dxb = offices.find((item) => item.code === "DXB");
  expect(dxb).toBeTruthy();
  const tag = Date.now().toString(36);
  const dept = await request.post(`${apiOrigin}/api/v1/departments`, {
    headers,
    data: { name: `Att ${tag}`, code: `AT${tag.slice(-6).toUpperCase()}`, office_id: dxb!.id },
  });
  expect(dept.ok()).toBeTruthy();
  const departmentId = ((await dept.json()) as { id: string }).id;
  const types = (
    (await (await request.get(`${apiOrigin}/api/v1/user-types`)).json()) as { items: { id: string; code: string }[] }
  ).items;
  const se = types.find((item) => item.code === "SE");
  expect(se).toBeTruthy();
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: { id: string }[] }
  ).items;
  const createdUser = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Attendance User ${tag}`,
      employee_code: `EMP-AT-${tag}`,
      email: `att-${tag}@example.com`,
      mobile: "+971500000088",
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: dxb!.id,
      department_id: departmentId,
    },
  });
  expect(createdUser.ok()).toBeTruthy();
  const user = (await createdUser.json()) as { id: string; fullName: string };
  await request.post(`${apiOrigin}/api/v1/users/${user.id}/assign-type`, {
    headers,
    data: { user_type_id: se!.id },
  });
  await request.post(`${apiOrigin}/api/v1/users/${user.id}/activate`, { headers });
  const leaveType = await request.post(`${apiOrigin}/api/v1/attendance/leave-types`, {
    headers,
    data: { code: `LT${tag.slice(-6).toUpperCase()}`, name: `Study leave ${tag}` },
  });
  expect(leaveType.ok()).toBeTruthy();
  const schedule = await request.post(`${apiOrigin}/api/v1/attendance/schedules`, {
    headers,
    data: {
      office_id: dxb!.id,
      department_id: departmentId,
      kind: "normal",
      start_time: "09:00",
      end_time: "18:00",
      grace_minutes: 10,
    },
  });
  expect(schedule.ok()).toBeTruthy();
  const ramadan = await request.post(`${apiOrigin}/api/v1/attendance/schedules`, {
    headers,
    data: {
      office_id: dxb!.id,
      department_id: departmentId,
      kind: "ramadan",
      start_time: "09:00",
      end_time: "15:00",
      grace_minutes: 0,
      ramadan_from: "2026-03-01",
      ramadan_to: "2026-03-30",
    },
  });
  expect(ramadan.ok() || ramadan.status() === 409).toBeTruthy();
  const holidayDate = "2026-12-02";
  const holiday = await request.post(`${apiOrigin}/api/v1/attendance/holidays`, {
    headers,
    data: { holiday_date: holidayDate, name: `National Day ${tag}` },
  });
  expect(holiday.ok() || holiday.status() === 409).toBeTruthy();
  const reminderParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = reminderParts.split("-").map(Number);
  const reminderDate = new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const reminderHoliday = await request.post(`${apiOrigin}/api/v1/attendance/holidays`, {
    headers,
    data: { holiday_date: reminderDate, name: `Reminder Holiday ${tag}` },
  });
  expect(reminderHoliday.ok() || reminderHoliday.status() === 409).toBeTruthy();
  let reminderHolidayId = reminderHoliday.ok()
    ? ((await reminderHoliday.json()) as { id: string }).id
    : "";
  if (reminderHoliday.status() === 409) {
    const holidays = (
      (await (await request.get(`${apiOrigin}/api/v1/attendance/holidays`)).json()) as {
        items: { id: string; holidayDate: string }[];
      }
    ).items;
    const existing = holidays.find((item) => item.holidayDate === reminderDate);
    expect(existing).toBeTruthy();
    reminderHolidayId = existing!.id;
    const renamed = await request.patch(`${apiOrigin}/api/v1/attendance/holidays/${existing!.id}`, {
      headers,
      data: { name: `Reminder Holiday ${tag}` },
    });
    expect(renamed.ok()).toBeTruthy();
  }
  const urgent = await request.post(
    `${apiOrigin}/api/v1/attendance/holidays/${reminderHolidayId}/urgent-reminder`,
    { headers },
  );
  expect(urgent.ok()).toBeTruthy();

  await signIn(page);
  await expect(
    page.getByText(new RegExp(`Holiday reminder:.*Reminder Holiday ${tag}`, "i")).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("navigation").getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await page.getByLabel("Attendance date").fill("2026-08-03");
  await page.getByLabel("Office").selectOption({ label: "Dubai" });
  await page.getByLabel("Department").selectOption({ label: `Att ${tag}` });
  await expect(page.getByText(user.fullName)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(`${user.fullName} status`).selectOption("Present");
  await page.getByLabel(`${user.fullName} time in`).fill("09:20");
  await page.getByLabel(`${user.fullName} time out`).fill("17:45");
  await page.getByRole("button", { name: `${user.fullName} save` }).click();
  await expect(page.getByText("Attendance saved.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Late 10m/)).toBeVisible();
  await expect(page.getByText(/Early 15m/)).toBeVisible();
  await expect(page.getByLabel(`${user.fullName} time in`)).toHaveValue("09:20");
  await expect(page.getByLabel(`${user.fullName} time out`)).toHaveValue("17:45");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Attendance date")).toHaveValue("2026-08-03");
  await expect(page.getByText(user.fullName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(`${user.fullName} time in`)).toHaveValue("09:20");
  await expect(page.getByLabel(`${user.fullName} time out`)).toHaveValue("17:45");
  await expect(page.getByText(/Late 10m/)).toBeVisible();
  await expect(page.getByText(/Early 15m/)).toBeVisible();
  await page.getByLabel(`${user.fullName} time out`).fill("");
  await page.getByRole("button", { name: `${user.fullName} correct` }).click();
  await page.getByLabel("Correction reason").fill("Missing clock-out");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Incomplete Attendance")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(`${user.fullName} status`).selectOption("Leave");
  await page.getByLabel(`${user.fullName} leave type`).selectOption({ label: `Study leave ${tag}` });
  await page.getByRole("button", { name: `${user.fullName} correct` }).click();
  await page.getByLabel("Correction reason").fill("Marked leave");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Attendance corrected.")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText(user.fullName)).toBeVisible();

  await page.goto("/attendance/holidays");
  await expect(page.getByRole("heading", { name: "Official holidays" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Urgent reminder" }).first().click();
  await expect(page.getByText("Urgent holiday reminder sent.")).toBeVisible();

  await page.goto("/attendance");
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Attendance date").fill(holidayDate);
  await expect(page.getByLabel("Attendance date")).toHaveValue(holidayDate);
  await expect(page.getByText(/Official Holiday:/)).toBeVisible({ timeout: 20_000 });

  await page.goto("/attendance/schedules");
  await expect(page.getByRole("heading", { name: "Attendance schedules" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("columnheader", { name: "Ramadan dates" })).toBeVisible();
  await expect(page.getByLabel("Schedule kind")).toContainText("Ramadan");

  await page.goto("/attendance/reports");
  await expect(page.getByRole("heading", { name: "Attendance reports" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel("Report from").fill("2026-08-01");
  await page.getByLabel("Report to").fill("2026-08-31");
  await page.getByRole("button", { name: "Run report" }).click();
  await expect(page.getByRole("cell", { name: new RegExp(user.fullName) })).toBeVisible({
    timeout: 20_000,
  });

  await page.goto(`/reports/employees/${user.id}`);
  await expect(page.getByRole("heading", { name: user.fullName })).toBeVisible();
  await expect(page.getByText("Attendance summary")).toBeVisible();
  await expect(page.getByText("Attendance score / impact")).toBeVisible();

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("scoped user cannot access unauthorized attendance or send urgent reminders", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const headers = await ownerHeaders(request);
  const offices = (
    (await (await request.get(`${apiOrigin}/api/v1/offices`)).json()) as {
      items: { id: string; code: string }[];
    }
  ).items;
  const dxb = offices.find((item) => item.code === "DXB")!;
  const auh = offices.find((item) => item.code === "AUH")!;
  const tag = `S${Date.now().toString(36)}`;
  const typeCreated = await request.post(`${apiOrigin}/api/v1/user-types`, {
    headers,
    data: { name: `Att scope ${tag}`, code: tag.slice(0, 10).toUpperCase() },
  });
  expect(typeCreated.ok()).toBeTruthy();
  const typeId = ((await typeCreated.json()) as { id: string; code: string }).id;
  await request.post(`${apiOrigin}/api/v1/user-types/${typeId}/activate`, { headers });
  await request.put(`${apiOrigin}/api/v1/user-types/${typeId}/permissions`, {
    headers,
    data: { permissions: ["Attendance.View", "Users.View"] },
  });
  await request.put(`${apiOrigin}/api/v1/user-types/${typeId}/scope`, {
    headers,
    data: { visibility_scope: "office" },
  });
  const designations = (
    (await (await request.get(`${apiOrigin}/api/v1/designations`)).json()) as { items: { id: string }[] }
  ).items;
  const hidden = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Hidden Att ${tag}`,
      employee_code: `EMP-HID-${tag}`,
      email: `hid-att-${tag}@example.com`,
      mobile: "+971500000077",
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: auh.id,
    },
  });
  expect(hidden.ok()).toBeTruthy();
  const hiddenUser = (await hidden.json()) as { id: string; fullName: string };
  await request.post(`${apiOrigin}/api/v1/users/${hiddenUser.id}/assign-type`, {
    headers,
    data: { user_type_id: typeId },
  });
  await request.post(`${apiOrigin}/api/v1/users/${hiddenUser.id}/activate`, { headers });
  const scoped = await request.post(`${apiOrigin}/api/v1/users`, {
    headers,
    data: {
      full_name: `Scoped Att ${tag}`,
      employee_code: `EMP-SC-${tag}`,
      email: `sc-att-${tag}@example.com`,
      mobile: "+971500000066",
      designation_id: designations[0].id,
      employment_status: "Active",
      joining_date: "2026-02-01",
      office_id: dxb.id,
    },
  });
  expect(scoped.ok()).toBeTruthy();
  const scopedUser = (await scoped.json()) as { id: string; email: string; fullName: string };
  await request.post(`${apiOrigin}/api/v1/users/${scopedUser.id}/assign-type`, {
    headers,
    data: { user_type_id: typeId },
  });
  await request.post(`${apiOrigin}/api/v1/users/${scopedUser.id}/activate`, { headers });
  const setup = await request.post(`${apiOrigin}/api/v1/auth/users/${scopedUser.id}/setup-link`, {
    headers,
  });
  const token = ((await setup.json()) as { token: string }).token;
  await request.post(`${apiOrigin}/api/v1/auth/setup`, {
    data: { token, password: "UserPass1!" },
  });

  await signIn(page, scopedUser.email, "UserPass1!");
  await page.getByRole("navigation").getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(page.getByText(hiddenUser.fullName)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Attendance reports" })).toHaveCount(0);
  const holidays = await request.get(`${apiOrigin}/api/v1/attendance/holidays`);
  const holidayItems = ((await holidays.json()) as { items: { id: string }[] }).items;
  if (holidayItems[0]) {
    await page.goto("/attendance/holidays");
    await expect(page.getByRole("button", { name: "Urgent reminder" })).toHaveCount(0);
  }
});
