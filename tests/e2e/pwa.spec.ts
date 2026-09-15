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
      full_name: "PWA Test Owner",
      employee_code: "EMP-PWA-OWNER",
      email: "pwa.owner@example.com",
      mobile: "+971500000099",
      joining_date: "2026-01-01",
      employment_status: "Active",
      password: "OwnerPass1!",
      designation_name: "Owner",
      designation_code: "OWN",
    },
  });
  expect(created.ok()).toBeTruthy();
}

async function dispatchInstallPrompt(page: Page, outcome: "accepted" | "dismissed" = "accepted") {
  await page.evaluate((choice) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: choice, platform: "web" }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

test("manifest and service worker expose install metadata without caching private routes", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = (await manifestResponse.json()) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest).toMatchObject({
    name: "AMAFH CORE",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icon1.png", sizes: "192x192", purpose: "any" }),
    expect.objectContaining({ src: "/icon2.png", sizes: "512x512", purpose: "any" }),
    expect.objectContaining({ src: "/pwa/amafh-core-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
  ]));

  for (const icon of [...manifest.icons.map(({ src }) => src), "/apple-icon.png"]) {
    expect((await page.request.get(icon)).ok()).toBeTruthy();
  }

  const workerResponse = await page.request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  expect(workerResponse.headers()["content-type"]).toContain("application/javascript");
  expect(workerResponse.headers()["cache-control"]).toContain("no-store");
  const worker = await workerResponse.text();
  expect(worker).toContain('request.mode === "navigate"');
  expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
  expect(worker).not.toMatch(/PUBLIC_ASSETS[\s\S]*?["'`](?:\/api|\/auth|\/customers|\/users|\/documents|\/uploads)/);
});

test("Chromium install action requires a user gesture and hides after installation", async ({ page }) => {
  await page.goto("/login");
  await page.waitForFunction(() => document.documentElement.dataset.pwaReady === "true");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
  const workerScope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(workerScope).toBe(`${new URL(page.url()).origin}/`);
  await expect(page.getByTestId("pwa-install-card")).toHaveCount(0);

  await dispatchInstallPrompt(page);
  const installCard = page.getByTestId("pwa-install-card");
  await expect(installCard).toBeVisible();
  await expect(installCard.getByRole("button", { name: "Install AMAFH CORE" })).toBeVisible();
  await installCard.getByRole("button", { name: "Install AMAFH CORE" }).click();
  await expect(installCard).toHaveCount(0);

  await dispatchInstallPrompt(page);
  await expect(page.getByTestId("pwa-install-card")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByTestId("pwa-install-card")).toHaveCount(0);
});

test("macOS Safari receives Add to Dock guidance while standalone mode stays quiet", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    });
  });
  await page.goto("/login");
  const installCard = page.getByTestId("pwa-install-card");
  await expect(installCard).toBeVisible();
  await expect(installCard).toContainText("File > Add to Dock");
  await expect(installCard.getByText("Install AMAFH CORE", { exact: true })).toBeVisible();
  await expect(installCard.getByRole("button", { name: "Install AMAFH CORE" })).toHaveCount(0);

  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query !== "(display-mode: standalone)") return originalMatchMedia(query);
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
      } as MediaQueryList;
    };
  });
  await page.reload();
  await expect(page.getByTestId("pwa-install-card")).toHaveCount(0);
});

test("installed-style navigation preserves protected redirects, refresh and logout", async ({ page, request }) => {
  test.setTimeout(60_000);
  await ensureOwner(request);
  await page.goto("/users");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("pwa.owner@example.com");
  await page.getByLabel("Password").fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Open user menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  const cachedPaths = await page.evaluate(async () => {
    const urls = (await Promise.all(
      (await caches.keys()).map(async (name) =>
        (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
      ),
    )).flat();
    return urls;
  });
  expect(cachedPaths.some((path) => path.startsWith("/api/"))).toBeFalsy();
  expect(cachedPaths).not.toEqual(expect.arrayContaining(["/login", "/reports", "/users"]));
});

test("install surface is responsive and theme-compatible", async ({ page }) => {
  await page.goto("/login");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"] as const) {
      await page.getByRole("button", { name: `${theme === "light" ? "Light" : "Dark"} theme` }).click();
      await dispatchInstallPrompt(page, "dismissed");
      const card = page.getByTestId("pwa-install-card");
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await card.getByRole("button", { name: "Install AMAFH CORE" }).click();
    }
  }
});
