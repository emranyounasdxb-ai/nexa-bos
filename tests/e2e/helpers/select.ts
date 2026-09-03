import { expect, type Locator } from "@playwright/test";

type OptionTarget = string | { label?: string | RegExp; value?: string };

export async function selectBrandedOption(combobox: Locator, target: OptionTarget) {
  await combobox.click();
  const listbox = combobox.page().getByRole("listbox");
  await expect(listbox).toBeVisible();
  if (typeof target === "object" && target.label !== undefined) {
    await listbox.getByRole("option", {
      name: target.label,
      exact: typeof target.label === "string",
    }).click();
    return;
  }
  const value = typeof target === "string" ? target : target.value ?? "";
  const option = listbox.locator(`[role="option"][data-option-value=${JSON.stringify(value)}]`);
  await expect(option, `Option value ${value} should exist`).toHaveCount(1);
  await option.click();
}

export async function brandedOptionValues(combobox: Locator) {
  await combobox.click();
  const listbox = combobox.page().getByRole("listbox");
  await expect(listbox).toBeVisible();
  const values = await listbox.getByRole("option").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-option-value") ?? ""));
  await combobox.page().keyboard.press("Escape");
  return values;
}
