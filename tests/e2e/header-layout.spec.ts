import { expect, test } from "@playwright/test";

test("header navigation stays page-centered and controls remain usable in both themes", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPass1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const banner = page.getByRole("banner");
  await expect(banner.getByLabel("Open user menu", { exact: true })).toBeVisible();
  const primary = banner.getByRole("navigation", { name: "Primary", exact: true });
  const themeButton = banner.getByRole("group", { name: "Appearance", exact: true }).getByRole("button");
  for (const width of [1920, 1600, 1440, 1366, 1280, 1279, 1194, 768, 640, 393, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ["light", "dark"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) await themeButton.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(themeButton).toBeVisible();
      await expect(themeButton.locator("svg")).toBeVisible();
      const geometry = await banner.evaluate(header => {
        const visible = (element: Element) => element.getClientRects().length > 0;
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
        };
        const nav = header.querySelector('nav[aria-label="Primary"]')!;
        const units = Array.from(header.children).filter(visible).map(rect);
        const controls = Array.from(header.querySelectorAll('a,button')).filter(visible).map(rect);
        const navBox = rect(nav);
        return {
          centered: Math.abs((navBox.left + navBox.right) / 2 - document.documentElement.clientWidth / 2),
          overlapping: units.slice(1).some((box, index) => box.left < units[index].right - 1),
          outside: controls.some(box => box.left < -1 || box.right > document.documentElement.clientWidth + 1),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          fontSize: getComputedStyle(nav.querySelector('a,button')!).fontSize,
          arrowOffsets: Array.from(nav.querySelectorAll('button')).map(button => {
            const box = button.getBoundingClientRect(), arrow = button.querySelector('svg')!.getBoundingClientRect();
            return Math.abs((box.top + box.bottom) / 2 - (arrow.top + arrow.bottom) / 2);
          }),
        };
      });
      expect(geometry.overlapping, `${width} ${theme}: header overlap`).toBe(false);
      expect(geometry.outside, `${width} ${theme}: controls outside viewport`).toBe(false);
      expect(geometry.overflow).toBe(0);
      if (width >= 1280) {
        await expect(primary).toBeVisible();
        expect(geometry.centered).toBeLessThanOrEqual(1);
        expect(geometry.fontSize).toBe("14px");
        expect(geometry.arrowOffsets.every(offset => offset <= 1)).toBe(true);
        await expect(primary.locator("a,button")).toHaveText(["Dashboard", "Cases", "Operations", "Performance", "People & HR", "Finance", "Reports", "Administration"]);
      } else {
        await expect(primary).toBeHidden();
        await expect(page.getByRole("navigation", { name: width < 640 ? "Mobile navigation" : "Tablet navigation", exact: true })).toBeVisible();
      }
      await banner.screenshot({ path: testInfo.outputPath(`header-${width}-${theme}.png`), animations: "disabled" });
    }
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
