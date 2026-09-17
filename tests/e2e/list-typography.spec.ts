import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { captureViewport, setVisualTheme } from "./helpers/viewport-capture";
const api = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const routes = ["/customers", "/applications", "/users", "/user-types", "/organization", "/organization?tab=departments", "/organization?tab=business-units", "/organization?tab=teams", "/organization/hierarchy", "/catalog", "/catalog?tab=products", "/catalog?tab=variants", "/catalog?tab=rules", "/catalog?tab=mappings", "/workflows", "/attendance", "/attendance/holidays", "/attendance/reports", "/attendance/schedules", "/hr", "/pro", "/leave", "/leave?tab=settings", "/leave?tab=approvals", "/leave?tab=calendar", "/contracts", "/transfers", "/exits", "/approvals", "/case-operations", "/assets", "/assets/categories", "/assets/reports", "/finance", "/finance?tab=commission-rules", "/finance?tab=incentive-plans", "/targets", "/targets/kpi", "/reports", "/reports/compare", "/reports/drill-down", "/notifications", "/notifications/manage", "/security"];
const widths = [{ width: 1920, height: 1031 }, { width: 1194, height: 834 }, { width: 393, height: 852 }];
const inventoryStart = Number(process.env.TYPOGRAPHY_START ?? 0);
const inventoryEnd = Number(process.env.TYPOGRAPHY_END ?? 0);

test("Customers typography is unchanged and record typography remains readable across authorized routes", async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  page.setDefaultTimeout(15_000);
  const errors: string[] = [], mutations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible();
  page.on("request", request => {
    if (request.url().startsWith(api + "/api/v1/") && !request.url().includes("/auth/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const inventory = [...routes];
  for (const [endpoint, patterns] of [
    ["applications", ["/applications/:id"]], ["customers", ["/customers/:id"]], ["assets", ["/assets/:id"]],
    ["users", ["/users/:id", "/users/:id?tab=hr", "/users/:id?tab=pro", "/users/:id?tab=organization", "/users/:id?tab=assets", "/users/:id?tab=history", "/reports/employees/:id"]],
    ["user-types", ["/user-types/:id"]],
  ] as const) {
    const response = await page.request.get(`${api}/api/v1/${endpoint}`);
    expect(response.ok(), endpoint).toBe(true);
    const records = (await response.json()) as { items: { id: string; code?: string }[] };
    const record = endpoint === "user-types" ? records.items.find(item => item.code !== "OWNER") : records.items[0];
    expect(record, `Existing fixture required for ${endpoint}`).toBeTruthy();
    inventory.push(...patterns.map(pattern => pattern.replace(":id", record!.id)));
  }
  const assetOptions = await page.request.get(`${api}/api/v1/assets/options`);
  expect(assetOptions.ok()).toBe(true);
  const reportOptions = (await assetOptions.json()) as { reports: { key: string; title: string }[] };
  inventory.push(...reportOptions.reports.filter(report => report.key !== "asset_register").map(report => "/assets/reports::" + report.title));
  const results: unknown[] = [];
  inventory.push("/case-operations::Routing", "/case-operations::Clawbacks", "/case-operations::Reports");
  for (const route of inventory.slice(inventoryStart, inventoryEnd || undefined)) {
    for (const viewport of widths) {
      await page.setViewportSize(viewport);
      await page.goto(route.split("::")[0]);
      if (route.includes("::")) {
        if (route.startsWith("/assets/reports")) {
          await page.getByRole("combobox", { name: "Asset report", exact: true }).click();
          await page.getByRole("option", { name: route.split("::")[1], exact: true }).click();
        } else await page.getByRole("tab", { name: route.split("::")[1], exact: true }).click();
      }
      if (route === "/reports") await page.getByTestId("my-workspace").locator(":scope > summary").click();
      await expect(page.getByTestId("authenticated-content")).toBeVisible();
      for (const theme of ["light", "dark"] as const) {
        await setVisualTheme(page, theme);
        const name = `${route.slice(1).replaceAll(/[^a-zA-Z0-9-]/g, "-")}-${viewport.width}-${theme}`;
        await captureViewport(page, testInfo.outputPath(name + "-page.png"));
        const measurements = await page.getByTestId("page-main").evaluate(main => {
          const visible = (element: Element) => Boolean(element.getClientRects().length && (element as HTMLElement).offsetWidth && !element.closest(".sr-only"));
          const sample = (element: Element) => { const c = getComputedStyle(element); return { tag: element.tagName, text: element.textContent?.trim().slice(0, 80), size: c.fontSize, line: c.lineHeight, weight: c.fontWeight }; };
          const tables = [...main.querySelectorAll("table")].filter(visible).map(table => ({
            headers: [...table.querySelectorAll("th")].map(sample),
            rows: [...table.querySelectorAll("tbody tr")].filter(visible).slice(0, 3).map(row => ({
              cells: [...row.querySelectorAll("td")].map(sample),
              badges: [...row.querySelectorAll("[data-amafh-badge]")].filter(visible).map(sample),
              secondary: [...row.querySelectorAll(".text-xs:not(button):not(a):not([data-amafh-button]), small")].filter(e => visible(e) && Boolean(e.textContent?.trim())).map(sample),
              links: [...row.querySelectorAll("td > a, td > p:not(.text-xs)")].filter(visible).map(sample),
            })),
            cards: getComputedStyle(table.querySelector("tbody") ?? table).display === "block" || getComputedStyle(table.querySelector("tbody") ?? table).display === "grid",
            sharedCards: table.closest("[data-mobile-cards=true], [data-tablet-cards=true]") !== null,
          }));
          const cards = [...main.querySelectorAll("[data-amafh-list-record]")].filter(visible).slice(0, 3).map(card => ({ primary: [...card.querySelectorAll("[data-amafh-record-primary]")].map(sample), secondary: [...card.querySelectorAll("[data-amafh-record-secondary]")].map(sample) }));
          const customers = location.pathname === "/customers" && innerWidth < 640 ? [...main.querySelectorAll("article")].filter(visible).slice(0, 1).flatMap(card => [...card.querySelectorAll("a,p,dt,dd,[data-amafh-badge]")].map(sample)) : [];
          return { tables, cards, customers, scale: visualViewport?.scale, zoom: getComputedStyle(document.documentElement).zoom, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        expect(measurements.scale).toBe(1);
        expect(measurements.zoom).toBe("1");
        expect(measurements.overflow, `${route} ${viewport.width} ${theme}`).toBe(0);
        if (route === "/customers" && viewport.width >= 640) for (const table of measurements.tables) {
          for (const header of table.headers) expect([header.size, header.line, header.weight]).toEqual(["11px", "15.95px", "600"]);
          for (const row of table.rows) for (const cell of row.cells) expect([cell.size, cell.line]).toEqual(["12px", "17.4px"]);
        }
        for (const table of measurements.tables) {
          for (const header of table.headers) expect(header.size, `${route}: header ${header.text}`).toBe("11px");
          for (const row of table.rows) {
            for (const cell of row.cells) expect(["12px", ...(table.cards ? ["14px"] : [])], `${route}: cell ${cell.text}`).toContain(cell.size);
            for (const badge of row.badges) expect(badge.size, `${route}: badge ${badge.text}`).toBe(viewport.width < 1280 ? "12px" : "11px");
            for (const secondary of row.secondary) expect(secondary.size, `${route}: secondary ${secondary.text}`).toBe(viewport.width < 1280 ? "12px" : "11px");
            for (const link of row.links) expect(link.size, `${route}: row link/text ${link.text}`).toBe(table.cards && table.sharedCards ? "14px" : "12px");
          }
        }
        for (const card of measurements.cards) {
          for (const primary of card.primary) expect(primary.size, `${route}: card primary ${primary.text}`).toBe(viewport.width < 1280 ? "14px" : "12px");
          for (const secondary of card.secondary) expect(secondary.size, `${route}: card secondary ${secondary.text}`).toBe(viewport.width < 1280 ? "12px" : "11px");
        }
        for (const customer of measurements.customers) {
          const primary = customer.tag === "A" || (customer.tag === "P" && customer.weight === "500");
          expect([customer.size, customer.line]).toEqual(primary ? ["14px", "21px"] : ["12px", "20px"]);
        }
        const anchors = page.locator('[data-amafh-table-shell]:visible, [data-amafh-list-record]:visible, article[data-amafh-record-card]:visible, [data-amafh-workspace] ul:visible:not(.sr-only):not(.sr-only *), [data-amafh-workspace] ol:visible:not(.sr-only):not(.sr-only *)');
        // Full-page capture retains every rendered list; focused captures make below-fold rows reviewable at native scale.
        await page.screenshot({ path: testInfo.outputPath(name + "-full.png"), fullPage: true });
        for (let i = 0; i < Math.min(await anchors.count(), 8); i++) {
          const anchor = anchors.nth(i);
          await captureViewport(page, testInfo.outputPath(name + `-records-${i}.png`), anchor, 76);
          await anchor.screenshot({ path: testInfo.outputPath(name + `-region-${i}.png`) });
          if (await anchor.locator('details > summary').count()) {
            const disclosure = anchor.locator('details:not([open]) > summary').first();
            if (await disclosure.count() && await disclosure.isVisible()) {
              await disclosure.click();
              await captureViewport(page, testInfo.outputPath(name + `-details-${i}.png`), anchor, 76);
              await anchor.screenshot({ path: testInfo.outputPath(name + `-region-details-${i}.png`) });
              await anchor.locator("details[open] > summary").first().click();
            }
          }
          // One native capture per table/list, rather than repeated captures of every record card.
          if (await anchor.getAttribute("data-amafh-list-record") !== null || await anchor.getAttribute("data-amafh-record-card") !== null) break;
        }
        results.push({ route, viewport, theme, ...measurements });
        await writeFile(testInfo.outputPath(name + "-typography.json"), JSON.stringify({ route, viewport, theme, ...measurements }, null, 2));
      }
    }
    console.log(`Typography reviewed: ${route}`);
    await testInfo.attach("typography-inventory", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  }
  expect(errors).toEqual([]);
  expect(mutations).toEqual([]);
});

test("Application search, pagination and existing record links still work after typography correction", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible();
  await page.goto("/applications");
  const firstLink = page.locator('[data-amafh-table-shell] tbody a[href^="/applications/"]').first();
  const identifier = await firstLink.innerText();
  const href = await firstLink.getAttribute("href");
  await page.getByRole("combobox", { name: "Rows per page", exact: true }).click();
  await page.getByRole("option", { name: "25", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Rows per page", exact: true })).toContainText("25");
  await page.getByRole("textbox", { name: "Search applications", exact: true }).fill(identifier);
  await page.getByRole("textbox", { name: "Search applications", exact: true }).press("Enter");
  await expect(page.locator("[data-amafh-table-shell] tbody tr")).toHaveCount(1);
  await expect(firstLink).toHaveText(identifier);
  await firstLink.click();
  await expect(page).toHaveURL(new RegExp(href! + "$"));
  await expect(page.getByTestId("authenticated-content")).toBeVisible();
});

test("Existing SE record lists remain readable at all reference widths and themes", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const email = process.env.TYPOGRAPHY_SE_EMAIL;
  test.skip(!email, "Requires an existing, identity-verified disposable SE fixture; never creates or resets users");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill("UserPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Open user menu", { exact: true })).toBeVisible();
  const mutations: string[] = [];
  page.on("request", request => {
    if (request.url().startsWith(api + "/api/v1/") && !request.url().includes("/auth/") && ["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) mutations.push(request.url());
  });
  for (const route of ["/reports", "/applications", "/customers"]) for (const viewport of widths) {
    await page.setViewportSize(viewport);
    await page.goto(route);
    await expect(page.getByTestId("authenticated-content")).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await setVisualTheme(page, theme);
      const name = `se-${route.slice(1)}-${viewport.width}-${theme}`;
      await captureViewport(page, testInfo.outputPath(name + "-page.png"));
      await page.screenshot({ path: testInfo.outputPath(name + "-full.png"), fullPage: true });
      const records = page.locator('[data-amafh-table-shell]:visible, [data-amafh-list-record]:visible, article[data-amafh-record-card]:visible, [data-amafh-workspace] ul:visible:not(.sr-only):not(.sr-only *)');
      for (let i = 0; i < Math.min(await records.count(), 3); i++) {
        await captureViewport(page, testInfo.outputPath(name + `-records-${i}.png`), records.nth(i), 76);
        await records.nth(i).screenshot({ path: testInfo.outputPath(name + `-region-${i}.png`) });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
  }
  expect(mutations).toEqual([]);
});
