import { expect, test, type Page } from "@playwright/test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const fixtureProjectRoot = path.resolve(process.env.DATA_EDITOR_FIXTURE_PROJECT_ROOT ?? path.join(process.cwd(), "..", "Nocturnel"));
const fixtureRunesPath = path.join(fixtureProjectRoot, "data", "runes.json");

test.setTimeout(60_000);

type SharedViewConfig = {
  id: string;
  name: string;
  type?: string;
  query?: string;
  filters?: { op?: string; rules?: Array<Record<string, unknown>> } | null;
  sorts?: Array<{ id?: string; field?: string; direction?: string }>;
};

type SharedViewsConfig = {
  collections: Record<string, { views: SharedViewConfig[]; defaultViewId: string | null }>;
};

async function configureRelation(page: Page, fieldName: string, options: {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  mode: "single" | "multi";
}) {
  const closeDetail = page.locator('.detail-panel.primary button[title="Close detail"]');
  if (await closeDetail.isVisible().catch(() => false)) await closeDetail.evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(`.column-trigger[title="${fieldName}"]`).click();
  const action = page.locator('.column-menu-popup [data-relation-action="create"], .column-menu-popup [data-relation-action="edit"]').first();
  await expect(action).toBeVisible();
  await action.dispatchEvent("click");
  await expect(page.locator(".relation-config-dialog")).toBeVisible();
  await chooseDialogSelect(page, "目标文件", options.targetFile);
  await chooseDialogSelect(page, "目标集合", options.targetCollection);
  await chooseDialogSelect(page, "目标主键", options.targetKey);
  await chooseDialogSelect(page, "关系模式", options.mode);
  await page.locator(".relation-config-dialog .primary-button").click();
  await expect(page.locator(".relation-config-dialog")).toHaveCount(0);
}

async function ensurePrimaryKeySelection(page: Page, fieldName: string) {
  const banner = page.locator(".primary-key-candidate-banner");
  if (!(await banner.isVisible().catch(() => false))) return;
  await banner.locator(".primary-button").click();
  await expect(page.locator(".primary-key-candidate-dialog")).toBeVisible();
  const candidateField = page.locator(".primary-key-candidate-dialog .dialog-field").filter({ hasText: "候选字段" });
  if (await candidateField.count()) {
    const trigger = candidateField.locator(".select-trigger");
    if (!(await trigger.textContent())?.includes(fieldName)) {
      await trigger.click();
      await page.locator('[role="option"]').filter({ hasText: fieldName }).first().click();
    }
  }
  await page.locator(".primary-key-candidate-dialog .primary-button").click();
  await expect(page.locator(".primary-key-candidate-dialog")).toHaveCount(0);
  await expect(banner).toHaveCount(0);
}

async function chooseDialogSelect(page: Page, label: string, option: string) {
  const field = page.locator(".relation-config-dialog .dialog-field").filter({ hasText: label });
  if ((await field.locator(".select-trigger").textContent())?.includes(option)) return;
  await field.locator(".select-trigger").click();
  if (option === "single" || option === "multi") {
    await page.locator('[role="option"]').nth(option === "single" ? 0 : 1).click();
    return;
  }
  await page.locator('[role="option"]').filter({ hasText: option }).first().click();
}

async function dispatchRecoverableFailure(page: Page, message = "synthetic disconnect") {
  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent("data-editor:recoverable-request", {
      detail: {
        url: "/api/save",
        status: "failure",
        message: detail,
      },
    }));
  }, message);
}

async function scrollColumnHeaderNearEdge(page: Page, fieldName: string, edge: "left" | "right" = "right") {
  await page.evaluate(({ currentField, currentEdge }) => {
    const table = document.querySelector(".table-scroll") as HTMLElement | null;
    const trigger = document.querySelector(`.column-trigger[title="${currentField}"]`) as HTMLElement | null;
    if (!table || !trigger) return;
    const tableRect = table.getBoundingClientRect();
    const handleRect = trigger.getBoundingClientRect();
    const targetX = currentEdge === "right" ? tableRect.right - 72 : tableRect.left + 72;
    table.scrollLeft += Math.round(handleRect.left + handleRect.width / 2 - targetX);
  }, { currentField: fieldName, currentEdge: edge });
  await page.waitForTimeout(50);
}

async function dragColumnHeader(page: Page, sourceField: string, targetField: string) {
  const sourceLocator = page.locator(`.column-trigger[title="${sourceField}"]`);
  const targetLocator = page.locator(`.column-trigger[title="${targetField}"]`);
  let dragSource = await sourceLocator.boundingBox();
  let dragTarget = await targetLocator.boundingBox();
  if (!dragSource) {
    await sourceLocator.scrollIntoViewIfNeeded();
    dragSource = await sourceLocator.boundingBox();
  }
  if (!dragTarget) {
    await targetLocator.scrollIntoViewIfNeeded();
    dragTarget = await targetLocator.boundingBox();
  }
  expect(dragSource).not.toBeNull();
  expect(dragTarget).not.toBeNull();
  await page.mouse.move(dragSource!.x + dragSource!.width / 2, dragSource!.y + dragSource!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragSource!.x + dragSource!.width / 2 - 18, dragSource!.y + dragSource!.height / 2, { steps: 4 });
  await expect(page.locator(".column-drag-ghost")).toBeVisible();
  await page.mouse.move(dragTarget!.x + dragTarget!.width * 0.25, dragTarget!.y + dragTarget!.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function dragOptionHandle(page: Page, sourceRowText: string, targetRowText: string) {
  await beginOptionHandleDrag(page, sourceRowText);
  await movePointerOverOptionRow(page, targetRowText);
  await endOptionHandleDrag(page, sourceRowText, targetRowText);
}

async function beginOptionHandleDrag(page: Page, sourceRowText: string) {
  await page.evaluate((sourceText) => {
    const sourceHandle = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(sourceText))
      ?.querySelector(".option-drag-handle");
    if (!(sourceHandle instanceof HTMLElement)) return;
    const shared = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    sourceHandle.dispatchEvent(new PointerEvent("pointerdown", { ...shared, button: 0, buttons: 1 }));
  }, sourceRowText);
}

async function hoverOptionRow(page: Page, targetRowText: string) {
  await page.evaluate((targetText) => {
    const targetRow = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(targetText));
    if (!(targetRow instanceof HTMLElement)) return;
    const shared = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    targetRow.dispatchEvent(new PointerEvent("pointerover", { ...shared, button: 0, buttons: 1 }));
  }, targetRowText);
}

async function movePointerOverOptionRow(page: Page, targetRowText: string) {
  await page.evaluate(async (targetText) => {
    const targetRow = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(targetText));
    if (!(targetRow instanceof HTMLElement)) return;
    const rect = targetRow.getBoundingClientRect();
    const shared = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height * 0.1,
    };
    targetRow.dispatchEvent(new PointerEvent("pointermove", shared));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }, targetRowText);
}

async function endOptionHandleDrag(page: Page, sourceRowText: string, targetRowText: string) {
  await page.evaluate(({ sourceText, targetText }) => {
    const sourceHandle = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(sourceText))
      ?.querySelector(".option-drag-handle");
    const targetRow = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(targetText));
    if (!(sourceHandle instanceof HTMLElement) || !(targetRow instanceof HTMLElement)) return;
    const shared = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const pointerUp = new PointerEvent("pointerup", { ...shared, button: 0, buttons: 0 });
    sourceHandle.dispatchEvent(pointerUp);
    targetRow.dispatchEvent(pointerUp);
    window.dispatchEvent(pointerUp);
  }, { sourceText: sourceRowText, targetText: targetRowText });
}

async function getSidebarFileOrder(page: Page) {
  return page.locator(".sidebar-section").first().locator(".sidebar-file-item").evaluateAll((items) => (
    items.map((item) => item.getAttribute("title")).filter((title): title is string => Boolean(title))
  ));
}

async function dragSidebarFile(page: Page, sourcePath: string, targetPath: string, placement: "before" | "after" = "before") {
  const sourceLocator = page.locator(`.sidebar-file-item[title="${sourcePath}"]`);
  const targetLocator = page.locator(`.sidebar-file-item[title="${targetPath}"]`);
  await sourceLocator.scrollIntoViewIfNeeded();
  await targetLocator.scrollIntoViewIfNeeded();
  const source = await sourceLocator.boundingBox();
  const target = await targetLocator.boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  const startX = source!.x + source!.width / 2;
  const startY = source!.y + source!.height / 2;
  const targetY = placement === "before" ? target!.y + target!.height * 0.25 : target!.y + target!.height * 0.75;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 8, { steps: 3 });
  await expect(sourceLocator).toHaveClass(/is-dragging/);
  await page.mouse.move(target!.x + target!.width / 2, targetY, { steps: 8 });
  await page.mouse.up();
}

async function getViewTabNames(page: Page) {
  return page.locator(".view-tab").evaluateAll((tabs) => (
    tabs.map((tab) => tab.textContent?.trim() ?? "").filter(Boolean)
  ));
}

async function selectViewTab(page: Page, name: string) {
  await page.locator(".view-tab").filter({ hasText: name }).first().click();
  await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText(name);
  if (await page.locator(".view-tab-menu-content").count()) {
    await page.locator(".view-tab-menu-item").filter({ hasText: "编辑视图" }).click();
  }
  await expect(page.locator(".view-tab-menu-content")).toHaveCount(0);
}

async function dragViewTab(page: Page, sourceName: string, targetName: string, placement: "before" | "after" = "before") {
  const sourceLocator = page.locator(".view-tab").filter({ hasText: sourceName }).first();
  const targetLocator = page.locator(".view-tab").filter({ hasText: targetName }).first();
  const targetShell = page.locator(".view-tab-shell").filter({ has: targetLocator }).first();
  const source = await sourceLocator.boundingBox();
  const target = await targetShell.boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  const startX = source!.x + source!.width / 2;
  const startY = source!.y + source!.height / 2;
  const targetX = placement === "before" ? target!.x + target!.width * 0.08 : target!.x + target!.width * 0.92;
  const targetY = target!.y + target!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 12, startY, { steps: 3 });
  await expect(page.locator(".view-tab-shell.dragging .view-tab")).toContainText(sourceName);
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await expect(targetShell).toHaveClass(new RegExp(`drop-${placement}`));
  await page.mouse.up();
}

async function saveSharedViewForEveryone(page: Page, persisted: (config: SharedViewsConfig) => boolean | Promise<boolean>) {
  const enabledSaveButtons = page.locator(".view-filter-actions .save-shared:not([disabled])");
  await expect(enabledSaveButtons.first()).toBeVisible();
  await enabledSaveButtons.first().evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => persisted(await loadSharedViewsConfig(page))).toBe(true);
}

async function loadSharedViewsConfig(page: Page): Promise<SharedViewsConfig> {
  return page.evaluate(async () => {
    const response = await fetch("/api/shared-views");
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
}

async function saveSharedViewsConfig(page: Page, config: unknown) {
  await page.evaluate(async (nextConfig) => {
    const response = await fetch("/api/shared-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: nextConfig }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, config);
}

async function snapshotLocalStorage(page: Page) {
  return page.evaluate(() => {
    const snapshot: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) snapshot[key] = localStorage.getItem(key) ?? "";
    }
    return snapshot;
  });
}

async function restoreLocalStorage(page: Page, snapshot: Record<string, string>) {
  await page.evaluate((nextSnapshot) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(nextSnapshot)) {
      localStorage.setItem(key, value);
    }
  }, snapshot);
}

async function bestEffortRestore(label: string, restore: () => Promise<void>) {
  try {
    await restore();
  } catch (error) {
    console.warn(`Failed to restore ${label}:`, error);
  }
}

function getSharedView(config: SharedViewsConfig, collectionKey: string, viewId: string) {
  return config.collections[collectionKey]?.views.find((view) => view.id === viewId);
}

function filterValues(view: SharedViewConfig | undefined, field: string) {
  const rule = view?.filters?.rules?.find((candidate) => candidate.field === field);
  const value = rule?.value;
  return Array.isArray(value) ? value.map((item) => String(item)) : value == null || value === "" ? [] : [String(value)];
}

function hasSort(view: SharedViewConfig | undefined, field: string, direction: string) {
  return Boolean(view?.sorts?.some((sort) => sort.field === field && sort.direction === direction));
}

test("column header menu copies the field name to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.locator('.column-trigger[title="category"]').click();
  const copyAction = page.locator(".column-menu-popup .menu-item").filter({ hasText: "复制字段文本" });
  await expect(copyAction).toBeVisible();
  await copyAction.click();

  await expect(page.locator(".column-menu-popup")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("category");
});

test("shared view filter and sort drafts persist through save and reload", async ({ page }) => {
  const collectionKey = "data/e2e_multiselect.json:$";
  const dataPath = path.resolve("tests/.scratch/data/e2e_multiselect.json");
  const originalData = await readFile(dataPath, "utf8");
  let originalSharedViews: SharedViewsConfig | null = null;
  let originalLocalStorage: Record<string, string> | null = null;

  await page.goto("/");
  originalSharedViews = await loadSharedViewsConfig(page);
  originalLocalStorage = await snapshotLocalStorage(page);

  try {
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();
    const initialTabs = await getViewTabNames(page);
    expect(initialTabs.length).toBeGreaterThan(0);
    await expect(page.locator(".view-tab-shell.active")).toHaveCount(1);
    const defaultViewName = (await page.locator(".view-tab-shell.active .view-tab").textContent())?.trim();
    expect(defaultViewName).toBeTruthy();

    await page.locator(".view-tab-create").click();
    await expect(page.locator(".view-tab")).toHaveCount(initialTabs.length + 1);
    const createdViewName = (await getViewTabNames(page))[initialTabs.length]!;
    await page.reload();
    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect(page.locator(".view-tab").filter({ hasText: createdViewName })).toBeVisible();

    const sharedViews = await loadSharedViewsConfig(page);
    const createdView = sharedViews.collections[collectionKey].views.find((view) => view.name === createdViewName)!;
    let activeViewName = "E2E attack";
    createdView.name = activeViewName;
    createdView.filters = {
      op: "and",
      rules: [],
    };
    createdView.sorts = [];
    await saveSharedViewsConfig(page, sharedViews);
    await page.evaluate(({ key, viewId }) => {
      localStorage.setItem("data-editor:shared-view-drafts", JSON.stringify({
        lastActiveViews: { [key]: viewId },
        viewDrafts: {},
        viewOrderDrafts: {},
      }));
    }, { key: collectionKey, viewId: createdView.id });

    await page.reload();
    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await selectViewTab(page, activeViewName);
    await page.locator(".view-tab-shell.active .view-tab").click();
    await expect(page.locator(".view-tab-menu-content")).toBeVisible();
    await page.locator(".view-tab-menu-item").filter({ hasText: "重命名" }).click();
    await page.getByLabel("视图名称").fill("E2E renamed");
    await page.locator(".view-tab-rename-form button[type='submit']").click();
    activeViewName = "E2E renamed";
    await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText(activeViewName);
    await expect.poll(async () => getSharedView(await loadSharedViewsConfig(page), collectionKey, createdView.id)?.name).toBe(activeViewName);

    await page.getByRole("button", { name: "+ 筛选" }).click();
    await expect(page.locator(".add-filter-popover-content")).toBeVisible();
    await page.locator(".add-filter-field-option").filter({ hasText: "features" }).click();
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toBeVisible();
    await expect(page.locator(".filter-popover-content")).toBeVisible();
    await page.locator(".filter-checkbox-item").filter({ hasText: "attack" }).click();
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "attack" })).toBeVisible();
    await expect(page.locator(".view-tab-shell.dirty")).toHaveCount(1);
    await expect(page.locator(".view-tab-shell.dirty .view-tab")).toContainText(activeViewName);
    await expect(page.locator(".dirty-pill")).toHaveCount(0);
    await expect(page.locator(".view-filter-actions .save-shared")).toBeEnabled();
    await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);
    await expect(page.locator(".data-table tbody tr[data-row-index]").first()).toHaveAttribute("data-row-index", "1");

    await page.locator(".filter-popover-content").press("Escape");
    await page.locator('.column-trigger[title="id"]').click();
    await expect(page.locator(".column-menu-popup")).toBeVisible();
    await page.locator('.column-menu-popup .menu-item[data-column-action="add-filter"]').click();
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "id" })).toBeVisible();
    await expect(page.locator(".filter-popover-content")).toBeVisible();
    await page.locator(".filter-text-input").fill("multi_2");
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "multi_2" })).toBeVisible();
    await page.locator(".filter-popover-content").press("Escape");

    await page.locator('.column-trigger[title="name"]').click();
    await expect(page.locator(".column-menu-popup")).toBeVisible();
    await page.locator(".column-menu-popup .menu-item").nth(1).click();
    await expect(page.locator(".view-tab-shell.dirty")).toHaveCount(1);
    await saveSharedViewForEveryone(page, (config) => {
      const savedView = getSharedView(config, collectionKey, createdView.id);
      const values = filterValues(savedView, "features");
      const idValues = filterValues(savedView, "id");
      return values.includes("attack") && idValues.includes("multi_2") && hasSort(savedView, "name", "desc");
    });
    await expect(page.locator(".view-tab-shell.dirty")).toHaveCount(0);

    await page.reload();
    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await selectViewTab(page, activeViewName);
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "attack" })).toBeVisible();
    await expect(page.locator('.view-filter-chip.sort-chip[title="name desc"]')).toBeVisible();
    await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);
    await expect(page.locator(".data-table tbody tr[data-row-index]").first()).toHaveAttribute("data-row-index", "1");

    await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
    const nameInput = page.locator(".detail-panel.primary .property-block").filter({ hasText: "name" }).locator(".detail-input").first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Filtered original row edited");
    await page.locator(".toolbar .primary-button").click();
    await expect.poll(async () => {
      const text = await readFile(dataPath, "utf8");
      const rows = JSON.parse(text) as Array<{ name: string }>;
      return rows.map((row) => row.name).join("|");
    }).toBe("Multi Select|Filtered original row edited");

    await page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "attack" }).click();
    await expect(page.locator(".filter-popover-content")).toBeVisible();
    await page.locator(".filter-action-trigger").click();
    await expect(page.locator(".filter-action-menu")).toBeVisible();
    await page.locator(".filter-action-menu .menu-item.danger").evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.locator(".view-filter-chip:not(.sort-chip)")).toHaveCount(1);
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "multi_2" })).toBeVisible();
    await expect(page.locator(".view-tab-shell.dirty")).toHaveCount(1);
    await saveSharedViewForEveryone(page, (config) => {
      const savedView = getSharedView(config, collectionKey, createdView.id);
      return Boolean(savedView && filterValues(savedView, "features").length === 0 && filterValues(savedView, "id").includes("multi_2") && hasSort(savedView, "name", "desc"));
    });

    await page.reload();
    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await selectViewTab(page, activeViewName);
    await expect(page.locator(".view-filter-chip:not(.sort-chip)")).toHaveCount(1);
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "multi_2" })).toBeVisible();

    await dragViewTab(page, activeViewName, defaultViewName!, "before");
    await expect.poll(async () => (await getViewTabNames(page))[0]).toBe(activeViewName);
    await expect(page.locator(".view-order-dirty")).toBeVisible();
    await saveSharedViewForEveryone(page, (config) => config.collections[collectionKey]?.views[0]?.id === createdView.id);
    await page.reload();
    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect.poll(async () => (await getViewTabNames(page))[0]).toBe(activeViewName);
  } finally {
    await bestEffortRestore("e2e_multiselect.json", () => writeFile(dataPath, originalData, "utf8"));
    if (originalSharedViews) await bestEffortRestore("shared views config", () => saveSharedViewsConfig(page, originalSharedViews));
    if (originalLocalStorage) await bestEffortRestore("localStorage", () => restoreLocalStorage(page, originalLocalStorage));
  }
});

test("multi-select filter popover uses shared shell and scroll section", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.getByRole("button", { name: "+ 筛选" }).click();
  await expect(page.locator(".add-filter-popover-content")).toBeVisible();
  await page.locator(".add-filter-field-option").filter({ hasText: "dev_tags" }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "dev_tags" })).toBeVisible();
  const multiScrollSection = page.locator(".filter-popover-section-scroll");
  await expect(page.locator(".filter-popover-shell")).toBeVisible();
  await expect(multiScrollSection).toBeVisible();
  await expect(multiScrollSection).toHaveCSS("max-height", "500px");
  await expect(multiScrollSection).toHaveCSS("overflow-y", "auto");
  const multiScrollMetrics = await multiScrollSection.evaluate((node) => {
    const element = node as HTMLDivElement;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(multiScrollMetrics.scrollHeight).toBeGreaterThan(multiScrollMetrics.clientHeight);
  const multiListMetrics = await page.locator(".filter-option-list").evaluate((node) => {
    const element = node as HTMLDivElement;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(multiListMetrics.scrollHeight).toBeGreaterThan(multiScrollMetrics.clientHeight);
});

test("multi-select filter popover supports operator text, selected chips, search, and checkbox rows", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "features" }).click();

  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(2);
  await expect(filterPopover.locator(".filter-option-search-input")).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);
  await expect(filterPopover).not.toContainText("未选择");
  await expect(filterPopover.locator(".filter-popover-section-scroll")).toHaveCSS("max-height", "500px");
  await expect(filterPopover.locator(".filter-selected-chip-list")).toHaveCSS("min-height", "36px");
  await expect(filterPopover.locator(".filter-selected-chip-list")).toHaveCSS("align-items", "center");
  await expect(filterPopover.locator(".filter-selected-chip-list")).toHaveCSS("padding-top", "0px");
  await expect(filterPopover.locator(".filter-selected-chip-list")).toHaveCSS("padding-bottom", "0px");
  await expect(filterPopover.locator(".filter-option-list")).toHaveCSS("row-gap", "0px");
  await expect(filterPopover.locator(".filter-option-row").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(await filterPopover.locator(".filter-option-row input[type='checkbox']").count()).toBeGreaterThan(0);

  await filterPopover.locator(".filter-option-search-input").fill("spe");
  await expect(filterPopover.locator(".filter-option-row").filter({ hasText: "spell" })).toBeVisible();
  await expect(filterPopover.locator(".filter-option-row").filter({ hasText: "attack" })).toHaveCount(0);

  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "spell" })).toBeVisible();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toContainText("包含任一");
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toContainText("spell");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);

  await filterPopover.locator('.filter-selected-chip-list .selected-chip-remove[aria-label="移除 spell"]').click();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "spell" })).toHaveCount(0);
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(2);
});

test("add filter menu hides fields that already have a rule in the current view", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "features" }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toHaveCount(1);

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await expect(page.locator(".add-filter-popover-content")).toBeVisible();
  await expect(page.locator(".add-filter-field-option").filter({ hasText: "features" })).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toHaveCount(1);
});

test("select filter restores cached values after empty operators hide the value area", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();

  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("包含任一");
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("spell");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "为空", exact: true }).click();
  await expect(filterPopover.locator(".filter-option-value-area")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("为空");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "包含任一", exact: true }).click();
  await expect(filterPopover.locator(".filter-option-value-area")).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "spell" })).toBeVisible();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("spell");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);
});

test("value filter cache stays scoped per view and clears after delete and recreate", async ({ page }) => {
  const collectionKey = "data/e2e_select.json:$";

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());

  const sharedViews = await loadSharedViewsConfig(page);
  sharedViews.collections[collectionKey] = {
    defaultViewId: "all",
    views: [
      {
        id: "all",
        name: "全部",
        type: "table",
        query: "",
        filters: { op: "and", rules: [] },
        sorts: [],
        hidden: [],
        wrapped: [],
        order: [],
        detailOrder: [],
        widths: {},
      },
      {
        id: "second",
        name: "第二视图",
        type: "table",
        query: "",
        filters: { op: "and", rules: [] },
        sorts: [],
        hidden: [],
        wrapped: [],
        order: [],
        detailOrder: [],
        widths: {},
      },
    ],
  };
  await saveSharedViewsConfig(page, sharedViews);
  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  let filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "为空", exact: true }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("为空");

  await page.locator(".view-tab").filter({ hasText: "第二视图" }).click();
  await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText("第二视图");
  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("包含任一");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(3);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "为空", exact: true }).click();
  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "包含任一", exact: true }).click();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);

  await page.locator(".filter-action-trigger").click();
  await page.locator(".filter-action-menu .menu-item.danger").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toHaveCount(0);

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("包含任一");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(3);
});

test("value filters support does_not_contain and is_not_empty with real row results", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "不包含", exact: true }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("不包含");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(2);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "不为空", exact: true }).click();
  await expect(filterPopover.locator(".filter-option-value-area")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("不为空");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(2);
});

test("relation filter keeps missing selected keys visible with fallback labels", async ({ page }) => {
  const collectionKey = "data/e2e_relation.json:$";

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await ensurePrimaryKeySelection(page, "id");
  await configureRelation(page, "skill_id", {
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    mode: "single",
  });
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());

  const sharedViews = await loadSharedViewsConfig(page);
  if (!sharedViews.collections[collectionKey]) {
    sharedViews.collections[collectionKey] = {
      defaultViewId: "all",
      views: [{
        id: "all",
        name: "全部",
        type: "table",
        query: "",
        filters: { op: "and", rules: [] },
        sorts: [],
        hidden: [],
        wrapped: [],
        order: [],
        detailOrder: [],
        widths: {},
      }],
    };
  }
  const defaultViewId = sharedViews.collections[collectionKey]?.defaultViewId;
  const activeView = sharedViews.collections[collectionKey]?.views.find((view) => view.id === defaultViewId) ?? sharedViews.collections[collectionKey]?.views[0];
  expect(activeView).toBeTruthy();
  activeView!.filters = {
    op: "and",
    rules: [{ id: "filter:skill_id", field: "skill_id", operator: "contains", value: ["missing_skill"] }],
  };
  await saveSharedViewsConfig(page, sharedViews);

  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();
  const relationChip = page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "skill_id" });
  await expect(relationChip).toContainText("包含任一");
  await expect(relationChip).toContainText("missing_skill");
  await relationChip.click();

  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "missing_skill" })).toBeVisible();
  await filterPopover.locator(".filter-option-search-input").fill("missing_skill");
  const missingRow = filterPopover.locator(".filter-option-row").filter({ hasText: "missing_skill" });
  await expect(missingRow).toBeVisible();
  await expect(missingRow.locator("input[type='checkbox']")).toBeChecked();
});

test("relation filter search matches title first and key fallback", async ({ page }) => {
  const collectionKey = "data/e2e_relation.json:$";

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await ensurePrimaryKeySelection(page, "id");
  await configureRelation(page, "skill_id", {
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    mode: "single",
  });
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());

  const sharedViews = await loadSharedViewsConfig(page);
  sharedViews.collections[collectionKey] = {
    defaultViewId: "all",
    views: [{
      id: "all",
      name: "全部",
      type: "table",
      query: "",
      filters: { op: "and", rules: [] },
      sorts: [],
    }],
  };
  await saveSharedViewsConfig(page, sharedViews);

  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "skill_id" }).click();
  const filterPopover = page.locator(".filter-popover-content");
  const slashRow = filterPopover.locator(".filter-option-row").filter({ has: page.locator(".filter-option-label", { hasText: /^斩击$/ }) });
  await expect(filterPopover).toBeVisible();

  await filterPopover.locator(".filter-option-search-input").fill("斩击");
  await expect(slashRow).toBeVisible();
  await filterPopover.locator(".filter-option-search-input").fill("skill_slash");
  await expect(slashRow).toBeVisible();

  await slashRow.click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "skill_id" })).toContainText("斩击");
  await expect(page.locator(".data-table tbody tr[data-row-index]")).toHaveCount(1);
});

test("text filter popover keeps shared shell without scroll section", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.getByRole("button", { name: "+ 筛选" }).click();
  await expect(page.locator(".add-filter-popover-content")).toBeVisible();
  await page.locator(".add-filter-field-option").filter({ hasText: "id" }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "id" })).toBeVisible();
  await expect(page.locator(".filter-popover-shell")).toBeVisible();
  await expect(page.locator(".filter-popover-section").filter({ has: page.locator(".filter-text-input") })).toBeVisible();
  await expect(page.locator(".filter-popover-section-scroll")).toHaveCount(0);
  await expect(page.locator(".filter-option-list")).toHaveCount(0);
});

test("boolean filter popover keeps shared shell without scroll section", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/status_effects.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.getByRole("button", { name: "+ 筛选" }).click();
  await expect(page.locator(".add-filter-popover-content")).toBeVisible();
  await page.locator(".add-filter-field-option").filter({ hasText: "stackable" }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "stackable" })).toBeVisible();
  await expect(page.locator(".filter-popover-shell")).toBeVisible();
  await expect(page.locator(".filter-choice-list")).toBeVisible();
  await expect(page.locator(".filter-popover-section-scroll")).toHaveCount(0);
  await expect(page.locator(".filter-option-list")).toHaveCount(0);
});

test("view tabs and filter bar buttons suppress text caret affordance", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const activeViewTab = page.locator(".view-tab-shell.active .view-tab");
  const createViewButton = page.locator(".view-tab-create");
  const filterToggleButton = page.locator(".view-tabs-filter-toggle");
  const sortButton = page.locator(".view-filter-sort-button");
  const addFilterButton = page.getByRole("button", { name: "+ 筛选" });

  await expect(activeViewTab).toHaveCSS("user-select", "none");
  await expect(activeViewTab).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(createViewButton).toHaveCSS("user-select", "none");
  await expect(createViewButton).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(filterToggleButton).toHaveCSS("user-select", "none");
  await expect(filterToggleButton).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(sortButton).toHaveCSS("user-select", "none");
  await expect(sortButton).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(addFilterButton).toHaveCSS("user-select", "none");
  await expect(addFilterButton).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
});

test("clickable drag surfaces use pointer by default and grabbing while dragging", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const activeViewTab = page.locator(".view-tab-shell.active .view-tab");
  const sidebarFileItem = page.locator('.sidebar-file-item[title="data/e2e_multiselect.json"]');
  const columnTrigger = page.locator('.column-trigger[title="id"]');

  await expect(activeViewTab).toHaveCSS("cursor", "pointer");
  await expect(sidebarFileItem).toHaveCSS("cursor", "pointer");
  await expect(columnTrigger).toHaveCSS("cursor", "pointer");

  const activeViewBox = await activeViewTab.boundingBox();
  expect(activeViewBox).not.toBeNull();
  await page.mouse.move(activeViewBox!.x + activeViewBox!.width / 2, activeViewBox!.y + activeViewBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(activeViewBox!.x + activeViewBox!.width / 2 - 12, activeViewBox!.y + activeViewBox!.height / 2, { steps: 3 });
  await expect(page.locator(".view-tab-shell.dragging .view-tab")).toHaveCSS("cursor", "grabbing");
  await page.mouse.up();

  const sourceFile = page.locator('.sidebar-file-item[title="data/e2e_multiselect.json"]');
  const targetFile = page.locator('.sidebar-file-item[title="data/status_effects.json"]');
  const sourceFileBox = await sourceFile.boundingBox();
  const targetFileBox = await targetFile.boundingBox();
  expect(sourceFileBox).not.toBeNull();
  expect(targetFileBox).not.toBeNull();
  await page.mouse.move(sourceFileBox!.x + sourceFileBox!.width / 2, sourceFileBox!.y + sourceFileBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceFileBox!.x + sourceFileBox!.width / 2, sourceFileBox!.y + sourceFileBox!.height / 2 + 8, { steps: 3 });
  await expect(sourceFile).toHaveClass(/is-dragging/);
  await expect(sourceFile).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(targetFileBox!.x + targetFileBox!.width / 2, targetFileBox!.y + targetFileBox!.height * 0.25, { steps: 6 });
  await page.mouse.up();

  const sourceColumn = page.locator('.column-trigger[title="id"]');
  const targetColumn = page.locator('.column-trigger[title="name"]');
  const sourceColumnBox = await sourceColumn.boundingBox();
  const targetColumnBox = await targetColumn.boundingBox();
  expect(sourceColumnBox).not.toBeNull();
  expect(targetColumnBox).not.toBeNull();
  await page.mouse.move(sourceColumnBox!.x + sourceColumnBox!.width / 2, sourceColumnBox!.y + sourceColumnBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceColumnBox!.x + sourceColumnBox!.width / 2 - 18, sourceColumnBox!.y + sourceColumnBox!.height / 2, { steps: 4 });
  await expect(page.locator(".column-drag-ghost")).toBeVisible();
  await expect(sourceColumn).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(targetColumnBox!.x + targetColumnBox!.width * 0.25, targetColumnBox!.y + targetColumnBox!.height / 2, { steps: 8 });
  await page.mouse.up();
});

test("opens scratch JSON, edits, saves, and preserves root shape", async ({ page }) => {
  const realRunesBefore = await readFile(fixtureRunesPath, "utf8");

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.locator('.sidebar-item[title="data/e2e_mixed.json"]')).toContainText("e2e_mixed.json");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary .nested-entry-button")).toContainText("mixed");
  await page.locator(".detail-panel.primary .nested-entry-button").click();
  await expect(page.locator(".detail-panel.secondary.open")).toBeVisible();
  await expect(page.locator(".nested-item-list button")).toHaveCount(2);
  await page.locator(".nested-item-list button").nth(1).click();
  await page.locator(".detail-panel.secondary .detail-input").fill("e2e_nested");
  await expect(page.locator(".dirty-pill")).toBeVisible();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_mixed.json"), "utf8");
    return text.includes("e2e_nested");
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".multi-select-trigger").last().click();
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await expect(page.locator(".multi-select-popover .selected-chip")).toContainText("minion");
  await page.locator(".multi-select-option").filter({ hasText: "attack" }).click();
  await expect(page.locator(".multi-select-popover .selected-chip")).toContainText(["minion", "attack"]);
  await page.locator(".multi-select-input").fill("custom_tag");
  await page.locator(".multi-select-input").press("Enter");
  await expect(page.locator(".multi-select-popover .selected-chip")).toContainText(["custom_tag"]);
  await page.locator(".multi-select-popover .selected-chip").filter({ hasText: "minion" }).click();
  await page.locator(".multi-select-option-row").filter({ hasText: "attack" }).locator(".option-menu-trigger").click();
  await expect(page.locator(".multi-select-option-editor")).toBeVisible();
  await page.locator(".multi-select-option-name-input").fill("strike");
  await page.locator(".multi-select-option-name-input").press("Enter");
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "strike" })).toBeVisible();
  await page.locator(".multi-select-option-row").filter({ hasText: "strike" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-color-item").filter({ hasText: "红色" }).click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "strike" }).locator(".chip")).toHaveCSS("background-color", "rgb(255, 217, 214)");
  await page.locator(".multi-select-option-row").filter({ hasText: "spell" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-option-editor .multi-select-option-action.danger").click();
  await page.locator(".multi-select-popover").press("Escape");
  const featuresBlockAfterEdit = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "features" }),
  });
  await expect(featuresBlockAfterEdit.locator(".multi-select-trigger .chip")).toContainText(["strike", "custom_tag"]);
  await expect(featuresBlockAfterEdit.locator(".multi-select-trigger .chip").filter({ hasText: "strike" })).toBeVisible();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_multiselect.json"), "utf8");
    return text.includes('"strike"') && !text.includes('"attack"') && !text.includes('"spell"');
  }).toBe(true);
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"strike"') && text.includes('"red"') && !text.includes('"attack"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator('.column-trigger[title="category"]').click();
  await expect(page.locator('.column-menu-popup [data-field-type="Text"]')).toBeVisible();
  await expect(page.locator('.column-menu-popup [data-field-type="Select"]')).toBeVisible();
  await expect(page.locator('.column-menu-popup [data-field-type]')).toHaveCount(2);
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await expect(page.locator(".dirty-pill")).toBeVisible();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_select.json:$:category"') &&
      text.includes('"type": "Select"') &&
      text.includes('"attack"') &&
      text.includes('"spell"');
  }).toBe(true);
  await page.locator('.data-table tbody tr[data-row-index="0"] .multi-select-trigger').click();
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await page.locator(".multi-select-option").filter({ hasText: "spell" }).click();
  await expect(page.locator('.data-table tbody tr[data-row-index="0"] .multi-select-trigger')).toContainText("spell");
  await expect(page.locator('.data-table tbody tr[data-row-index="0"] .multi-select-trigger .chip')).toBeVisible();
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await page.locator(".multi-select-option-row").filter({ hasText: "attack" }).locator(".option-menu-trigger").click();
  await expect(page.locator(".multi-select-option-editor")).toBeVisible();
  await page.locator(".multi-select-option-name-input").fill("strike");
  await page.locator(".multi-select-option-name-input").press("Enter");
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "strike" })).toBeVisible();
  await page.locator(".multi-select-option-row").filter({ hasText: "strike" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-color-item").filter({ hasText: "蓝色" }).click();
  await page.locator(".multi-select-popover").press("Escape");
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_select.json"), "utf8");
    return text.includes('"category": "spell"');
  }).toBe(true);
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Text"]').click();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"type": "Text"') && text.includes('"strike"') && text.includes('"blue"') && text.includes('"spell"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".multi-select-trigger").last().click();
  await page.locator(".multi-select-option-row").filter({ hasText: "custom_tag" }).locator(".option-menu-trigger").click();
  const pinkItem = page.locator(".multi-select-color-item").filter({ hasText: "粉色" });
  const redItem = page.locator(".multi-select-color-item").filter({ hasText: "红色" });
  await expect(pinkItem.locator(".multi-select-color-swatch")).toHaveCSS("border-top-width", "0px");
  await expect(pinkItem.locator(".multi-select-color-swatch")).toHaveCSS("background-color", "rgb(247, 216, 238)");
  await expect(redItem.locator(".multi-select-color-swatch")).toHaveCSS("background-color", "rgb(255, 217, 214)");
  await pinkItem.click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "custom_tag" }).locator(".chip")).toHaveCSS("background-color", "rgb(247, 216, 238)");
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "custom_tag" }).locator(".chip")).toHaveCSS("color", "rgb(138, 63, 116)");
  await page.locator(".multi-select-popover").press("Escape");

  const collectionsSection = page.locator(".sidebar-section").filter({ hasText: "Collections" });
  const alphaCollection = collectionsSection.locator(".sidebar-item").filter({ hasText: "alpha" });
  const betaCollection = collectionsSection.locator(".sidebar-item").filter({ hasText: "beta" });
  await page.locator('.sidebar-item[title="data/e2e_primary_key_candidates.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_primary_key_candidates.json");
  await expect(alphaCollection).toBeVisible();
  await expect(collectionsSection.locator(".sidebar-status-dot")).toHaveCount(1);
  await expect(page.locator(".primary-key-candidate-banner")).toContainText("检测到多个候选主键");
  await page.locator(".primary-key-candidate-banner .ghost-button").click();
  await expect(page.locator(".primary-key-candidate-banner")).toHaveCount(0);
  await expect(collectionsSection.locator(".sidebar-status-dot")).toHaveCount(1);
  await betaCollection.click();
  await expect(page.locator(".primary-key-candidate-banner")).toHaveCount(0);
  await alphaCollection.click();
  await expect(page.locator(".primary-key-candidate-banner")).toContainText("检测到多个候选主键");
  await page.locator(".primary-key-candidate-banner .primary-button").click();
  await expect(page.locator(".primary-key-candidate-dialog")).toBeVisible();
  await expect(page.locator(".primary-key-candidate-summary__row")).toHaveCount(2);
  await expect(page.locator(".primary-key-candidate-summary__row").first()).toContainText("alpha_id");
  await expect(page.locator(".primary-key-candidate-summary__row").nth(1)).toContainText("id");
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return !text.includes('"data/e2e_primary_key_candidates.json:alpha"');
  }).toBe(true);
  await page.locator(".primary-key-candidate-dialog .primary-button").click();
  await expect(page.locator(".primary-key-candidate-dialog")).toHaveCount(0);
  await expect(page.locator(".primary-key-candidate-banner")).toHaveCount(0);
  await expect(collectionsSection.locator(".sidebar-status-dot")).toHaveCount(0);
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_primary_key_candidates.json:alpha"') &&
      text.includes('"alpha_id"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await ensurePrimaryKeySelection(page, "id");
  const relationDataBeforeConfig = await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8");
  await configureRelation(page, "skill_id", {
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    mode: "single",
  });
  await configureRelation(page, "keywords", {
    targetFile: "data/keywords.json",
    targetCollection: "$",
    targetKey: "keyword_id",
    mode: "multi",
  });
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_relation.json:$:skill_id"') &&
      text.includes('"data/e2e_relation.json:$:keywords"') &&
      text.includes('"mode": "multi"') &&
      text.includes('"data/skills.json:skills:back_skill_id"') &&
      text.includes('"data/keywords.json:$:back_keywords"');
  }).toBe(true);
  expect(await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8")).toBe(relationDataBeforeConfig);
  await expect(page.locator(".data-table tbody tr[data-row-index='1'] .issue.warning")).toHaveCount(2);
  await page.locator(".data-table tbody tr[data-row-index='0'] .relation-trigger").first().click();
  await expect(page.locator(".relation-popover")).toBeVisible();
  await page.locator(".relation-option").filter({ hasText: "skill_heavy_slash" }).click();
  await page.locator(".relation-popover").press("Escape");
  await page.locator(".data-table tbody tr[data-row-index='0'] .relation-trigger").nth(1).click();
  await expect(page.locator(".relation-popover")).toBeVisible();
  await page.locator(".relation-option").filter({ hasText: "专注" }).click();
  await page.locator(".relation-popover").press("Escape");
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8");
    return text.includes('"skill_id": "skill_heavy_slash"') && text.includes('"focus"');
  }).toBe(true);
  const relationDataAfterEdit = await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8");
  await page.locator(".data-table tbody tr[data-row-index='0'] .relation-trigger").first().click();
  await expect(page.locator(".relation-popover")).toBeVisible();
  await page.locator(".relation-option").filter({ hasText: "skill_heavy_slash" }).locator(".relation-open-target").evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1 }));
  });
  await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await expect(page.locator(".relation-maintenance-panel")).toContainText("被引用");
  await expect(page.locator(".relation-maintenance-panel")).toContainText("Relation Row");
  await expect(page.locator(".relation-maintenance-panel")).toContainText("skill_id");
  await page.locator(".relation-backlink-item").filter({ hasText: "Relation Row" }).click();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_relation.json");
  await page.locator('.column-trigger[title="skill_id"]').click();
  await page.locator('.column-menu-popup [data-relation-action="clear"]').click();
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return !text.includes('"data/e2e_relation.json:$:skill_id"') &&
      text.includes('"data/e2e_relation.json:$:keywords"') &&
      !text.includes('"data/skills.json:skills:back_skill_id"') &&
      text.includes('"data/keywords.json:$:back_keywords"');
  }).toBe(true);
  expect(await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8")).toBe(relationDataAfterEdit);

  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  await expect(page.locator('.column-trigger[title="back_keyword_id"]')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("data-editor:data/keywords.json:$:all:back_keyword_id:wrapped", "1");
    localStorage.setItem("data-editor:data/keywords.json:$:all:back_keyword_id:width", "120");
  });
  await page.reload();
  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  const wrappedBacklinkCell = page.locator('td[data-column-field="back_keyword_id"][data-wrap-mode="wrap"] [data-cell-role="token-content"]').first();
  await expect(wrappedBacklinkCell).toBeVisible();
  const keywordBacklinkChip = page.locator('.data-table tbody .backlink-chip-button[title*="data/status_effects.json"]').first();
  await expect(keywordBacklinkChip).toBeVisible();
  await expect(keywordBacklinkChip).toHaveCSS("background-color", "rgb(233, 232, 229)");
  const backlinkWrapResult = await wrappedBacklinkCell.evaluate((element) => {
    const chip = element.querySelector(".backlink-chip-button") as HTMLElement | null;
    return {
      clientHeight: (element as HTMLElement).clientHeight,
      scrollHeight: (element as HTMLElement).scrollHeight,
      chipWhiteSpace: chip ? getComputedStyle(chip).whiteSpace : null,
    };
  });
  expect(backlinkWrapResult.chipWhiteSpace).toBe("normal");
  expect(backlinkWrapResult.scrollHeight).toBeLessThanOrEqual(backlinkWrapResult.clientHeight);
  await keywordBacklinkChip.click();
  await expect(page.locator(".toolbar strong")).toContainText("data/status_effects.json");
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  await page.locator('.sidebar-item[title="data/e2e_primary_key_sync_target.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_primary_key_sync_target.json");
  await expect(page.locator(".primary-key-candidate-banner")).toBeVisible();
  await page.locator(".primary-key-candidate-banner .primary-button").click();
  await expect(page.locator(".primary-key-candidate-dialog")).toBeVisible();
  await page.locator(".primary-key-candidate-dialog .primary-button").click();
  await expect(page.locator(".primary-key-candidate-dialog")).toHaveCount(0);
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_primary_key_sync_target.json:$"') &&
      text.includes('"target_id"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_primary_key_sync_source.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_primary_key_sync_source.json");
  await configureRelation(page, "target_id", {
    targetFile: "data/e2e_primary_key_sync_target.json",
    targetCollection: "$",
    targetKey: "target_id",
    mode: "single",
  });
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_primary_key_sync_source.json:$:target_id"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_primary_key_sync_target.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  const targetIdInput = page.locator(".detail-panel.primary .property-block").filter({ hasText: "target_id" }).locator(".detail-input").first();
  await targetIdInput.fill("focus_sync");
  await expect(page.locator(".relation-maintenance-panel")).toContainText("保存并同步引用");
  await page.locator(".relation-maintenance-panel .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".primary-key-sync-dialog")).toBeVisible();
  await expect(page.locator(".primary-key-sync-dialog")).toContainText("Sync Source");
  await page.locator(".primary-key-sync-dialog .primary-button").click();
  await expect(page.locator(".primary-key-sync-dialog")).toHaveCount(0);
  await expect.poll(async () => {
    const targetText = await readFile(path.resolve("tests/.scratch/data/e2e_primary_key_sync_target.json"), "utf8");
    const sourceText = await readFile(path.resolve("tests/.scratch/data/e2e_primary_key_sync_source.json"), "utf8");
    return targetText.includes('"target_id": "focus_sync"') &&
      sourceText.includes('"target_id": "focus_sync"') &&
      !sourceText.includes('"target_id": "focus"');
  }).toBe(true);

  await expect(page.locator('.sidebar-item[title="data/runes.json"]')).toContainText("runes.json");
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.getByRole("button", { name: "$" })).toBeVisible();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.evaluate(() => localStorage.setItem("data-editor:data/runes.json:$:all:description:hidden", "1"));
  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator('col[data-column-field="description"]')).toHaveCount(0);
  await page.locator(".toolbar-hidden-fields .ghost-button").click();
  await expect(page.locator(".hidden-fields-panel")).toBeVisible();
  await expect(page.locator(".hidden-field-item")).toContainText("description");
  await page.locator(".hidden-field-item").click();
  await expect(page.locator('col[data-column-field="description"]')).toHaveCount(1);

  await page.locator('.column-trigger[title="description"]').click();
  await expect(page.locator(".menu-content")).toBeVisible();
  await page.locator(".menu-content").press("Escape");
  await expect(page.locator(".menu-content")).toHaveCount(0);

  const headerOrderBeforeDrag = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderBeforeDrag.slice(0, 3)).toEqual(["rune_name", "description", "description_zh"]);
  await dragColumnHeader(page, "description_zh", "rune_name");
  await expect(page.locator(".menu-content")).toHaveCount(0);
  const headerOrderAfterDrag = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderAfterDrag.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/runes.json:$:all:__order"))).toContain("description_zh,rune_name,description");
  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/runes.json");
  await expect(page.locator('.column-trigger[title="description_zh"]')).toBeVisible();
  const headerOrderAfterReload = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderAfterReload.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);

  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
  await scrollColumnHeaderNearEdge(page, "icon_path", "right");
  await dragColumnHeader(page, "icon_path", "dev_status");
  const headerOrderAfterIconDrag = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderAfterIconDrag.indexOf("icon_path")).toBeGreaterThanOrEqual(0);
  expect(headerOrderAfterIconDrag.indexOf("dev_status")).toBeGreaterThanOrEqual(0);
  expect(headerOrderAfterIconDrag.indexOf("icon_path")).toBeLessThan(headerOrderAfterIconDrag.indexOf("dev_status"));
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/skills.json:skills:all:__order"))).toContain("icon_path");
  await page.reload();
  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await expect(page.locator('.column-trigger[title="icon_path"]')).toBeVisible();
  const headerOrderAfterSkillsReload = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderAfterSkillsReload.indexOf("icon_path")).toBeLessThan(headerOrderAfterSkillsReload.indexOf("dev_status"));

  await page.evaluate(() => localStorage.setItem(
    "data-editor:data/skills.json:skills:all:__order",
    "dev_status,skill_name,ap_cost,description,class_pool,complexity,cooldown,description_zh,id,mana_cost,owner,range_type_show,range_value_show,skill_category,skill_id,skill_type,tags,spell_subtype,minion_subtype,form_duration,enemy_behavior_actions,enemy_intent_type,enemy_ai_tags,enemy_interaction_windows,enemy_bonus_answer_tags,enemy_skill_role,control_protection_tags,nodes,icon_path,equipment_requirement,on_expire_effect,replaced_skills,enemy_budget_score,back_skills,back_phase_skills",
  ));
  await page.reload();
  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
  await scrollColumnHeaderNearEdge(page, "icon_path", "right");
  await page.locator('.column-trigger[title="icon_path"]').click();
  await expect(page.locator(".column-menu-popup")).toBeVisible();
  await page.locator('.column-menu-popup [data-column-action="move-right"]').click();
  const headerOrderAfterIconRightDrag = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderAfterIconRightDrag.indexOf("icon_path")).toBeGreaterThan(headerOrderAfterIconRightDrag.indexOf("equipment_requirement"));
  expect(headerOrderAfterIconRightDrag.indexOf("icon_path")).toBeLessThan(headerOrderAfterIconRightDrag.indexOf("on_expire_effect"));
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/skills.json:skills:all:__order"))).toContain("on_expire_effect");
  await page.reload();
  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await scrollColumnHeaderNearEdge(page, "icon_path", "right");
  const headerOrderAfterIconRightReload = await page.locator(".column-trigger").evaluateAll((items) => items.map((item) => item.getAttribute("title")).filter(Boolean));
  expect(headerOrderAfterIconRightReload.indexOf("icon_path")).toBeGreaterThan(headerOrderAfterIconRightReload.indexOf("equipment_requirement"));
  expect(headerOrderAfterIconRightReload.indexOf("icon_path")).toBeLessThan(headerOrderAfterIconRightReload.indexOf("on_expire_effect"));

  const sidebarLabels = await page.locator(".sidebar-section").first().locator(".sidebar-item span").evaluateAll((items) => items.slice(0, 3).map((item) => item.textContent));
  expect(sidebarLabels.every((label) => label && !label.includes("data/"))).toBe(true);

  const sidebarBefore = await page.locator(".sidebar").boundingBox();
  const sidebarHandle = await page.locator(".sidebar-resize-handle").boundingBox();
  await page.mouse.move(sidebarHandle!.x + sidebarHandle!.width / 2, sidebarHandle!.y + sidebarHandle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sidebarHandle!.x + sidebarHandle!.width / 2 + 80, sidebarHandle!.y + sidebarHandle!.height / 2, { steps: 8 });
  await page.mouse.up();
  const sidebarAfter = await page.locator(".sidebar").boundingBox();
  expect(sidebarAfter!.width).toBeGreaterThan(sidebarBefore!.width + 50);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:sidebar-width"))).toBe(String(Math.round(sidebarAfter!.width)));

  await expect.poll(async () => page.evaluate(() => {
    const table = document.querySelector(".table-scroll") as HTMLElement;
    return table.scrollHeight > table.clientHeight;
  })).toBe(true);
  const scrollMetrics = await page.evaluate(() => {
    const table = document.querySelector(".table-scroll") as HTMLElement;
    table.scrollTop = 700;
    table.scrollLeft = 500;
    return {
      canScrollDown: table.scrollTop > 0,
      canScrollRight: table.scrollLeft > 0,
      constrainedHeight: table.clientHeight < table.scrollHeight,
    };
  });
  expect(scrollMetrics).toEqual({ canScrollDown: true, canScrollRight: true, constrainedHeight: true });

  const resizeResult = await page.evaluate(async () => {
    const table = document.querySelector(".table-scroll") as HTMLElement;
    table.scrollTop = 0;
    table.scrollLeft = 0;
    (window as typeof window & { __mutationCount?: number; __observer?: MutationObserver }).__mutationCount = 0;
    (window as typeof window & { __observer?: MutationObserver }).__observer = new MutationObserver(() => {
      (window as typeof window & { __mutationCount?: number }).__mutationCount! += 1;
    });
    (window as typeof window & { __observer?: MutationObserver }).__observer!.observe(table, { childList: true, subtree: true, attributes: true });
    const header = document.querySelectorAll("th")[1] as HTMLTableCellElement;
    const handle = header.querySelector(".column-resize-handle") as HTMLElement;
    const column = document.querySelectorAll("col[data-column-field]")[0] as HTMLTableColElement;
    const beforeWidth = column.style.width;
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: rect.x + 95, clientY: rect.y + 5, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: rect.x + 95, clientY: rect.y + 5, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return {
      beforeWidth,
      afterWidth: column.style.width,
      bodyClass: document.body.className,
      resizeGuide: document.body.style.getPropertyValue("--column-resize-guide-x"),
      mutationCount: (window as typeof window & { __mutationCount?: number }).__mutationCount ?? 0,
    };
  });
  expect(resizeResult.afterWidth).not.toBe(resizeResult.beforeWidth);
  expect(resizeResult.bodyClass).toBe("");
  expect(resizeResult.resizeGuide).toBe("");
  expect(resizeResult.mutationCount).toBeLessThan(30);

  const nowrapDescriptionBox = await page.evaluate(() => {
    const handle = document.querySelector(".column-resize-handle[aria-label=\"Resize description column\"]") as HTMLElement;
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.evaluate((point) => {
    const handle = document.querySelector('.column-resize-handle[aria-label="Resize description column"]') as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x - 220,
      clientY: point.y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x - 220,
      clientY: point.y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }));
  }, {
    x: nowrapDescriptionBox.x + nowrapDescriptionBox.width / 2,
    y: nowrapDescriptionBox.y + nowrapDescriptionBox.height / 2,
  });
  await page.waitForTimeout(300);
  const nowrapDescriptionResult = await page.evaluate(() => {
    const col = document.querySelector("col[data-column-field=\"description\"]") as HTMLTableColElement;
    const colIndex = [...document.querySelectorAll("col")].findIndex((item) => (item as HTMLTableColElement).dataset.columnField === "description");
    const td = document.querySelector(`tbody tr[data-row-index] td:nth-child(${colIndex + 1})`) as HTMLTableCellElement;
    const span = td.querySelector(".cell-display span") as HTMLElement;
    return {
      colWidth: col.getBoundingClientRect().width,
      tdWidth: td.getBoundingClientRect().width,
      whiteSpace: getComputedStyle(span).whiteSpace,
    };
  });
  expect(nowrapDescriptionResult.colWidth).toBeLessThanOrEqual(60);
  expect(nowrapDescriptionResult.tdWidth).toBeLessThanOrEqual(60);
  expect(nowrapDescriptionResult.whiteSpace).toBe("nowrap");

  const descriptionHeaderLayout = await page.locator(".column-trigger[title=\"description\"]").evaluate((element) => {
    const name = element.querySelector("span")!.getBoundingClientRect();
    const type = element.querySelector("small")!.getBoundingClientRect();
    return { nameBottom: name.bottom, typeTop: type.top };
  });
  expect(descriptionHeaderLayout.typeTop).toBeGreaterThanOrEqual(descriptionHeaderLayout.nameBottom - 1);

  await page.evaluate(() => {
    localStorage.setItem("data-editor:data/e2e_wrap_rows.json:$:all:description:wrapped", "1");
    localStorage.setItem("data-editor:data/e2e_wrap_rows.json:$:all:description:width", "180");
  });
  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_wrap_rows.json"]').click();
  await page.waitForSelector('td[data-column-field="description"][data-wrap-mode="wrap"] [data-cell-role="content"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".column-resize-handle[aria-label=\"Resize description column\"]")].some((element) => {
    const rect = element.getBoundingClientRect();
    return element.isConnected && rect.width > 0 && rect.height > 0;
  }));
  const descriptionResizeBox = await page.evaluate(() => {
    const handle = [...document.querySelectorAll(".column-resize-handle[aria-label=\"Resize description column\"]")].find((element) => {
      const rect = element.getBoundingClientRect();
      return element.isConnected && rect.width > 0 && rect.height > 0;
    })!;
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const descriptionWidthBefore = await page.evaluate(() => (document.querySelector("col[data-column-field=\"description\"]") as HTMLTableColElement).style.width);
  await page.evaluate((point) => {
    const handle = document.querySelector('.column-resize-handle[aria-label="Resize description column"]') as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x - 120,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x - 120,
      clientY: point.y,
      pointerId: 1,
    }));
  }, {
    x: descriptionResizeBox.x + descriptionResizeBox.width / 2,
    y: descriptionResizeBox.y + descriptionResizeBox.height / 2,
  });
  const wrapResult = await page.evaluate(() => {
    const td = document.querySelector('td[data-column-field="description"][data-wrap-mode="wrap"]') as HTMLTableCellElement;
    const content = document.querySelector('td[data-column-field="description"][data-wrap-mode="wrap"] [data-cell-role="content"]') as HTMLElement;
    const span = document.querySelector('td[data-column-field="description"][data-wrap-mode="wrap"] [data-cell-role="content"] span') as HTMLElement;
    const titleSpan = document.querySelector('td[data-cell-kind="data"][data-wrap-mode="wrap"] [data-cell-role="title-text"]') as HTMLElement;
    const heights = [...document.querySelectorAll("tbody tr[data-row-index]")].map((row) => (row as HTMLTableRowElement).getBoundingClientRect().height);
    return {
      contentClientHeight: content?.clientHeight ?? null,
      contentScrollHeight: content?.scrollHeight ?? null,
      tdVerticalAlign: td ? getComputedStyle(td).verticalAlign : null,
      width: (document.querySelector("col[data-column-field=\"description\"]") as HTMLTableColElement).style.width,
      whiteSpace: span ? getComputedStyle(span).whiteSpace : null,
      titleWhiteSpace: titleSpan ? getComputedStyle(titleSpan).whiteSpace : null,
      heights,
    };
  });
  expect(wrapResult.tdVerticalAlign).toBe("top");
  expect(wrapResult.whiteSpace).toBe("normal");
  expect(["normal", null]).toContain(wrapResult.titleWhiteSpace);
  expect(wrapResult.contentScrollHeight).toBeLessThanOrEqual(wrapResult.contentClientHeight);
  expect(wrapResult.width).not.toBe(descriptionWidthBefore);
  expect(Math.max(...wrapResult.heights)).toBeGreaterThan(Math.min(...wrapResult.heights));

  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await expect(page.locator(".detail-panel.primary .nested-entry-button")).toContainText("effects");
  await expect(page.locator(".detail-panel.primary .json-editor textarea")).toHaveCount(0);
  await page.locator(".detail-panel.primary .nested-entry-button").click();
  await expect(page.locator(".detail-panel.secondary.open")).toBeVisible();
  await expect(page.locator(".nested-item-list button")).toHaveCount(2);
  await page.locator(".nested-item-list button").first().click();
  await expect(page.locator(".detail-panel.secondary .property-block")).toHaveCount(4);
  await expect(page.locator(".detail-panel.secondary")).toContainText("category");
  await expect(page.locator(".detail-panel.secondary")).toContainText("effect_type");
  await expect(page.locator(".detail-panel.secondary")).toContainText("params");
  await expect(page.locator(".detail-panel.secondary")).toContainText("timing");

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.evaluate(async () => {
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "e2e_detail_profile",
        profile: {
          sidebarWidth: null,
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "e2e_detail_profile");
  });
  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const detailOrderBefore = await page.locator(".detail-panel.primary .detail-property-item .property-heading span:first-child").evaluateAll(
    (items) => items.slice(0, 4).map((item) => item.textContent?.trim()).filter(Boolean),
  );
  expect(detailOrderBefore.length).toBeGreaterThanOrEqual(3);
  const draggedField = detailOrderBefore[2]!;
  const targetField = detailOrderBefore[0]!;
  const draggedHandle = await page.locator(`.detail-panel.primary .detail-property-handle[aria-label="Reorder ${draggedField}"]`).boundingBox();
  const targetHandle = await page.locator(`.detail-panel.primary .detail-property-handle[aria-label="Reorder ${targetField}"]`).boundingBox();
  const detailPanelBox = await page.locator(".detail-panel.primary").boundingBox();
  const dragStart = { x: draggedHandle!.x + draggedHandle!.width / 2, y: draggedHandle!.y + draggedHandle!.height / 2 };
  const dragMid = { x: dragStart.x, y: dragStart.y - 40 };
  const dragEnd = { x: targetHandle!.x + targetHandle!.width / 2, y: detailPanelBox!.y + 96 };
  await page.locator(`.detail-panel.primary .detail-property-handle[aria-label="Reorder ${draggedField}"]`).evaluate((element, point) => {
    element.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }));
  }, dragStart);
  await page.evaluate((point) => {
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }));
  }, dragMid);
  await page.evaluate((point) => {
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }));
  }, dragEnd);
  await page.evaluate((point) => {
    window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x,
      clientY: point.y,
    }));
  }, dragEnd);
  await expect.poll(async () => {
    const labels = await page.locator(".detail-panel.primary .detail-property-item .property-heading span:first-child").evaluateAll(
      (items) => items.slice(0, 4).map((item) => item.textContent?.trim()).filter(Boolean),
    );
    return labels.indexOf(draggedField);
  }).toBeLessThan(detailOrderBefore.indexOf(draggedField));
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/e2e_detail_profile.json"), "utf8");
    return text.includes("\"detailOrder\"") && text.includes(`\"${draggedField}\"`);
  }).toBe(true);

  await page.locator(".data-table tbody tr[data-row-index]").nth(0).locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  const firstDetailTitle = await page.locator(".detail-panel.primary .panel-title").textContent();
  await expect(page.locator(".detail-panel.primary .property-block").filter({ hasText: "description" }).locator("textarea.detail-textarea").first()).toBeVisible();
  await expect(page.locator(".detail-panel.primary .property-block").filter({ hasText: "rune_id" }).locator(".relation-trigger")).toHaveCount(0);
  await page.locator(".data-table tbody tr[data-row-index]").nth(1).evaluate((element) => (element as HTMLTableRowElement).click());
  const secondDetailTitle = await page.locator(".detail-panel.primary .panel-title").textContent();
  expect(secondDetailTitle).not.toBe(firstDetailTitle);

  await page.locator('.sidebar-item[title="data/status_effects.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await expect(page.locator('col[data-column-field="control"]')).toHaveCount(1);
  await page.locator('.data-table tbody tr[data-row-index="20"]').locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const controlBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "control" }),
  });
  await expect(controlBlock.locator(".nested-entry-button")).toBeVisible();
  await expect(controlBlock.locator(".nested-list")).toHaveCount(0);
  await controlBlock.locator(".nested-entry-button").click();
  await expect(page.locator(".detail-panel.secondary.open")).toBeVisible();
  await expect(page.locator(".detail-panel.secondary")).toContainText("debuff_family");
  await expect(page.locator(".detail-panel.secondary")).toContainText("control_kind");
  const buildupResizeBox = await page.evaluate(() => {
    const handle = [...document.querySelectorAll(".column-resize-handle[aria-label=\"Resize buildup column\"]")].find((element) => {
      const rect = element.getBoundingClientRect();
      return element.isConnected && rect.width > 0 && rect.height > 0;
    }) as HTMLElement;
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const nestedWidthBefore = await page.evaluate(() => (document.querySelector("col[data-column-field=\"buildup\"]") as HTMLTableColElement).style.width);
  await page.evaluate((point) => {
    const handle = document.querySelector('.column-resize-handle[aria-label="Resize buildup column"]') as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x + 80,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x + 80,
      clientY: point.y,
      pointerId: 1,
    }));
  }, {
    x: buildupResizeBox.x + buildupResizeBox.width / 2,
    y: buildupResizeBox.y + buildupResizeBox.height / 2,
  });
  await expect.poll(async () => page.evaluate(() => (document.querySelector("col[data-column-field=\"buildup\"]") as HTMLTableColElement).style.width)).not.toBe(nestedWidthBefore);
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/e2e_detail_profile.json"), "utf8");
    return text.includes("data/status_effects.json:$") && text.includes("\"buildup\"");
  }).toBe(true);
  await page.reload();
  await page.locator('.sidebar-item[title="data/status_effects.json"]').click();
  await expect(page.locator('col[data-column-field="buildup"]')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => (document.querySelector("col[data-column-field=\"buildup\"]") as HTMLTableColElement).style.width)).not.toBe("180px");

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await expect(page.locator(".toolbar strong")).toContainText("data/runes.json");

  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await page.locator(".detail-input").first().evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "e2e_edit_value";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/runes.json"), "utf8");
    return text.includes("e2e_edit_value");
  }).toBe(true);

  const scratchRunes = JSON.parse(await readFile(path.resolve("tests/.scratch/data/runes.json"), "utf8"));
  expect(Array.isArray(scratchRunes)).toBe(true);

  await page.reload();
  await expect(page.locator('.sidebar-item[title="data/runes.json"]')).toContainText("runes.json");

  const realRunesAfter = await readFile(fixtureRunesPath, "utf8");
  expect(realRunesAfter).toBe(realRunesBefore);
});

test("select column dragged to the first position keeps select rendering when title falls back to first field", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_select_title_fallback.json");
  const rows = [
    { id: "row_1", status: "review" },
    { id: "row_2", status: "parked" },
    { id: "row_3", status: "" },
  ];
  await writeFile(dataPath, JSON.stringify(rows, null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_select_title_fallback.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await page.locator('.column-trigger[title="status"]').click();
    await expect(page.locator('.column-menu-popup [data-field-type="Select"]')).toBeVisible();
    await page.locator('.column-menu-popup [data-field-type="Select"]').click();
    await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());

    await expect(page.locator('.data-table tbody tr[data-row-index="0"] .multi-select-trigger')).toContainText("review");
    await expect(page.locator('.data-table tbody tr[data-row-index="0"] .multi-select-trigger .chip')).toBeVisible();

    await dragColumnHeader(page, "status", "id");

    await expect(page.locator(".column-trigger").first()).toHaveAttribute("title", "status");
    const firstDataCell = page.locator('.data-table tbody tr[data-row-index="0"] td[data-column-field="status"]');
    await expect(firstDataCell.locator(".multi-select-trigger")).toContainText("review");
    await expect(firstDataCell.locator(".multi-select-trigger .chip")).toBeVisible();
    await expect(firstDataCell.locator('[data-cell-role="title"]')).toHaveCount(0);
  } finally {
    await bestEffortRestore("e2e_select_title_fallback.json", () => rm(dataPath, { force: true }));
  }
});

test("file list order can be dragged and persists after reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();
  await expect(page.locator('.sidebar-file-item[title="data/status_effects.json"]')).toBeVisible();

  await dragSidebarFile(page, "data/status_effects.json", "data/runes.json", "before");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:__file-order"))).toContain("data/status_effects.json,data/runes.json");

  let fileOrderAfterDrag = await getSidebarFileOrder(page);
  expect(fileOrderAfterDrag.indexOf("data/status_effects.json")).toBeLessThan(fileOrderAfterDrag.indexOf("data/runes.json"));

  await page.reload();
  await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();
  fileOrderAfterDrag = await getSidebarFileOrder(page);
  expect(fileOrderAfterDrag.indexOf("data/status_effects.json")).toBeLessThan(fileOrderAfterDrag.indexOf("data/runes.json"));
});

test("detail panel width can be resized and property spacing stays compact", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const spacingBeforeDrag = await page.evaluate(() => {
    const propertyList = document.querySelector(".detail-panel.primary .property-list") as HTMLElement | null;
    const propertyBlock = document.querySelector(".detail-panel.primary .property-block") as HTMLElement | null;
    if (!propertyList || !propertyBlock) return null;
    const listStyle = getComputedStyle(propertyList);
    const blockStyle = getComputedStyle(propertyBlock);
    return {
      listGap: listStyle.rowGap,
      blockGap: blockStyle.rowGap,
    };
  });
  expect(spacingBeforeDrag).toEqual({
    listGap: "8px",
    blockGap: "4px",
  });

  const panelBefore = await page.locator(".detail-panel.primary").boundingBox();
  const handleBefore = await page.locator(".detail-panel-resize-handle").boundingBox();
  expect(panelBefore).not.toBeNull();
  expect(handleBefore).not.toBeNull();
  await page.evaluate((point) => {
    const handle = document.querySelector(".detail-panel-resize-handle") as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x - 120,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x - 120,
      clientY: point.y,
      pointerId: 1,
    }));
  }, {
    x: handleBefore!.x + handleBefore!.width / 2,
    y: handleBefore!.y + handleBefore!.height / 2,
  });

  const panelAfter = await page.locator(".detail-panel.primary").boundingBox();
  expect(panelAfter).not.toBeNull();
  expect(panelAfter!.width).toBeGreaterThan(panelBefore!.width + 80);
});

test("detail panel width persists in selected profile after reload", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "detail_panel_width_profile",
        profile: {
          sidebarWidth: null,
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "detail_panel_width_profile");
  });

  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const handleBefore = await page.locator(".detail-panel-resize-handle").boundingBox();
  expect(handleBefore).not.toBeNull();
  await page.evaluate((point) => {
    const handle = document.querySelector(".detail-panel-resize-handle") as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: point.x - 120,
      clientY: point.y,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: point.x - 120,
      clientY: point.y,
      pointerId: 1,
    }));
  }, {
    x: handleBefore!.x + handleBefore!.width / 2,
    y: handleBefore!.y + handleBefore!.height / 2,
  });

  const widthAfterResize = await page.locator(".detail-panel.primary").evaluate((element) => Math.round(element.getBoundingClientRect().width));
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/detail_panel_width_profile.json"), "utf8");
    const profile = JSON.parse(text);
    return profile.detailPanelWidth ?? null;
  }).toBe(widthAfterResize);

  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await expect.poll(async () => page.locator(".detail-panel.primary").evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(widthAfterResize);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:detail-panel-width"))).toBe(null);
});

test("clicking outside detail panels closes primary and nested detail panels", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary.open")).toBeVisible();
  await page.locator(".detail-panel.primary .nested-entry-button").click();
  await expect(page.locator(".detail-panel.secondary.open")).toBeVisible();
  await page.locator(".nested-item-list button").first().click();
  await expect(page.locator(".detail-panel.secondary .property-block")).toHaveCount(4);

  await page.locator(".toolbar strong").click();
  await expect(page.locator(".detail-panel.primary.open")).toHaveCount(0);
  await expect(page.locator(".detail-panel.secondary.open")).toHaveCount(0);
});

test("detail panel reuses table select and multi-select editors", async ({ page }) => {
  await page.goto("/");

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const featuresBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "features" }),
  });
  await expect(featuresBlock.locator(".multi-select-trigger")).toBeVisible();
  await expect(featuresBlock.locator(".multi-select-trigger")).toHaveAttribute("data-cell-role", "detail-trigger");
  await expect(featuresBlock.locator(".multi-select-trigger")).toHaveAttribute("data-wrap-mode", "truncate");
  await expect(featuresBlock.locator(".nested-entry-button")).toHaveCount(0);
  await featuresBlock.locator(".multi-select-trigger").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await expect(page.locator(".multi-select-popover .selected-chip")).toHaveCount(1);
  await page.locator(".multi-select-popover").press("Escape");

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const categoryBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "category" }),
  });
  await expect(categoryBlock.locator(".multi-select-trigger")).toBeVisible();
  await expect(categoryBlock.locator(".multi-select-trigger")).toHaveAttribute("data-cell-role", "detail-trigger");
  await expect(categoryBlock.locator(".multi-select-trigger")).toHaveAttribute("data-wrap-mode", "truncate");
  await expect(categoryBlock.locator(".multi-select-trigger .chip")).toContainText("attack");
  await categoryBlock.locator(".multi-select-trigger").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await expect(page.locator(".multi-select-popover .selected-chip")).toHaveCount(1);
});

test("option field editor popover uses shared shell and scroll section from table cell", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  const devTagsColumnIndex = await page.evaluate(() => {
    return [...document.querySelectorAll("th[data-column-field]")].findIndex((header) => header.getAttribute("data-column-field") === "dev_tags");
  });
  expect(devTagsColumnIndex).toBeGreaterThanOrEqual(0);
  await page.locator(".data-table tbody tr[data-row-index]").first().locator("td").nth(devTagsColumnIndex + 1).locator(".multi-select-trigger").click();

  const popover = page.locator(".multi-select-popover.option-field-popover-shell");
  const selectedSection = popover.locator(".option-field-popover-section").first();
  const scrollSection = popover.locator(".option-field-popover-section-scroll");
  await expect(popover).toBeVisible();
  await expect(selectedSection).toBeVisible();
  await expect(selectedSection.locator(".multi-select-input")).toBeVisible();
  await expect(scrollSection).toBeVisible();
  const scrollMetrics = await scrollSection.evaluate((node) => {
    const element = node as HTMLDivElement;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  await expect(page.locator('.data-table tbody tr[data-row-index="0"] td[data-column-field="dev_tags"] .multi-select-trigger')).toHaveAttribute("data-wrap-mode", "truncate");
});

test("detail panel option field editors reuse the shared popover shell", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const featuresBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "features" }),
  });
  await expect(featuresBlock.locator(".multi-select-trigger")).toHaveAttribute("data-cell-role", "detail-trigger");
  await expect(featuresBlock.locator(".multi-select-trigger")).not.toHaveClass(/cell-token-flow/);
  await featuresBlock.locator(".multi-select-trigger").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();
  await expect(page.locator(".multi-select-popover .option-field-popover-section-scroll")).toBeVisible();
  await page.locator(".multi-select-popover").press("Escape");

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const categoryBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "category" }),
  });
  await expect(categoryBlock.locator(".multi-select-trigger")).toHaveAttribute("data-cell-role", "detail-trigger");
  await expect(categoryBlock.locator(".multi-select-trigger")).not.toHaveClass(/cell-token-flow/);
  await categoryBlock.locator(".multi-select-trigger").evaluate((element) => (element as HTMLButtonElement).click());
  const selectPopover = page.locator(".multi-select-popover.option-field-popover-shell");
  await expect(selectPopover).toBeVisible();
  await expect(selectPopover.locator(".option-field-popover-section")).toHaveCount(2);
  await expect(selectPopover.locator(".option-field-popover-section-scroll")).toBeVisible();
});

test("relation popover still opens and selects target after option field shell migration", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await ensurePrimaryKeySelection(page, "id");

  await configureRelation(page, "skill_id", {
    targetFile: "data/skills.json",
    targetCollection: "skills",
    targetKey: "skill_id",
    mode: "single",
  });

  const relationTrigger = page.locator(".data-table tbody tr[data-row-index='0'] .relation-trigger").first();
  const initialRelationText = ((await relationTrigger.textContent()) ?? "").trim();
  await relationTrigger.click();
  const relationPopover = page.locator(".relation-popover");
  await expect(relationPopover).toBeVisible();
  await expect(relationPopover.locator(".option-field-popover-shell")).toHaveCount(0);
  await relationPopover.locator(".relation-option").filter({ hasText: "skill_heavy_slash" }).click();
  await relationPopover.press("Escape");
  await expect(relationTrigger).not.toHaveText(initialRelationText);
});

test("option field editor keeps create rename color and delete actions", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  await page.locator(".multi-select-input").fill("phase2_tag");
  await page.locator(".multi-select-input").press("Enter");
  await expect(page.locator(".multi-select-popover .selected-chip").filter({ hasText: "phase2_tag" })).toBeVisible();

  const attackRow = page.locator(".multi-select-option-row").filter({ hasText: "attack" });
  await attackRow.locator(".option-menu-trigger").click();
  await expect(page.locator(".multi-select-option-editor")).toBeVisible();
  await page.locator(".multi-select-option-name-input").fill("phase2_attack");
  await page.locator(".multi-select-option-name-input").press("Enter");
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" })).toBeVisible();

  await page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-color-item").filter({ hasText: "蓝色" }).click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" }).locator(".chip")).toHaveCSS("background-color", "rgb(219, 234, 254)");

  await page.locator(".multi-select-option-row").filter({ hasText: "phase2_tag" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-option-editor .multi-select-option-action.danger").click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_tag" })).toHaveCount(0);
  await expect(page.locator(".multi-select-popover .selected-chip").filter({ hasText: "phase2_tag" })).toHaveCount(0);
});

test("option field editor drag reorder updates visible chip order and persists after save", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const secondRowTrigger = page.locator(".data-table tbody tr[data-row-index='1'] .multi-select-trigger");
  await secondRowTrigger.click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  const rowChipTextsBeforePreview = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsBeforePreview.length).toBeGreaterThan(1);
  const targetValue = rowChipTextsBeforePreview[0]!;
  const sourceValue = rowChipTextsBeforePreview[1]!;
  const optionTextsBeforeSweep = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  const farTargetValue = optionTextsBeforeSweep.find((value) => value && value !== sourceValue && value !== targetValue && optionTextsBeforeSweep.indexOf(value) >= 4) ?? targetValue;

  await beginOptionHandleDrag(page, sourceValue);
  await movePointerOverOptionRow(page, targetValue);
  const optionTexts = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTexts.indexOf(sourceValue)).toBeLessThan(optionTexts.indexOf(targetValue));

  const selectedTextsInPopover = await page.locator(".multi-select-popover .selected-chip span:first-child").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(selectedTextsInPopover.indexOf(sourceValue)).toBeLessThan(selectedTextsInPopover.indexOf(targetValue));

  await movePointerOverOptionRow(page, farTargetValue);
  await movePointerOverOptionRow(page, targetValue);
  const optionTextsAfterRepeatedMove = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsAfterRepeatedMove.indexOf(sourceValue)).toBeLessThan(optionTextsAfterRepeatedMove.indexOf(targetValue));

  const saveButton = page.locator(".toolbar .primary-button");
  await expect(saveButton).toBeDisabled();

  await endOptionHandleDrag(page, sourceValue, targetValue);
  await page.locator(".multi-select-popover").press("Escape");

  const rowChipTexts = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTexts.indexOf(sourceValue)).toBeLessThan(rowChipTexts.indexOf(targetValue));

  await expect(saveButton).toBeEnabled();
  await saveButton.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(saveButton).toBeDisabled();
  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const rowChipTextsAfterReload = await page.locator(".data-table tbody tr[data-row-index='1'] .multi-select-trigger .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsAfterReload.indexOf(sourceValue)).toBeLessThan(rowChipTextsAfterReload.indexOf(targetValue));
});

test("profile file order controls initial open and ignores stale local file order", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem("data-editor:__file-order", "data/runes.json,data/status_effects.json");
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_order_profile",
        profile: {
          sidebarWidth: null,
          fileOrder: ["data/status_effects.json", "data/runes.json"],
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "file_order_profile");
  });

  await page.reload();
  await expect(page.locator('.sidebar-file-item[title="data/status_effects.json"]')).toBeVisible();
  const profileFileOrder = await getSidebarFileOrder(page);
  expect(profileFileOrder.indexOf("data/status_effects.json")).toBeLessThan(profileFileOrder.indexOf("data/runes.json"));
  await expect(page.locator(".toolbar strong")).toContainText("data/status_effects.json");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:__file-order"))).toBe("data/runes.json,data/status_effects.json");
});

test("profile file order drag persists to profile JSON", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_order_drag_profile",
        profile: {
          sidebarWidth: null,
          fileOrder: [],
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "file_order_drag_profile");
  });

  await page.reload();
  await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();
  await dragSidebarFile(page, "data/status_effects.json", "data/runes.json", "before");

  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/file_order_drag_profile.json"), "utf8");
    const profile = JSON.parse(text);
    return profile.fileOrder?.join(",");
  }).toContain("data/status_effects.json,data/runes.json");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:__file-order"))).toBe(null);
});

test("add field dialog type select is clickable", async ({ page }) => {
  await page.goto("/");
  await page.locator('button[title="Add field"]').click();
  await expect(page.locator(".dialog-content")).toBeVisible();
  const trigger = page.locator(".dialog-content .select-trigger");
  await expect(trigger).toContainText("Text");
  await trigger.click();
  await expect(page.locator(".select-content")).toBeVisible();
  await page.locator('[role="option"]').filter({ hasText: "Select" }).click();
  await expect(trigger).toContainText("Select");
});

test("toolbar view profile picker uses the custom select surface", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator(".toolbar-profile-picker .select-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("浏览器本地");
  await trigger.click();
  await expect(page.locator(".select-content").filter({ has: page.getByRole("option", { name: "浏览器本地", exact: true }) })).toBeVisible();
  await expect(page.getByRole("option", { name: "浏览器本地", exact: true })).toBeVisible();
});

test("select chip grows with column width", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_select_long.json"]').click();
  await page.locator('.column-trigger[title="category"]').click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  const chip = page.locator('.data-table tbody tr[data-row-index="0"] .chip').first();
  await expect(chip).toBeVisible();
  const widthBefore = await chip.evaluate((element) => element.getBoundingClientRect().width);
  await page.evaluate(() => {
    const handle = document.querySelector('.column-resize-handle[aria-label="Resize category column"]') as HTMLElement;
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: rect.left + rect.width / 2 + 180, clientY: rect.top + rect.height / 2 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: rect.left + rect.width / 2 + 180, clientY: rect.top + rect.height / 2 }));
  });
  await expect.poll(async () => chip.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(widthBefore + 40);
});

test("switching from profile to local flushes pending profile changes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "flush_profile",
        profile: { sidebarWidth: null, collections: {} },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "flush_profile");
  });

  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await page.waitForFunction(() => {
    const handle = document.querySelector('.column-resize-handle[aria-label="Resize description column"]') as HTMLElement | null;
    if (!handle) return false;
    const rect = handle.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  await page.evaluate(() => {
    const handle = document.querySelector('.column-resize-handle[aria-label="Resize description column"]') as HTMLElement;
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: rect.x + rect.width / 2 + 80,
      clientY: rect.y + rect.height / 2,
      pointerId: 1,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: rect.x + rect.width / 2 + 80,
      clientY: rect.y + rect.height / 2,
      pointerId: 1,
    }));
  });
  await page.locator(".toolbar-profile-picker .select-trigger").click();
  await page.getByRole("option", { name: "浏览器本地", exact: true }).click();

  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/flush_profile.json"), "utf8");
    return text.includes("\"description\"");
  }).toBe(true);
});

test("profile mode ignores stale localStorage view state", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem("data-editor:data/runes.json:$:all:description:hidden", "1");
    localStorage.setItem("data-editor:data/runes.json:$:all:description:width", "380");
    localStorage.setItem("data-editor:data/runes.json:$:all:__order", "description,rune_name");
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "clean_profile",
        profile: {
          sidebarWidth: 260,
          lastActiveViews: {
            "data/runes.json:$": "all",
          },
          viewLayouts: {
            "data/runes.json:$": {
              all: {
                hidden: [],
                wrapped: [],
                order: ["rune_name", "description"],
                detailOrder: [],
                widths: { description: 180 },
              },
            },
          },
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "clean_profile");
  });

  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator('col[data-column-field="description"]')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => {
    const col = document.querySelector('col[data-column-field="description"]') as HTMLTableColElement | null;
    return col?.style.width ?? "";
  })).toBe("180px");
});

test("profile reset clears current collection without localStorage resurrection", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem("data-editor:data/runes.json:$:all:description:hidden", "1");
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "reset_profile",
        profile: {
          sidebarWidth: 300,
          lastActiveViews: {
            "data/runes.json:$": "all",
          },
          viewLayouts: {
            "data/runes.json:$": {
              all: {
                hidden: ["description"],
                wrapped: ["description"],
                order: ["description", "rune_name"],
                detailOrder: ["description"],
                widths: { description: 280 },
              },
            },
          },
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "reset_profile");
  });

  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator('col[data-column-field="description"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator('col[data-column-field="description"]')).toHaveCount(1);
});

test("toolbar renders settings, refresh, and close buttons after save", async ({ page }) => {
  await page.goto("/");
  const saveButton = page.locator(".toolbar .primary-button").filter({ hasText: "保存" });
  const settingsButton = page.locator(".toolbar .toolbar-settings-button");
  const refreshButton = page.locator(".toolbar .toolbar-rebuild-button");
  const closeButton = page.locator(".toolbar .toolbar-close-button");

  await expect(saveButton).toBeVisible();
  await expect(settingsButton).toBeVisible();
  await expect(refreshButton).toBeVisible();
  await expect(closeButton).toBeVisible();
  await expect(refreshButton).not.toContainText("刷新构建");
  await expect(closeButton).not.toContainText("关闭");

  const orderIsCorrect = await page.locator(".toolbar").evaluate(() => {
    const save = [...document.querySelectorAll(".toolbar button")]
      .find((element) => element.classList.contains("primary-button") && element.textContent?.includes("保存"));
    const settings = document.querySelector(".toolbar-settings-button");
    const refresh = document.querySelector(".toolbar-rebuild-button");
    const close = document.querySelector(".toolbar-close-button");
    return save?.nextElementSibling === settings && settings?.nextElementSibling === refresh && refresh?.nextElementSibling === close;
  });
  expect(orderIsCorrect).toBe(true);
});

test("toolbar appearance settings toggles theme and base font size independently", async ({ page }) => {
  await page.goto("/");
  const settingsButton = page.locator(".toolbar .toolbar-settings-button");
  await settingsButton.click();

  const popover = page.locator(".appearance-popover-content");
  await expect(popover).toBeVisible();
  await expect(page.locator('[data-theme-option="light"]')).toBeVisible();
  await expect(page.locator('[data-theme-option="dark"]')).toBeVisible();
  await expect(page.locator('[data-font-size-option="14"]')).toBeVisible();
  await expect(page.locator('[data-font-size-option="14.5"]')).toBeVisible();
  await expect(page.locator('[data-font-size-option="16"]')).toBeVisible();

  await page.locator('[data-theme-option="dark"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  await page.locator('[data-font-size-option="16"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSizeBase)).toBe("16");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
  await expect(page.locator('[data-theme-option="dark"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-font-size-option="16"]')).toHaveAttribute("aria-pressed", "true");
});

test("toolbar appearance settings persist in localStorage when no profile is selected", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();

  await page.locator(".toolbar .toolbar-settings-button").click();
  await page.locator('[data-theme-option="dark"]').click();
  await page.locator('[data-font-size-option="14.5"]').click();

  await expect.poll(() => page.evaluate(() => localStorage.getItem("data-editor:ui-theme"))).toBe("dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("data-editor:ui-font-size"))).toBe("14.5");

  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSizeBase)).toBe("14.5");
});

test("toolbar appearance settings persist to selected profile", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "appearance_profile",
        profile: {
          sidebarWidth: null,
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "appearance_profile");
  });

  await page.reload();
  await page.locator(".toolbar .toolbar-settings-button").click();
  await page.locator('[data-theme-option="dark"]').click();
  await page.locator('[data-font-size-option="14.5"]').click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fontSizeBase)).toBe("14.5");
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/appearance_profile.json"), "utf8");
    const profile = JSON.parse(text);
    return JSON.stringify(profile.appearance ?? null);
  }).toBe(JSON.stringify({
    activeThemeId: "dark",
    baseFontSize: 14.5,
  }));
});

test("legacy selected profile without viewLayouts still allows switching shared view tabs", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("data-editor:selected-view-profile", "legacy_profile");
  });
  await page.route("**/api/view-profiles?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(["legacy_profile"]),
    });
  });
  await page.route("**/api/shared-views?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        collections: {
          "data/keywords.json:$": {
            defaultViewId: "all",
            views: [
              {
                id: "all",
                name: "全部",
                type: "table",
                query: "",
                filters: { op: "and", rules: [] },
                sorts: [],
                hidden: [],
                wrapped: [],
                order: [],
                detailOrder: [],
                widths: {},
              },
              {
                id: "build",
                name: "构筑",
                type: "table",
                query: "",
                filters: { op: "and", rules: [] },
                sorts: [],
                hidden: [],
                wrapped: [],
                order: [],
                detailOrder: [],
                widths: {},
              },
            ],
          },
        },
      }),
    });
  });
  await page.route("**/api/view-profile?name=legacy_profile*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sidebarWidth: null,
        detailPanelWidth: null,
        fileOrder: ["data/keywords.json", "data/equipment_bases.json"],
        lastActiveViews: {
          "data/keywords.json:$": "all",
        },
        viewDrafts: {},
        viewOrderDrafts: {},
        collections: {
          "data/keywords.json:$": {
            hidden: [],
            wrapped: [],
            order: ["id"],
            detailOrder: [],
            widths: { id: 120 },
          },
        },
      }),
    });
  });

  await page.goto("/");
  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  await page.locator(".view-tab").filter({ hasText: "构筑" }).click();
  await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText("构筑");
  await page.locator(".view-tab").filter({ hasText: "全部" }).click();
  await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText("全部");
});

test("close button switches to server closed page", async ({ page }) => {
  await page.route("**/api/shutdown", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.goto("/");
  const closeButton = page.locator(".toolbar .toolbar-close-button");
  const saveButton = page.locator(".toolbar .primary-button").filter({ hasText: "保存" });

  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(closeButton).toBeDisabled();
  await expect(closeButton).toContainText("关闭中...");
  await expect(saveButton).toBeDisabled();

  await expect(page.getByRole("heading", { name: "服务已关闭" })).toBeVisible();
  await expect(page.locator(".server-closed-state")).toContainText("需要重新打开才能继续");
  await expect(page.locator(".workspace")).toHaveCount(0);
});

test("close button asks for confirmation when unsaved changes would be lost", async ({ page }) => {
  let shutdownCalls = 0;
  await page.route("**/api/shutdown", async (route) => {
    shutdownCalls += 1;
    await route.fulfill({
      status: 204,
      body: "",
    });
  });

  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(".detail-panel.primary .detail-input").first().fill("Dirty name");
  await expect(page.locator(".dirty-pill")).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".toolbar .toolbar-close-button").click();

  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".server-closed-state")).toHaveCount(0);
  expect(shutdownCalls).toBe(0);
});

test("single transient network failure does not trigger recovery", async ({ page }) => {
  let healthCalls = 0;
  let bridgeHealthCalls = 0;
  let reopenCalls = 0;

  await page.route("**/api/health", async (route) => {
    healthCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, bridgePort: 8791 }),
    });
  });
  await page.route("http://127.0.0.1:8791/health", async (route) => {
    bridgeHealthCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("http://127.0.0.1:8791/reopen", async (route) => {
    reopenCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "reopened" }),
    });
  });
  await page.route("**/api/save", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(".detail-panel.primary .detail-input").first().fill("Dirty name");
  await expect(page.locator(".dirty-pill")).toBeVisible();
  await page.locator(".toolbar .primary-button").evaluate((element) => (element as HTMLButtonElement).click());

  await page.waitForTimeout(1000);
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".service-state--recovering")).toHaveCount(0);
  await expect(page.locator(".service-state--recovered-pending-reload")).toHaveCount(0);
  await expect(page.locator(".service-state--bridge-unavailable")).toHaveCount(0);
  expect(healthCalls).toBeGreaterThanOrEqual(2);
  expect(bridgeHealthCalls).toBe(0);
  expect(reopenCalls).toBe(0);
});

test("consecutive health failures trigger recovery and reload when there are no unsaved changes", async ({ page }) => {
  let healthCalls = 0;
  let bridgeHealthCalls = 0;
  let reopenCalls = 0;
  let recovered = false;

  await page.addInitScript(() => {
    const key = "__data_editor_recovery_reload_count";
    const current = Number(sessionStorage.getItem(key) ?? "0");
    sessionStorage.setItem(key, String(current + 1));
  });

  await page.route("**/api/health", async (route) => {
    healthCalls += 1;
    if (healthCalls === 1 || recovered) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, bridgePort: 8791 }),
      });
      return;
    }
    await route.abort("failed");
  });
  await page.route("http://127.0.0.1:8791/health", async (route) => {
    bridgeHealthCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("http://127.0.0.1:8791/reopen", async (route) => {
    reopenCalls += 1;
    recovered = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "reopened" }),
    });
  });

  await page.goto("/");
  await dispatchRecoverableFailure(page);

  await page.waitForFunction(() => Number(sessionStorage.getItem("__data_editor_recovery_reload_count")) >= 2);
  await expect(page.locator(".workspace")).toBeVisible();
  expect(healthCalls).toBeGreaterThanOrEqual(4);
  expect(bridgeHealthCalls).toBeGreaterThan(0);
  expect(reopenCalls).toBe(1);
});

test("unexpected disconnect waits for manual reload after recovery when unsaved changes exist", async ({ page }) => {
  let healthCalls = 0;
  let reopenCalls = 0;

  await page.route("**/api/health", async (route) => {
    healthCalls += 1;
    if (healthCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, bridgePort: 8791 }),
      });
      return;
    }
    await route.abort("failed");
  });
  await page.route("http://127.0.0.1:8791/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("http://127.0.0.1:8791/reopen", async (route) => {
    reopenCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "reopened" }),
    });
  });

  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(".detail-panel.primary .detail-input").first().fill("Dirty name");
  await expect(page.locator(".dirty-pill")).toBeVisible();

  await dispatchRecoverableFailure(page);

  await expect(page.locator(".service-state--recovered-pending-reload")).toBeVisible();
  await expect(page.locator(".service-state--recovered-pending-reload .primary-button")).toBeVisible();
  expect(reopenCalls).toBe(1);
});

test("bridge unavailable shows a reopen fallback page", async ({ page }) => {
  let healthCalls = 0;

  await page.route("**/api/health", async (route) => {
    healthCalls += 1;
    if (healthCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, bridgePort: 8791 }),
      });
      return;
    }
    await route.abort("failed");
  });
  await page.route("http://127.0.0.1:8791/health", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/");
  await dispatchRecoverableFailure(page);

  await expect(page.locator(".service-state--bridge-unavailable")).toBeVisible();
  await expect(page.locator(".service-state--bridge-unavailable .ghost-button")).toBeVisible();
});

test("toolbar renders refresh build button to the left of close", async ({ page }) => {
  await page.goto("/");
  const refreshButton = page.locator(".toolbar .toolbar-rebuild-button");
  const closeButton = page.locator(".toolbar .toolbar-close-button");

  await expect(refreshButton).toBeVisible();
  await expect(refreshButton).not.toContainText("刷新构建");
  await expect(closeButton).toBeVisible();

  const isLeftOfClose = await page.locator(".toolbar").evaluate(() => {
    const refresh = document.querySelector(".toolbar-rebuild-button");
    const close = document.querySelector(".toolbar-close-button");
    return refresh?.nextElementSibling === close;
  });
  expect(isLeftOfClose).toBe(true);
});

test("refresh build reloads the page after a successful rebuild request", async ({ page }) => {
  let rebuildCalls = 0;
  await page.addInitScript(() => {
    const key = "__data_editor_reload_count";
    const current = Number(sessionStorage.getItem(key) ?? "0");
    sessionStorage.setItem(key, String(current + 1));
  });
  await page.route("**/api/rebuild", async (route) => {
    rebuildCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");
  const refreshButton = page.locator(".toolbar .toolbar-rebuild-button");
  await refreshButton.click();
  await expect(refreshButton).toBeDisabled();
  await expect(refreshButton).toContainText("构建中...");
  await page.waitForFunction(() => Number(sessionStorage.getItem("__data_editor_reload_count")) >= 2);
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".status-text")).toContainText("构建成功，页面已刷新");
  expect(rebuildCalls).toBe(1);
});

test("refresh build shows backend errors and stays on the editor page", async ({ page }) => {
  await page.route("**/api/rebuild", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "synthetic build failure" }),
    });
  });

  await page.goto("/");
  const refreshButton = page.locator(".toolbar .toolbar-rebuild-button");
  await refreshButton.click();

  await expect(page.locator(".status-text")).toContainText("synthetic build failure");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".server-closed-state")).toHaveCount(0);
});

test("refresh build network failures do not trigger recovery", async ({ page }) => {
  let healthCalls = 0;
  let bridgeHealthCalls = 0;
  let reopenCalls = 0;

  await page.route("**/api/health", async (route) => {
    healthCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, bridgePort: 8791 }),
    });
  });
  await page.route("http://127.0.0.1:8791/health", async (route) => {
    bridgeHealthCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("http://127.0.0.1:8791/reopen", async (route) => {
    reopenCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "reopened" }),
    });
  });
  await page.route("**/api/rebuild", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/");
  const refreshButton = page.locator(".toolbar .toolbar-rebuild-button");
  await refreshButton.click();

  await page.waitForTimeout(1000);
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".server-closed-state")).toHaveCount(0);
  expect(healthCalls).toBeGreaterThanOrEqual(1);
  expect(bridgeHealthCalls).toBe(0);
  expect(reopenCalls).toBe(0);
});

test("refresh build asks for confirmation when unsaved changes would be lost", async ({ page }) => {
  let rebuildCalls = 0;
  await page.route("**/api/rebuild", async (route) => {
    rebuildCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await page.locator(".data-table tbody tr[data-row-index]").first().locator(".title-open-button").evaluate((element) => (element as HTMLButtonElement).click());
  await page.locator(".detail-panel.primary .detail-input").first().fill("Dirty name");
  await expect(page.locator(".dirty-pill")).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".toolbar .toolbar-rebuild-button").click();

  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".status-text")).toHaveCount(0);
  expect(rebuildCalls).toBe(0);
});

test("project settings opens from the empty workspace state", async ({ page }) => {
  const registry = {
    version: 1,
    activeProjectId: "empty-project",
    projects: [{
      id: "empty-project",
      name: "Empty Project",
      root: "C:\\Code\\EmptyProject",
      adapter: "nocturnel",
      dataSources: [{ id: "data", label: "Data", kind: "relative", path: "data" }],
    }],
  };
  const viewConfig = {
    fields: {},
    primaryKeys: {},
    backlinks: {},
    relations: {},
    relationsVersion: 1,
  };
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(registry) });
  });
  await page.route("**/api/files?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/view-config?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(viewConfig) });
  });
  await page.route("**/api/view-profiles?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto("/");
  await expect(page.locator(".project-switcher-trigger")).toContainText("Empty Project");
  await page.locator(".project-switcher-trigger").click();
  await expect(page.locator(".project-switcher-menu")).toBeVisible();
  await expect(page.locator(".project-switcher-menu-label")).toHaveText("浏览器本地");
  await expect(page.getByRole("menuitemradio", { name: "Empty Project" })).toHaveAttribute("aria-checked", "true");
  await page.locator(".project-switcher-trigger").click();
  await expect(page.locator(".project-switcher-menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Project settings" }).click();
  await expect(page.getByRole("dialog", { name: "Project Settings" })).toBeVisible();
  await expect(page.locator(".project-settings-dialog textarea")).toContainText("data|Data|relative|data");
});
