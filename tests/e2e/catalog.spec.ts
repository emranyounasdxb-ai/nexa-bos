import {
  expect,
  test,
  type APIRequestContext,
  type CDPSession,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";
import { captureViewportPair, captureViewportThemes } from "./helpers/viewport-capture";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAGCAYAAAD37n+BAAAAG0lEQVR4nGOcIbdnAQN2kIBNkAmHYpxgOGgAAMcMAn4PomjxAAAAAElFTkSuQmCC",
  "base64",
);
const transparentWebp = Buffer.from(
  "UklGRiYAAABXRUJQVlA4TBoAAAAvCIADEA8wHoM5vAMa8BAIJBnsj7xBRP8jDw==",
  "base64",
);

async function expectUnframedCatalogueImage(image: Locator, expectedRatio: number) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(image).toHaveAttribute("loading", "eager");
  const presentation = await image.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const imageElement = element as HTMLImageElement;
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      objectFit: style.objectFit,
      naturalRatio: imageElement.naturalWidth / imageElement.naturalHeight,
      renderedRatio: bounds.width / bounds.height,
    };
  });
  expect(presentation).toMatchObject({
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderTopWidth: "0px",
    borderRadius: "0px",
    boxShadow: "none",
    objectFit: "contain",
  });
  expect(presentation.naturalRatio).toBeCloseTo(expectedRatio, 2);
  expect(presentation.renderedRatio).toBeCloseTo(expectedRatio, 1);
}

type ImageTraffic = {
  cached: boolean;
  status?: number;
  url: string;
};

async function observeCatalogueImageTraffic(page: Page) {
  const session: CDPSession = await page.context().newCDPSession(page);
  const traffic = new Map<string, ImageTraffic>();
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: false });
  session.on(
    "Network.requestWillBeSent",
    (event: { requestId: string; request: { url: string } }) => {
      if (/\/api\/v1\/(?:banks|products|product-variants)\/[^/]+\/image\?v=/.test(event.request.url)) {
        traffic.set(event.requestId, { cached: false, url: event.request.url });
      }
    },
  );
  session.on("Network.requestServedFromCache", (event: { requestId: string }) => {
    const request = traffic.get(event.requestId);
    if (request) request.cached = true;
  });
  session.on(
    "Network.responseReceived",
    (event: {
      requestId: string;
      response: { fromDiskCache?: boolean; fromPrefetchCache?: boolean; status: number };
    }) => {
      const request = traffic.get(event.requestId);
      if (!request) return;
      request.status = event.response.status;
      request.cached ||= Boolean(event.response.fromDiskCache || event.response.fromPrefetchCache);
    },
  );
  return {
    clear: () => traffic.clear(),
    clearBrowserCache: () => session.send("Network.clearBrowserCache"),
    close: () => session.detach(),
    records: () => [...traffic.values()],
  };
}

async function uploadCatalogueImage(
  page: Page,
  row: Locator,
  name: string,
  file: { buffer: Buffer; extension: "png" | "webp"; mimeType: "image/png" | "image/webp"; ratio: number },
  testInfo?: TestInfo,
) {
  await row.getByRole("button", { name: `Manage image for ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Add image" });
  await expect(dialog.getByLabel(`No image for ${name}`)).toBeVisible();
  await dialog.getByLabel("PNG, JPEG, or WebP image").setInputFiles({
    name: `transparent-catalogue.${file.extension}`,
    mimeType: file.mimeType,
    buffer: file.buffer,
  });
  const picker = dialog.locator('[data-file-picker]');
  await expect(picker.getByText(`transparent-catalogue.${file.extension}`, { exact: true })).toBeVisible();
  await expect(picker.getByRole("img", { name: `Selected preview for transparent-catalogue.${file.extension}` })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Change", exact: true })).toBeVisible();
  if (testInfo) await captureViewportPair(page, testInfo, "catalog-image-picker", dialog);
  await dialog.getByRole("button", { name: "Upload image" }).click();
  await expect(dialog).toHaveCount(0);
  await expectUnframedCatalogueImage(row.getByRole("img", { name: `${name} image` }), file.ratio);

  await row.getByRole("button", { name: `Manage image for ${name}` }).click();
  const replaceDialog = page.getByRole("dialog", { name: "Replace image" });
  await expectUnframedCatalogueImage(replaceDialog.getByRole("img", { name: `${name} image` }), file.ratio);
  await replaceDialog.getByRole("button", { name: "Cancel" }).click();
}

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

test("catalog uses task tabs, modal editing, explicit rule saves, and mapping validation", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await signIn(page, request);
  const suffix = Date.now().toString(36).slice(-7).toUpperCase();
  let bankCode = "";
  let productCode = "";
  const bankName = `Playwright Bank ${suffix}`;
  const renamedBank = `${bankName} Updated`;
  const productName = `Playwright Product ${suffix}`;

  await page.goto("/catalog?tab=banks");
  await expect(page.getByRole("heading", { name: "Banks and products", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Catalogue workspace", exact: true })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Banks and products tasks" });
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  await expect(tabs.getByRole("tab", { name: "Banks", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "catalog-panel-banks");
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Add bank", exact: true }).click();
  const addBankDialog = page.getByRole("dialog", { name: "Add bank" });
  await expect(addBankDialog).toBeVisible();
  await expect(addBankDialog.getByLabel("Bank code")).toHaveCount(0);
  await addBankDialog.getByLabel("Bank name").fill(bankName);
  const bankCreateResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/banks") && response.request().method() === "POST");
  await addBankDialog.getByRole("button", { name: "Add bank", exact: true }).click();
  bankCode = ((await (await bankCreateResponse).json()) as { code: string }).code;
  await expect(page.getByRole("status")).toContainText("Bank created successfully");

  await page.getByLabel("Search banks").fill(bankCode);
  const bankRow = page.getByRole("row").filter({ hasText: bankName });
  await expect(bankRow).toContainText(bankName);
  await expect(bankRow).not.toContainText(bankCode);
  await expect(bankRow.getByRole("textbox")).toHaveCount(0);
  await bankRow.getByRole("button", { name: `Edit ${bankName}` }).click();
  const editBankDialog = page.getByRole("dialog", { name: "Edit bank" });
  await expect(editBankDialog.getByLabel("Bank code")).toHaveCount(0);
  await editBankDialog.getByLabel("Bank name").fill(renamedBank);
  await editBankDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(bankRow).toContainText(renamedBank);
  await uploadCatalogueImage(page, bankRow, renamedBank, {
    buffer: transparentPng,
    extension: "png",
    mimeType: "image/png",
    ratio: 2,
  }, testInfo);

  await bankRow.getByRole("button", { name: `Deactivate ${renamedBank}` }).click();
  const deactivateDialog = page.getByRole("dialog", { name: "Confirm deactivation" });
  await expect(deactivateDialog).toContainText("does not provide a dependency count");
  await deactivateDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(bankRow.getByRole("button", { name: `Deactivate ${renamedBank}` })).toBeVisible();
  await bankRow.getByRole("button", { name: `Deactivate ${renamedBank}` }).click();
  await page.getByRole("dialog", { name: "Confirm deactivation" }).getByRole("button", { name: "Deactivate" }).click();
  await selectBrandedOption(page.getByLabel("Banks status"), "inactive");
  await expect(bankRow.getByRole("button", { name: `Activate ${renamedBank}` })).toBeVisible();
  await bankRow.getByRole("button", { name: `Activate ${renamedBank}` }).click();
  await page.getByRole("dialog", { name: "Confirm activation" }).getByRole("button", { name: "Activate" }).click();

  await tabs.getByRole("tab", { name: "Products", exact: true }).click();
  await expect(page).toHaveURL(/tab=products/);
  await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "catalog-panel-products");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const addProductDialog = page.getByRole("dialog", { name: "Add product" });
  await addProductDialog.getByLabel("Product name").fill(productName);
  const productCreateResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/products") && response.request().method() === "POST");
  await addProductDialog.getByRole("button", { name: "Add product", exact: true }).click();
  productCode = ((await (await productCreateResponse).json()) as { code: string }).code;
  await page.getByLabel("Search products").fill(productCode);
  const productRow = page.getByRole("row").filter({ hasText: productName });
  await expect(productRow).toContainText(productName);
  await expect(productRow).not.toContainText(productCode);
  await uploadCatalogueImage(page, productRow, productName, {
    buffer: transparentPng,
    extension: "png",
    mimeType: "image/png",
    ratio: 2,
  });

  await tabs.getByRole("tab", { name: "Product Variants", exact: true }).click();
  await page.getByLabel("Variant bank").click();
  await expect(page.getByRole("listbox").getByRole("option", { name: renamedBank, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await tabs.getByRole("tab", { name: "Amount & Target Rules", exact: true }).click();
  await expect(page).toHaveURL(/tab=rules/);
  await selectBrandedOption(page.getByLabel("Rule product"), { label: productName });
  const requestedRule = page.getByLabel("Requested amount required");
  await expect(requestedRule).not.toBeChecked();
  await page.getByRole("button", { name: "About Requested amount rule" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("new application is created");
  await requestedRule.check();
  await page.getByLabel("Amount", { exact: true }).check();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(requestedRule).not.toBeChecked();
  await expect(page.getByLabel("Count", { exact: true })).toBeChecked();
  await requestedRule.check();
  await page.getByLabel("Amount", { exact: true }).check();
  await page.getByRole("button", { name: "Save rule changes" }).click();
  await expect(page.getByRole("status")).toContainText(`Rules saved for ${productName}`);

  await tabs.getByRole("tab", { name: "Bank–Product Mapping", exact: true }).click();
  await expect(page).toHaveURL(/tab=mappings/);
  await selectBrandedOption(page.getByLabel("Mapping bank"), { label: renamedBank });
  await selectBrandedOption(page.getByLabel("Mapping product"), { label: productName });
  await page.getByRole("button", { name: "Add mapping", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("mapping added successfully");
  await page.getByLabel("Search mappings").fill(bankCode);
  const mappingRow = page.getByRole("row").filter({ hasText: renamedBank }).filter({ hasText: productName });
  await expect(mappingRow).toContainText(renamedBank);
  await expect(mappingRow).toContainText(productName);

  await page.getByRole("button", { name: "Add mapping", exact: true }).click();
  await expect(page.getByTestId("authenticated-content").getByRole("alert")).toContainText("already mapped");
  await mappingRow.getByRole("button", { name: `Deactivate ${renamedBank} ${productName} mapping` }).click();
  await expect(page.getByRole("dialog", { name: "Confirm deactivation" })).toBeVisible();
  await page.getByRole("dialog", { name: "Confirm deactivation" }).getByRole("button", { name: "Cancel" }).click();

  await tabs.getByRole("tab", { name: "Product Variants", exact: true }).click();
  await expect(page).toHaveURL(/tab=variants/);
  const availableBanks = ((await (await page.request.get(`${apiOrigin}/api/v1/banks`)).json()) as {
    items: Array<{ id: string; code: string; name: string }>;
  }).items;
  const availableProducts = ((await (await page.request.get(`${apiOrigin}/api/v1/products`)).json()) as {
    items: Array<{ id: string; code: string; name: string }>;
  }).items;
  const mappedBank = availableBanks.find((item) => item.code === bankCode);
  const mappedProduct = availableProducts.find((item) => item.code === productCode);
  expect(mappedBank).toBeTruthy();
  expect(mappedProduct).toBeTruthy();
  await expect(page.getByLabel("Variant bank")).toHaveAttribute("value", mappedBank!.id);
  await expect(page.getByLabel("Variant product category")).toHaveAttribute("value", mappedProduct!.id);

  const otherBank = availableBanks.find((item) => item.code === "DIB");
  expect(otherBank).toBeTruthy();
  await selectBrandedOption(page.getByLabel("Variant bank"), {
    label: otherBank!.name,
  });
  await page.getByLabel("Variant product category").click();
  await expect(page.getByRole("listbox").getByRole("option", { name: productName, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await selectBrandedOption(page.getByLabel("Variant bank"), { label: renamedBank });
  await selectBrandedOption(page.getByLabel("Variant product category"), { label: productName });
  await page.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  const variantName = `Cashback Variant ${suffix}`;
  const renamedVariant = `${variantName} Updated`;
  let variantCode = "";
  const addVariantDialog = page.getByRole("dialog", { name: "Add Product Variant" });
  await expect(addVariantDialog).toContainText(renamedBank);
  await expect(addVariantDialog).not.toContainText(bankCode);
  await expect(addVariantDialog).toContainText(productName);
  await expect(addVariantDialog).not.toContainText(productCode);
  await addVariantDialog.getByLabel("Variant name").fill(variantName);
  await addVariantDialog.getByLabel("Variant description").fill("Real mapped Product Variant");
  const variantCreateResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/product-variants") && response.request().method() === "POST");
  await addVariantDialog.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  variantCode = ((await (await variantCreateResponse).json()) as { code: string }).code;
  await expect(page.getByRole("status")).toContainText("Product Variant created successfully");
  await page.getByLabel("Search Product Variants").fill(variantCode);
  const variantRow = page.getByRole("row").filter({ hasText: variantName });
  await expect(variantRow).toContainText(variantName);
  await expect(variantRow).not.toContainText(variantCode);
  await expect(variantRow).toContainText(renamedBank);
  await expect(variantRow).toContainText(productName);

  await variantRow.getByRole("button", { name: `Edit ${variantName}` }).click();
  const editVariantDialog = page.getByRole("dialog", { name: "Edit Product Variant" });
  await expect(editVariantDialog.getByLabel("Variant code")).toHaveCount(0);
  await editVariantDialog.getByLabel("Variant name").fill(renamedVariant);
  await editVariantDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(variantRow).toContainText(renamedVariant);
  await uploadCatalogueImage(page, variantRow, renamedVariant, {
    buffer: transparentWebp,
    extension: "webp",
    mimeType: "image/webp",
    ratio: 0.6,
  });

  const imageTraffic = await observeCatalogueImageTraffic(page);
  await imageTraffic.clearBrowserCache();
  imageTraffic.clear();
  await page.goto("/catalog?tab=mappings");
  await page.getByLabel("Search mappings").fill(bankCode);
  const coldMappingRow = page.getByRole("row").filter({ hasText: renamedBank }).filter({ hasText: productName });
  await expectUnframedCatalogueImage(coldMappingRow.getByRole("img", { name: `${renamedBank} image` }), 2);
  await expectUnframedCatalogueImage(coldMappingRow.getByRole("img", { name: `${productName} image` }), 2);
  const coldImages = imageTraffic.records();
  const currentImageUrls = [
    `/api/v1/banks/${mappedBank!.id}/image`,
    `/api/v1/products/${mappedProduct!.id}/image`,
  ];
  expect(coldImages.filter((record) => currentImageUrls.some((url) => record.url.includes(url)))).toHaveLength(2);
  expect(coldImages.every((record) => record.status === 200 && !record.cached)).toBeTruthy();

  imageTraffic.clear();
  await page.reload();
  await page.getByLabel("Search mappings").fill(bankCode);
  const warmMappingRow = page.getByRole("row").filter({ hasText: renamedBank }).filter({ hasText: productName });
  await expectUnframedCatalogueImage(warmMappingRow.getByRole("img", { name: `${renamedBank} image` }), 2);
  await expectUnframedCatalogueImage(warmMappingRow.getByRole("img", { name: `${productName} image` }), 2);
  const warmImages = imageTraffic.records();
  expect(warmImages.filter((record) => currentImageUrls.some((url) => record.url.includes(url)))).toHaveLength(2);
  expect(warmImages.every((record) => record.cached)).toBeTruthy();

  await page.goto("/catalog?tab=banks");
  await page.getByLabel("Search banks").fill(bankCode);
  const replacementBankRow = page.getByRole("row").filter({ hasText: renamedBank });
  const replacementBankImage = replacementBankRow.getByRole("img", { name: `${renamedBank} image` });
  await expectUnframedCatalogueImage(replacementBankImage, 2);
  const previousImageSource = await replacementBankImage.getAttribute("src");
  await replacementBankRow.getByRole("button", { name: `Manage image for ${renamedBank}` }).click();
  const replacementDialog = page.getByRole("dialog", { name: "Replace image" });
  await expectUnframedCatalogueImage(replacementDialog.getByRole("img", { name: `${renamedBank} image` }), 2);
  imageTraffic.clear();
  await replacementDialog.getByLabel("PNG, JPEG, or WebP image").setInputFiles({
    name: "replacement-transparent.png",
    mimeType: "image/png",
    buffer: transparentPng,
  });
  await replacementDialog.getByRole("button", { name: "Replace image" }).click();
  await expect(replacementDialog).toHaveCount(0);
  await expectUnframedCatalogueImage(replacementBankImage, 2);
  await expect.poll(() => replacementBankImage.getAttribute("src")).not.toBe(previousImageSource);
  const replacementImages = imageTraffic
    .records()
    .filter((record) => record.url.includes(`/api/v1/banks/${mappedBank!.id}/image`));
  expect(replacementImages).toHaveLength(1);
  expect(replacementImages[0]).toMatchObject({ cached: false, status: 200 });
  await imageTraffic.close();

  await page.goto("/applications");
  await page.getByRole("button", { name: "Create application" }).click();
  const applicationDialog = page.getByRole("dialog", { name: "Create application" });
  await selectBrandedOption(applicationDialog.getByLabel("Bank", { exact: true }), { label: renamedBank });
  await selectBrandedOption(applicationDialog.getByLabel("Product", { exact: true }), { label: productName });
  const applicationVariantSelect = applicationDialog.getByLabel("Product Variant", { exact: true });
  await applicationVariantSelect.click();
  const applicationVariantOption = page.getByRole("listbox").getByRole("option", { name: renamedVariant, exact: true });
  await expectUnframedCatalogueImage(applicationVariantOption.locator(`img[alt=${JSON.stringify(`${renamedVariant} image`)}]`), 0.6);
  await expect(applicationVariantOption).not.toContainText(variantCode);
  await applicationVariantOption.click();
  await expectUnframedCatalogueImage(applicationVariantSelect.locator(`img[alt=${JSON.stringify(`${renamedVariant} image`)}]`), 0.6);
  await expect(applicationVariantSelect).not.toContainText(variantCode);
  const selectedCatalogueImages = applicationDialog.getByLabel("Selected catalogue images");
  await expectUnframedCatalogueImage(applicationDialog.getByRole("img", { name: `${renamedBank} image` }), 2);
  await expectUnframedCatalogueImage(applicationDialog.getByRole("img", { name: `${productName} image` }), 2);
  await expectUnframedCatalogueImage(selectedCatalogueImages.getByRole("img", { name: `${renamedVariant} image` }), 0.6);
  await applicationDialog.getByRole("button", { name: "Cancel" }).click();

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);

    async function inspectRecord(row: Locator, name: string) {
      await row.scrollIntoViewIfNeeded();
      const actions = row.getByRole("button");
      expect(await actions.count()).toBeGreaterThan(0);
      if (viewport.width === 390) {
        for (const action of await actions.all()) {
          const bounds = await action.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        }
      }
      await captureViewportThemes(page, testInfo.outputPath(`catalog-${name}-${viewport.width}.png`), row);
    }

    await page.goto("/catalog?tab=banks");
    await page.getByLabel("Search banks").fill(bankCode);
    await expectUnframedCatalogueImage(
      page.getByRole("row").filter({ hasText: renamedBank }).getByRole("img", { name: `${renamedBank} image` }),
      2,
    );
    await inspectRecord(page.getByRole("row").filter({ hasText: renamedBank }), "bank-record");

    await page.goto("/catalog?tab=products");
    await page.getByLabel("Search products").fill(productCode);
    await expectUnframedCatalogueImage(
      page.getByRole("row").filter({ hasText: productName }).getByRole("img", { name: `${productName} image` }),
      2,
    );
    await inspectRecord(page.getByRole("row").filter({ hasText: productName }), "product-record");

    await page.goto("/catalog?tab=mappings");
    await page.getByLabel("Search mappings").fill(bankCode);
    const responsiveMappingRow = page.getByRole("row").filter({ hasText: renamedBank }).filter({ hasText: productName });
    await expectUnframedCatalogueImage(responsiveMappingRow.getByRole("img", { name: `${renamedBank} image` }), 2);
    await expectUnframedCatalogueImage(responsiveMappingRow.getByRole("img", { name: `${productName} image` }), 2);
    await inspectRecord(responsiveMappingRow, "mapping-record");

    await page.goto("/catalog?tab=variants");
    await selectBrandedOption(page.getByLabel("Variant bank"), { label: renamedBank });
    await selectBrandedOption(page.getByLabel("Variant product category"), { label: productName });
    await page.getByLabel("Search Product Variants").fill(variantCode);
    await expectUnframedCatalogueImage(
      page.getByRole("row").filter({ hasText: renamedVariant }).getByRole("img", { name: `${renamedVariant} image` }),
      0.6,
    );
    await inspectRecord(page.getByRole("row").filter({ hasText: renamedVariant }), "variant-record");

    await page.goto("/applications");
    await page.getByRole("button", { name: "Create application" }).click();
    const responsiveApplicationDialog = page.getByRole("dialog", { name: "Create application" });
    await selectBrandedOption(responsiveApplicationDialog.getByLabel("Bank", { exact: true }), { label: renamedBank });
    await selectBrandedOption(responsiveApplicationDialog.getByLabel("Product", { exact: true }), { label: productName });
    const responsiveVariantSelect = responsiveApplicationDialog.getByLabel("Product Variant", { exact: true });
    await responsiveVariantSelect.click();
    const responsiveVariantOption = page.getByRole("listbox").getByRole("option", { name: renamedVariant, exact: true });
    await expectUnframedCatalogueImage(responsiveVariantOption.locator(`img[alt=${JSON.stringify(`${renamedVariant} image`)}]`), 0.6);
    await captureViewportThemes(page, testInfo.outputPath(`application-variant-options-${viewport.width}.png`), responsiveApplicationDialog);
    await responsiveVariantOption.click();
    await expectUnframedCatalogueImage(responsiveVariantSelect.locator(`img[alt=${JSON.stringify(`${renamedVariant} image`)}]`), 0.6);
    await expect(responsiveVariantSelect).not.toContainText(variantCode);
    await captureViewportThemes(page, testInfo.outputPath(`application-variant-selected-${viewport.width}.png`), responsiveApplicationDialog);
    const responsiveSelectedImages = responsiveApplicationDialog.getByLabel("Selected catalogue images");
    await expectUnframedCatalogueImage(responsiveApplicationDialog.getByRole("img", { name: `${renamedBank} image` }), 2);
    await expectUnframedCatalogueImage(responsiveApplicationDialog.getByRole("img", { name: `${productName} image` }), 2);
    await expectUnframedCatalogueImage(responsiveSelectedImages.getByRole("img", { name: `${renamedVariant} image` }), 0.6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    await responsiveApplicationDialog.getByRole("button", { name: "Cancel" }).click();
  }

  await page.goto("/catalog?tab=variants");
  await selectBrandedOption(page.getByLabel("Variant bank"), { label: renamedBank });
  await selectBrandedOption(page.getByLabel("Variant product category"), { label: productName });
  await page.getByLabel("Search Product Variants").fill(variantCode);

  await page.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  const duplicateDialog = page.getByRole("dialog", { name: "Add Product Variant" });
  await duplicateDialog.getByLabel("Variant name").fill(renamedVariant);
  await expect(duplicateDialog.getByLabel("Variant code")).toHaveCount(0);
  await duplicateDialog.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  await expect(duplicateDialog.getByRole("alert")).toContainText("already exists");
  await duplicateDialog.getByRole("button", { name: "Cancel" }).click();

  await variantRow.getByRole("button", { name: `Deactivate ${renamedVariant}` }).click();
  const variantStatusDialog = page.getByRole("dialog", { name: "Confirm deactivation" });
  await expect(variantStatusDialog).toContainText("does not provide a dependency count");
  await variantStatusDialog.getByRole("button", { name: "Deactivate" }).click();
  await selectBrandedOption(page.getByLabel("Product Variant status"), "inactive");
  await expect(variantRow.getByRole("button", { name: `Activate ${renamedVariant}` })).toBeVisible();
  await variantRow.getByRole("button", { name: `Activate ${renamedVariant}` }).click();
  const variantActivationDialog = page.getByRole("dialog", { name: "Confirm activation" });
  await variantActivationDialog.getByRole("button", { name: "Activate" }).click();
  await expect(variantActivationDialog).toHaveCount(0);
  await selectBrandedOption(page.getByLabel("Product Variant status"), "all");
  await expect(variantRow).toBeVisible();

  await variantRow.getByRole("button", { name: `Manage image for ${renamedVariant}` }).click();
  const removeImageDialog = page.getByRole("dialog", { name: "Replace image" });
  await removeImageDialog.getByRole("button", { name: "Remove image" }).click();
  await expect(removeImageDialog).toHaveCount(0);
  await expect(variantRow.getByLabel(`No image for ${renamedVariant}`)).toBeVisible();

  await tabs.getByRole("tab", { name: "Products", exact: true }).click();
  await page.getByLabel("Search products").fill(productCode);
  await productRow.getByRole("button", { name: `Deactivate ${productName}` }).click();
  await page.getByRole("dialog", { name: "Confirm deactivation" }).getByRole("button", { name: "Deactivate" }).click();
  await tabs.getByRole("tab", { name: "Product Variants", exact: true }).click();
  await page.getByLabel("Variant bank").click();
  await expect(page.getByRole("listbox").getByRole("option", { name: renamedBank, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/catalog?tab=variants");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    await expect(page.getByRole("tab", { name: "Product Variants", exact: true })).toHaveAttribute("aria-selected", "true");
  }
});
