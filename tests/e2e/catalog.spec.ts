import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { selectBrandedOption } from "./helpers/select";

const apiOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "8010"}`;
const secret = process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret";
const cataloguePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGPMlGlgYGBgYgADAAxPAQk/0RnlAAAAAElFTkSuQmCC",
  "base64",
);

async function uploadCatalogueImage(page: Page, row: Locator, name: string) {
  await row.getByRole("button", { name: `Manage image for ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: "Add image" });
  await expect(dialog.getByLabel(`No image for ${name}`)).toBeVisible();
  await dialog.getByLabel("PNG, JPEG, or WebP image").setInputFiles({
    name: "catalogue.png",
    mimeType: "image/png",
    buffer: cataloguePng,
  });
  await dialog.getByRole("button", { name: "Upload image" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("img", { name: `${name} image` })).toBeVisible();
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

test("catalog uses task tabs, modal editing, explicit rule saves, and mapping validation", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, request);
  const suffix = Date.now().toString(36).slice(-7).toUpperCase();
  const bankCode = `B${suffix}`;
  const productCode = `P${suffix}`;
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
  await expect(addBankDialog.getByText("cannot be changed after creation", { exact: false })).toBeVisible();
  await addBankDialog.getByLabel("Bank name").fill(bankName);
  await addBankDialog.getByLabel("Bank code").fill(bankCode);
  await addBankDialog.getByRole("button", { name: "Add bank", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Bank created successfully");

  await page.getByLabel("Search banks").fill(bankCode);
  const bankRow = page.getByRole("row").filter({ hasText: bankCode });
  await expect(bankRow).toContainText(bankName);
  await expect(bankRow.getByRole("textbox")).toHaveCount(0);
  await bankRow.getByRole("button", { name: `Edit ${bankName}` }).click();
  const editBankDialog = page.getByRole("dialog", { name: "Edit bank" });
  await expect(editBankDialog.getByLabel("Bank code")).toBeDisabled();
  await expect(editBankDialog.getByLabel("Bank code")).toHaveValue(bankCode);
  await editBankDialog.getByLabel("Bank name").fill(renamedBank);
  await editBankDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(bankRow).toContainText(renamedBank);
  await uploadCatalogueImage(page, bankRow, renamedBank);

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
  await addProductDialog.getByLabel("Product code").fill(productCode);
  await addProductDialog.getByRole("button", { name: "Add product", exact: true }).click();
  await page.getByLabel("Search products").fill(productCode);
  const productRow = page.getByRole("row").filter({ hasText: productCode });
  await expect(productRow).toContainText(productName);
  await uploadCatalogueImage(page, productRow, productName);

  await tabs.getByRole("tab", { name: "Product Variants", exact: true }).click();
  await page.getByLabel("Variant bank").click();
  await expect(page.getByRole("listbox").getByRole("option", { name: `${renamedBank} (${bankCode})` })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await tabs.getByRole("tab", { name: "Amount & Target Rules", exact: true }).click();
  await expect(page).toHaveURL(/tab=rules/);
  await selectBrandedOption(page.getByLabel("Rule product"), { label: `${productName} (${productCode})` });
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
  await selectBrandedOption(page.getByLabel("Mapping bank"), { label: `${renamedBank} (${bankCode})` });
  await selectBrandedOption(page.getByLabel("Mapping product"), { label: `${productName} (${productCode})` });
  await page.getByRole("button", { name: "Add mapping", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("mapping added successfully");
  await page.getByLabel("Search mappings").fill(bankCode);
  const mappingRow = page.getByRole("row").filter({ hasText: `${bankCode}` }).filter({ hasText: productCode });
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
    label: `${otherBank!.name} (${otherBank!.code})`,
  });
  await page.getByLabel("Variant product category").click();
  await expect(page.getByRole("listbox").getByRole("option", { name: `${productName} (${productCode})` })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await selectBrandedOption(page.getByLabel("Variant bank"), { label: `${renamedBank} (${bankCode})` });
  await selectBrandedOption(page.getByLabel("Variant product category"), { label: `${productName} (${productCode})` });
  await page.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  const variantName = `Cashback Variant ${suffix}`;
  const renamedVariant = `${variantName} Updated`;
  const variantCode = `V${suffix}`;
  const addVariantDialog = page.getByRole("dialog", { name: "Add Product Variant" });
  await expect(addVariantDialog).toContainText(`${renamedBank} (${bankCode})`);
  await expect(addVariantDialog).toContainText(`${productName} (${productCode})`);
  await addVariantDialog.getByLabel("Variant name").fill(variantName);
  await addVariantDialog.getByLabel("Variant code").fill(variantCode);
  await addVariantDialog.getByLabel("Variant description").fill("Real mapped Product Variant");
  await addVariantDialog.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Product Variant created successfully");
  await page.getByLabel("Search Product Variants").fill(variantCode);
  const variantRow = page.getByRole("row").filter({ hasText: variantCode });
  await expect(variantRow).toContainText(variantName);
  await expect(variantRow).toContainText(renamedBank);
  await expect(variantRow).toContainText(productName);

  await variantRow.getByRole("button", { name: `Edit ${variantName}` }).click();
  const editVariantDialog = page.getByRole("dialog", { name: "Edit Product Variant" });
  await expect(editVariantDialog.getByLabel("Variant code")).toBeDisabled();
  await editVariantDialog.getByLabel("Variant name").fill(renamedVariant);
  await editVariantDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(variantRow).toContainText(renamedVariant);
  await uploadCatalogueImage(page, variantRow, renamedVariant);

  await page.goto("/applications");
  await page.getByRole("button", { name: "Create application" }).click();
  const applicationDialog = page.getByRole("dialog", { name: "Create application" });
  await selectBrandedOption(applicationDialog.getByLabel("Bank", { exact: true }), { label: `${renamedBank} (${bankCode})` });
  await selectBrandedOption(applicationDialog.getByLabel("Product", { exact: true }), { label: `${productName} (${productCode})` });
  await selectBrandedOption(applicationDialog.getByLabel("Product Variant", { exact: true }), { label: `${renamedVariant} (${variantCode})` });
  await expect(applicationDialog.getByRole("img", { name: `${renamedBank} image` })).toBeVisible();
  await expect(applicationDialog.getByRole("img", { name: `${productName} image` })).toBeVisible();
  await expect(applicationDialog.getByRole("img", { name: `${renamedVariant} image` })).toBeVisible();
  await applicationDialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/catalog?tab=variants");
  await selectBrandedOption(page.getByLabel("Variant bank"), { label: `${renamedBank} (${bankCode})` });
  await selectBrandedOption(page.getByLabel("Variant product category"), { label: `${productName} (${productCode})` });
  await page.getByLabel("Search Product Variants").fill(variantCode);

  await page.getByRole("button", { name: "Add Product Variant", exact: true }).click();
  const duplicateDialog = page.getByRole("dialog", { name: "Add Product Variant" });
  await duplicateDialog.getByLabel("Variant name").fill(renamedVariant);
  await duplicateDialog.getByLabel("Variant code").fill(variantCode);
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
  await expect(page.getByRole("listbox").getByRole("option", { name: `${renamedBank} (${bankCode})` })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/catalog?tab=variants");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    await expect(page.getByRole("tab", { name: "Product Variants", exact: true })).toHaveAttribute("aria-selected", "true");
  }
});
