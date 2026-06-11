import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  await columnHeaderTrigger(page, fieldName).click();
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

function columnHeaderCell(page: Page, fieldName: string) {
  return page.locator(`th[data-column-field="${fieldName}"]`).first();
}

function columnHeaderTrigger(page: Page, fieldName: string) {
  return columnHeaderCell(page, fieldName).locator(`button[aria-label="${fieldName}"]`).first();
}

function columnHeaderTooltip(page: Page) {
  return page.locator(".column-header-full-title-tooltip");
}

async function getColumnHeaderOrder(page: Page) {
  return page.locator("th[data-column-field]").evaluateAll((items) => (
    items.map((item) => item.getAttribute("data-column-field")).filter((field): field is string => Boolean(field))
  ));
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
    const header = document.querySelector(`th[data-column-field="${currentField}"]`) as HTMLElement | null;
    if (!table || !header) return;
    const tableRect = table.getBoundingClientRect();
    const handleRect = header.getBoundingClientRect();
    const targetX = currentEdge === "right" ? tableRect.right - 72 : tableRect.left + 72;
    table.scrollLeft += Math.round(handleRect.left + handleRect.width / 2 - targetX);
  }, { currentField: fieldName, currentEdge: edge });
  await page.waitForTimeout(50);
}

async function dragColumnHeader(page: Page, sourceField: string, targetField: string) {
  await beginColumnHeaderDrag(page, sourceField);
  await expect(page.locator(".column-drag-ghost")).toBeVisible();
  await moveColumnHeaderDrag(page, targetField);
  await page.mouse.up();
}

async function beginColumnHeaderDrag(page: Page, sourceField: string) {
  const sourceLocator = columnHeaderTrigger(page, sourceField);
  let dragSource = await sourceLocator.boundingBox();
  if (!dragSource) {
    await sourceLocator.scrollIntoViewIfNeeded();
    dragSource = await sourceLocator.boundingBox();
  }
  expect(dragSource).not.toBeNull();
  await page.mouse.move(dragSource!.x + dragSource!.width / 2, dragSource!.y + dragSource!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragSource!.x + dragSource!.width / 2 - 18, dragSource!.y + dragSource!.height / 2, { steps: 4 });
}

async function moveColumnHeaderDrag(page: Page, targetField: string) {
  const targetLocator = columnHeaderTrigger(page, targetField);
  let dragTarget = await targetLocator.boundingBox();
  if (!dragTarget) {
    await targetLocator.scrollIntoViewIfNeeded();
    dragTarget = await targetLocator.boundingBox();
  }
  expect(dragTarget).not.toBeNull();
  await page.mouse.move(dragTarget!.x + dragTarget!.width * 0.25, dragTarget!.y + dragTarget!.height / 2, { steps: 10 });
}

async function cancelColumnHeaderDrag(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  });
}

async function resizeColumnHeader(page: Page, fieldName: string, deltaX: number) {
  const handle = page.locator(`.column-resize-handle[aria-label="Resize ${fieldName} column"]`);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + deltaX, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();
}

async function dragOptionHandle(page: Page, sourceRowText: string, targetRowText: string) {
  await beginOptionHandleDrag(page, sourceRowText);
  await movePointerOverOptionRow(page, targetRowText);
  await endOptionHandleDrag(page, sourceRowText, targetRowText);
}

async function dragSortRuleHandle(page: Page, sourceIndex: number, targetIndex: number) {
  await beginSortRuleHandleDrag(page, sourceIndex);
  await movePointerOverSortRule(page, targetIndex);
  await endSortRuleHandleDrag(page, targetIndex);
}

async function beginSortRuleHandleDrag(page: Page, sourceIndex: number) {
  const handle = page.locator(".sort-rule-row").nth(sourceIndex).locator(".sort-rule-drag-handle");
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 8, { steps: 3 });
}

async function movePointerOverSortRule(page: Page, targetIndex: number) {
  const row = page.locator(".sort-rule-row").nth(targetIndex);
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.15, { steps: 10 });
}

async function endSortRuleHandleDrag(page: Page, targetIndex: number) {
  const row = page.locator(".sort-rule-row").nth(targetIndex);
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.15, { steps: 2 });
  await page.mouse.up();
}

async function cancelSortRuleHandleDrag(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  });
}

async function releaseSortRuleHandleDragOverFieldTrigger(page: Page, targetIndex: number) {
  const trigger = page.locator(".sort-rule-row").nth(targetIndex).locator(".sort-field-trigger");
  const box = await trigger.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 4 });
  await page.mouse.up();
}

async function getVisibleTableIds(page: Page) {
  return page.locator(".data-table tbody tr").evaluateAll((rows) => (
    rows.map((row) => row.children.item(2)?.textContent?.trim() ?? "").filter(Boolean)
  ));
}

function tableRows(page: Page) {
  return page.locator('.data-table tbody tr[data-row-id]');
}

function tableRow(page: Page, index: number) {
  return tableRows(page).nth(index);
}

function tableCell(page: Page, rowIndex: number, fieldName: string) {
  return tableRow(page, rowIndex).locator(`td[data-column-field="${fieldName}"]`).first();
}

async function clickCellWhitespace(page: Page, rowIndex: number, fieldName: string, xRatio = 0.92, yRatio = 0.82) {
  const box = await tableCell(page, rowIndex, fieldName).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * xRatio, box!.y + box!.height * yRatio);
}

async function getSortRuleFields(page: Page) {
  return page.locator(".sort-rule-row .sort-field-trigger").evaluateAll((items) => (
    items.map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? "")
  ));
}

async function beginOptionHandleDrag(page: Page, sourceRowText: string) {
  await page.evaluate((sourceText) => {
    const sourceHandle = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(sourceText))
      ?.querySelector(".option-drag-handle");
    if (!(sourceHandle instanceof HTMLElement)) return;
    const rect = sourceHandle.getBoundingClientRect();
    const shared = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    sourceHandle.dispatchEvent(new PointerEvent("pointerdown", {
      ...shared,
      button: 0,
      buttons: 1,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
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

async function endOptionHandleDrag(page: Page, _sourceRowText: string, targetRowText: string) {
  await page.evaluate(({ targetText }) => {
    const targetRow = [...document.querySelectorAll(".multi-select-option-row")]
      .find((row) => row.textContent?.includes(targetText));
    if (!(targetRow instanceof HTMLElement)) return;
    const shared = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const pointerUp = new PointerEvent("pointerup", { ...shared, button: 0, buttons: 0 });
    targetRow.dispatchEvent(pointerUp);
    window.dispatchEvent(pointerUp);
  }, { targetText: targetRowText });
}

async function cancelOptionHandleDrag(page: Page, _sourceRowText: string) {
  await page.evaluate(() => {
    const shared = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const pointerCancel = new PointerEvent("pointercancel", { ...shared, button: 0, buttons: 0 });
    window.dispatchEvent(pointerCancel);
  });
}

async function closePopoverByClickingOutside(page: Page) {
  await page.mouse.click(24, 24);
}

async function waitForAutosaveIdle(page: Page) {
  const dirtyPill = page.locator(".dirty-pill");
  await expect.poll(async () => {
    if (await dirtyPill.count() === 0) return "idle";
    return ((await dirtyPill.first().textContent()) ?? "").replace(/\s+/g, "");
  }, {
    message: "waiting for autosave dirty pill to clear",
    timeout: 15_000,
  }).toBe("idle");
}

async function waitForAutosaveWrite(page: Page, predicate: () => Promise<boolean>) {
  await waitForAutosaveIdle(page);
  await expect.poll(predicate, {
    message: "waiting for autosave write to reach disk",
    timeout: 15_000,
  }).toBe(true);
}

async function waitForProjectConfigWrite(page: Page, predicate: (text: string) => boolean) {
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return predicate(text);
  });
}

async function getSidebarFileOrder(page: Page) {
  return page.locator(".sidebar-section").first().locator(".sidebar-file-item").evaluateAll((items) => (
    items.map((item) => item.getAttribute("title")).filter((title): title is string => Boolean(title))
  ));
}

async function getSidebarTreeVisibleRowSnapshot(page: Page) {
  return sidebarTreeSection(page)
    .locator(".sidebar-tree-row")
    .evaluateAll((items) => items.map((item) => {
      const element = item as HTMLElement;
      return {
        kind: element.dataset.sidebarNodeKind ?? "",
        label: element.querySelector('[data-sidebar-slot="label"]')?.textContent?.trim() ?? "",
        title: element.getAttribute("title") ?? "",
      };
    }));
}

async function getSidebarTreeRowSlots(page: Page, kind: "source" | "folder" | "file", label: string) {
  return sidebarTreeNode(page, kind, label).evaluate((element) => {
    const slots = [...element.querySelectorAll("[data-sidebar-slot]")].map((slot) => {
      const html = slot as HTMLElement;
      return {
        name: html.dataset.sidebarSlot ?? "",
        className: html.className,
        text: html.textContent?.trim() ?? "",
      };
    });
    return {
      slots,
      slotNames: slots.map((slot) => slot.name),
    };
  });
}

async function getSidebarTreeSlotBox(page: Page, kind: "source" | "folder" | "file", label: string, slotName: string) {
  const box = await sidebarTreeNode(page, kind, label).locator(`[data-sidebar-slot="${slotName}"]`).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function sidebarTreeSection(page: Page) {
  return page.locator(".sidebar-section").first();
}

function sidebarTreeNode(page: Page, kind: "source" | "folder" | "file", label: string) {
  return sidebarTreeSection(page)
    .locator(`.sidebar-item[data-sidebar-node-kind="${kind}"]`)
    .filter({ has: page.locator('[data-sidebar-slot="label"]', { hasText: label }) })
    .first();
}

async function toggleSidebarTreeNode(page: Page, kind: "source" | "folder", label: string) {
  await sidebarTreeNode(page, kind, label).click();
}

function sidebarTreeLabel(page: Page, kind: "source" | "folder" | "file", label: string) {
  return sidebarTreeNode(page, kind, label).locator('[data-sidebar-slot="label"]').first();
}

async function getSidebarTreeLabelStart(page: Page, kind: "source" | "folder" | "file", label: string) {
  const box = await sidebarTreeLabel(page, kind, label).boundingBox();
  expect(box).not.toBeNull();
  return Math.round(box!.x);
}

async function expectSidebarTreeLabelStartsAligned(page: Page, entries: Array<{ kind: "source" | "folder" | "file"; label: string }>, tolerance = 1) {
  const starts = await Promise.all(entries.map((entry) => getSidebarTreeLabelStart(page, entry.kind, entry.label)));
  const baseline = starts[0] ?? 0;
  for (const start of starts) {
    expect(Math.abs(start - baseline)).toBeLessThanOrEqual(tolerance);
  }
}

async function beginSidebarFileDrag(page: Page, sourcePath: string) {
  const sourceLocator = page.locator(`.sidebar-file-item[title="${sourcePath}"]`);
  await sourceLocator.scrollIntoViewIfNeeded();
  const source = await sourceLocator.boundingBox();
  expect(source).not.toBeNull();
  const startX = source!.x + source!.width / 2;
  const startY = source!.y + source!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 8, { steps: 3 });
  await expect(sourceLocator).toHaveClass(/is-dragging/);
}

async function moveSidebarFileDrag(page: Page, targetPath: string, placement: "before" | "after" = "before") {
  const targetLocator = page.locator(`.sidebar-file-item[title="${targetPath}"]`);
  await targetLocator.scrollIntoViewIfNeeded();
  const target = await targetLocator.boundingBox();
  expect(target).not.toBeNull();
  const targetY = placement === "before" ? target!.y + target!.height * 0.25 : target!.y + target!.height * 0.75;
  await page.mouse.move(target!.x + target!.width / 2, targetY, { steps: 8 });
}

async function beginSidebarNodeDrag(page: Page, kind: "source" | "folder" | "file", label: string) {
  const sourceLocator = sidebarTreeNode(page, kind, label);
  await sourceLocator.scrollIntoViewIfNeeded();
  const source = await sourceLocator.boundingBox();
  expect(source).not.toBeNull();
  const startX = source!.x + source!.width / 2;
  const startY = source!.y + source!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 8, { steps: 3 });
  await expect(sourceLocator).toHaveClass(/is-dragging/);
}

async function moveSidebarNodeDrag(page: Page, kind: "source" | "folder" | "file", label: string, placement: "before" | "after" = "before") {
  const targetLocator = sidebarTreeNode(page, kind, label);
  await targetLocator.scrollIntoViewIfNeeded();
  const target = await targetLocator.boundingBox();
  expect(target).not.toBeNull();
  const targetY = placement === "before" ? target!.y + target!.height * 0.25 : target!.y + target!.height * 0.75;
  await page.mouse.move(target!.x + target!.width / 2, targetY, { steps: 8 });
}

async function dragSidebarNode(page: Page, source: { kind: "source" | "folder" | "file"; label: string }, target: { kind: "source" | "folder" | "file"; label: string }, placement: "before" | "after" = "before") {
  await beginSidebarNodeDrag(page, source.kind, source.label);
  await moveSidebarNodeDrag(page, target.kind, target.label, placement);
  await releaseSidebarFileDrag(page);
}

async function moveSidebarFileDragToRowCenter(page: Page, targetPath: string) {
  const targetLocator = page.locator(`.sidebar-file-item[title="${targetPath}"]`);
  await targetLocator.scrollIntoViewIfNeeded();
  const target = await targetLocator.boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 8 });
}

async function getSidebarFileRowCenter(page: Page, targetPath: string) {
  const targetLocator = page.locator(`.sidebar-file-item[title="${targetPath}"]`);
  await targetLocator.scrollIntoViewIfNeeded();
  const target = await targetLocator.boundingBox();
  expect(target).not.toBeNull();
  return {
    x: target!.x + target!.width / 2,
    y: target!.y + target!.height / 2,
  };
}

async function moveSidebarFileDragToPoint(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y, { steps: 8 });
}

async function releaseSidebarFileDrag(page: Page) {
  await page.mouse.up();
}

async function cancelSidebarFileDrag(page: Page) {
  await page.evaluate(() => {
    const active = document.querySelector(".sidebar-file-item.is-dragging");
    if (!(active instanceof HTMLElement)) return;
    active.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  });
  await page.mouse.up();
}

async function dragSidebarFile(page: Page, sourcePath: string, targetPath: string, placement: "before" | "after" = "before") {
  await beginSidebarFileDrag(page, sourcePath);
  await moveSidebarFileDrag(page, targetPath, placement);
  await releaseSidebarFileDrag(page);
}

async function readLocalSidebarTreePrefsRaw(page: Page) {
  return page.evaluate(() => localStorage.getItem("data-editor:__sidebar-tree-prefs"));
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

async function getActiveProjectId(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error(await response.text());
    const registry = await response.json() as { activeProjectId?: string | null };
    return registry.activeProjectId ?? null;
  });
}

async function getDefaultCollectionPath(page: Page, filePath: string, projectId?: string | null) {
  return page.evaluate(async ({ currentFilePath, currentProjectId }) => {
    const query = new URLSearchParams({ path: currentFilePath });
    if (currentProjectId) query.set("projectId", currentProjectId);
    const response = await fetch(`/api/document?${query.toString()}`);
    if (!response.ok) throw new Error(await response.text());
    const documentModel = await response.json() as {
      collections?: Array<{ path?: string }>;
    };
    return documentModel.collections?.[0]?.path ?? "$";
  }, { currentFilePath: filePath, currentProjectId: projectId ?? null });
}

async function waitForTableScrollReady(page: Page, options: { vertical?: boolean; horizontal?: boolean } = {}) {
  const { vertical = true, horizontal = false } = options;
  await expect.poll(async () => page.evaluate(() => {
    const table = document.querySelector(".table-scroll") as HTMLElement | null;
    if (!table) return null;
    return {
      vertical: table.scrollHeight > table.clientHeight,
      horizontal: table.scrollWidth > table.clientWidth,
    };
  })).toEqual({ vertical, horizontal });
}

async function readTableScrollPosition(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector(".table-scroll") as HTMLElement | null;
    if (!table) return null;
    return {
      scrollTop: table.scrollTop,
      scrollLeft: table.scrollLeft,
      clientHeight: table.clientHeight,
      clientWidth: table.clientWidth,
      scrollHeight: table.scrollHeight,
      scrollWidth: table.scrollWidth,
    };
  });
}

async function setTableScrollPosition(page: Page, scrollTop: number, scrollLeft: number) {
  await page.evaluate(({ nextScrollTop, nextScrollLeft }) => {
    const table = document.querySelector(".table-scroll") as HTMLElement | null;
    if (!table) return;
    table.scrollTop = nextScrollTop;
    table.scrollLeft = nextScrollLeft;
    table.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, { nextScrollTop: scrollTop, nextScrollLeft: scrollLeft });
  await expect.poll(async () => page.evaluate(() => {
    const table = document.querySelector(".table-scroll") as HTMLElement | null;
    if (!table) return null;
    return {
      scrollTop: table.scrollTop,
      scrollLeft: table.scrollLeft,
    };
  })).toEqual({
    scrollTop,
    scrollLeft,
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

  await columnHeaderTrigger(page, "category").click();
  const copyAction = page.locator(".column-menu-popup .menu-item").filter({ hasText: "复制字段文本" });
  await expect(copyAction).toBeVisible();
  await copyAction.click();

  await expect(page.locator(".column-menu-popup")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("category");
});

test("column header full title tooltip only appears for truncated headers and hides on menu open", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await resizeColumnHeader(page, "description", -220);

  const truncatedHeader = columnHeaderTrigger(page, "description");
  const shortHeader = columnHeaderTrigger(page, "rune_name");
  const tooltip = columnHeaderTooltip(page);

  await expect.poll(async () => page.evaluate(() => {
    const col = document.querySelector('col[data-column-field="description"]') as HTMLTableColElement | null;
    return col?.style.width ?? "";
  })).toBe("56px");
  await expect.poll(async () => truncatedHeader.evaluate((element) => {
    const title = element.querySelector("span");
    return title instanceof HTMLElement && title.scrollWidth > title.clientWidth;
  })).toBe(true);
  await expect.poll(async () => shortHeader.evaluate((element) => {
    const title = element.querySelector("span");
    return title instanceof HTMLElement && title.scrollWidth <= title.clientWidth;
  })).toBe(true);

  await shortHeader.hover();
  await expect(tooltip).toHaveCount(0);

  await truncatedHeader.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("description");
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox!.y).toBeGreaterThanOrEqual(0);

  await page.mouse.move(4, 4);
  await expect(tooltip).toHaveCount(0);

  await truncatedHeader.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("description");

  await shortHeader.focus();
  await expect(tooltip).toHaveCount(0);

  await truncatedHeader.hover();
  await expect(tooltip).toBeVisible();
  await truncatedHeader.click();
  await expect(page.locator(".column-menu-popup")).toBeVisible();
  await expect(tooltip).toHaveCount(0);
});

test("column header tooltip hides during drag and resize and can recover after pointercancel", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await resizeColumnHeader(page, "description", -220);

  const header = columnHeaderTrigger(page, "description");
  const tooltip = columnHeaderTooltip(page);

  await expect.poll(async () => header.evaluate((element) => {
    const title = element.querySelector("span");
    return title instanceof HTMLElement && title.scrollWidth > title.clientWidth;
  })).toBe(true);

  await header.hover();
  await expect(tooltip).toBeVisible();

  await beginColumnHeaderDrag(page, "description");
  await expect(page.locator(".column-drag-ghost")).toBeVisible();
  await expect(tooltip).toHaveCount(0);

  await cancelColumnHeaderDrag(page);
  await expect(page.locator(".column-drag-ghost")).toHaveCount(0);
  await header.hover();
  await expect(tooltip).toBeVisible();

  await header.hover();
  await expect(tooltip).toBeVisible();
  const resizeHandle = page.locator('.column-resize-handle[aria-label="Resize description column"]');
  const box = await resizeHandle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(tooltip).toHaveCount(0);
  await page.mouse.up();
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
    await page.locator(".filter-option-row").filter({ hasText: "attack" }).click();
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "attack" })).toBeVisible();
    await expect(page.locator(".view-tab-shell.dirty")).toHaveCount(1);
    await expect(page.locator(".view-tab-shell.dirty .view-tab")).toContainText(activeViewName);
    await expect(page.locator(".dirty-pill")).toHaveCount(0);
    await expect(page.locator(".view-filter-actions .save-shared")).toBeEnabled();
    await expect(tableRows(page)).toHaveCount(1);
    await expect(tableRow(page, 0)).toContainText("multi_2");

    await page.locator(".filter-popover-content").press("Escape");
    await columnHeaderTrigger(page, "id").click();
    await expect(page.locator(".column-menu-popup")).toBeVisible();
    await page.locator('.column-menu-popup .menu-item[data-column-action="add-filter"]').click();
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "id" })).toBeVisible();
    await expect(page.locator(".filter-popover-content")).toBeVisible();
    await page.locator(".filter-text-input").fill("multi_2");
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "multi_2" })).toBeVisible();
    await page.locator(".filter-popover-content").press("Escape");

    await columnHeaderTrigger(page, "name").click();
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
    await expect(tableRows(page)).toHaveCount(1);
    await expect(tableRow(page, 0)).toContainText("multi_2");

    await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
    const nameInput = page.locator(".detail-panel.primary .property-block").filter({ hasText: "name" }).locator(".detail-input").first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Filtered original row edited");
    await waitForAutosaveWrite(page, async () => {
      const text = await readFile(dataPath, "utf8");
      const rows = JSON.parse(text) as Array<{ name: string }>;
      return rows.map((row) => row.name).includes("Filtered original row edited");
    });
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

test("duplicating a shared view copies the current filter snapshot and current user's local view layout without creating a dirty target draft", async ({ page }) => {
  const collectionKey = "data/runes.json:$";
  let originalSharedViews: SharedViewsConfig | null = null;
  let originalLocalStorage: Record<string, string> | null = null;

  await page.goto("/");
  originalSharedViews = await loadSharedViewsConfig(page);
  originalLocalStorage = await snapshotLocalStorage(page);

  try {
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/runes.json:$:all:description:hidden", "1");
      localStorage.setItem("data-editor:data/runes.json:$:all:__order", "rune_name,description,description_zh");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/runes.json"]').click();
    await expect(page.locator('col[data-column-field="description"]')).toHaveCount(0);

    await page.getByRole("button", { name: "+ 筛选" }).click();
    await expect(page.locator(".add-filter-popover-content")).toBeVisible();
    await page.locator(".add-filter-field-option").filter({ hasText: "rune_id" }).click();
    await expect(page.locator(".filter-popover-content")).toBeVisible();
    await page.locator(".filter-text-input").fill("fire");
    await expect(page.locator(".view-tab-shell.active")).toHaveClass(/dirty/);
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "fire" })).toBeVisible();

    await page.locator(".view-tab-shell.active .view-tab").click();
    await expect(page.locator(".view-tab-menu-content")).toBeVisible();
    await page.locator(".view-tab-menu-item").filter({ hasText: "创建视图副本" }).click();

    const duplicateTab = page.locator(".view-tab-shell.active .view-tab").filter({ hasText: "全部 副本" });
    await expect(duplicateTab).toBeVisible();
    await expect(page.locator(".view-tab-shell.active")).not.toHaveClass(/dirty/);
    await expect(page.locator('col[data-column-field="description"]')).toHaveCount(0);
    await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "fire" })).toBeVisible();

    const sharedViews = await loadSharedViewsConfig(page);
    const duplicatedView = sharedViews.collections[collectionKey].views.find((view) => view.name === "全部 副本");
    expect(duplicatedView).toBeTruthy();
    expect(filterValues(duplicatedView, "rune_id")).toContain("fire");
    await expect.poll(async () => page.evaluate((viewId) => localStorage.getItem(`data-editor:data/runes.json:$:${viewId}:description:hidden`), duplicatedView!.id)).toBe("1");
  } finally {
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
  await expect(tableRows(page)).toHaveCount(2);
  await expect(filterPopover.locator(".filter-option-search-input")).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);
  await expect(filterPopover).not.toContainText("鏈€夋嫨");
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
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toContainText("包含");
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" })).toContainText("spell");
  await expect(tableRows(page)).toHaveCount(1);

  await filterPopover.locator('.filter-selected-chip-list .selected-chip-remove[aria-label="绉婚櫎 spell"]').click();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "spell" })).toHaveCount(0);
  await expect(tableRows(page)).toHaveCount(2);
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
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();

  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("包含");
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("spell");
  await expect(tableRows(page)).toHaveCount(1);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.locator('.filter-select-content [data-filter-operator="is_empty"]').click();
  await expect(filterPopover.locator(".filter-option-value-area")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("为空");
  await expect(tableRows(page)).toHaveCount(1);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.locator('.filter-select-content [data-filter-operator="contains"]').click();
  await expect(filterPopover.locator(".filter-option-value-area")).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "spell" })).toBeVisible();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("spell");
  await expect(tableRows(page)).toHaveCount(1);
});

test("value filter cache stays scoped per view and clears after delete and recreate", async ({ page }) => {
  const collectionKey = "data/e2e_select.json:$";

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select.json:$:category"') && text.includes('"type": "Select"'));

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
  await page.locator('.filter-select-content [data-filter-operator="is_empty"]').click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("为空");

  await page.locator(".view-tab").filter({ hasText: "第二视图" }).click();
  await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText("第二视图");
  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("包含");
  await expect(tableRows(page)).toHaveCount(3);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.locator('.filter-select-content [data-filter-operator="is_empty"]').click();
  await filterPopover.locator(".filter-select-trigger").click();
  await page.locator('.filter-select-content [data-filter-operator="contains"]').click();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);

  await page.locator(".filter-action-trigger").click();
  await page.locator(".filter-action-menu .menu-item.danger").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toHaveCount(0);

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("包含");
  await expect(tableRows(page)).toHaveCount(3);
});

test("value filters support does_not_contain and is_not_empty with real row results", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();
  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await expect(tableRows(page)).toHaveCount(1);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "不包含", exact: true }).click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("不包含");
  await expect(tableRows(page)).toHaveCount(2);

  await filterPopover.locator(".filter-select-trigger").click();
  await page.getByRole("option", { name: "不为空", exact: true }).click();
  await expect(filterPopover.locator(".filter-option-value-area")).toHaveCount(0);
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("不为空");
  await expect(tableRows(page)).toHaveCount(2);
});

test("filter operator select stays above the filter popover surface", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "features" }).click();

  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();

  const operatorTrigger = filterPopover.locator(".filter-select-trigger");
  await operatorTrigger.click();

  const operatorMenu = page.locator(".filter-select-content");
  await expect(operatorMenu).toBeVisible();
  await expect(operatorMenu).toHaveCSS("z-index", "1700");
  await expect(filterPopover).toHaveCSS("z-index", "1600");
  await expect(operatorMenu.getByRole("option", { name: "不包含", exact: true })).toBeVisible();
});

test("select filter contains operator keeps multiple selected values", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "category" }).click();

  const filterPopover = page.locator(".filter-popover-content");
  await expect(filterPopover).toBeVisible();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "spell" }).click();
  await filterPopover.locator(".filter-option-row").filter({ hasText: "attack" }).click();

  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip")).toHaveCount(2);
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "spell" })).toBeVisible();
  await expect(filterPopover.locator(".filter-selected-chip-list .selected-chip").filter({ hasText: "attack" })).toBeVisible();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("spell");
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "category" })).toContainText("attack");
  await expect(tableRows(page)).toHaveCount(2);
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
  await waitForProjectConfigWrite(page, (text) => text.includes('"skill_id"') && text.includes('"targetFile": "data/skills.json"'));

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
  await expect(relationChip).toContainText("包含");
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
  await waitForProjectConfigWrite(page, (text) => text.includes('"skill_id"') && text.includes('"targetFile": "data/skills.json"'));

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
  const slashRow = filterPopover.locator('.filter-option-row[data-filter-option-value="skill_slash"]');
  await expect(filterPopover).toBeVisible();

  await filterPopover.locator(".filter-option-search-input").fill("斩击");
  await expect(slashRow).toBeVisible();
  await filterPopover.locator(".filter-option-search-input").fill("skill_slash");
  await expect(slashRow).toBeVisible();

  await slashRow.click();
  await expect(page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "skill_id" })).toContainText("斩击");
  await expect(tableRows(page)).toHaveCount(1);
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

test("sort direction select stays above the sort popover surface", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "features" }).click();

  await page.locator(".view-filter-sort-button").click();
  const sortPopover = page.locator(".sort-popover-content");
  await expect(sortPopover).toBeVisible();
  await sortPopover.locator('[data-sort-action="add"]').click();

  const directionTrigger = sortPopover.locator(".sort-direction-trigger").first();
  await directionTrigger.click();
  const directionMenu = page.locator(".sort-direction-content");
  await expect(directionMenu).toBeVisible();
  await expect(directionMenu).toHaveCSS("z-index", "50");
  await expect(sortPopover).toHaveCSS("z-index", "30");
  await expect(directionMenu.getByRole("option", { name: "降序", exact: true })).toBeVisible();
});

test("sort chip reuses the filter chip visual style", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.getByRole("button", { name: "+ 筛选" }).click();
  await page.locator(".add-filter-field-option").filter({ hasText: "features" }).click();

  await page.locator(".view-filter-sort-button").click();
  const sortPopover = page.locator(".sort-popover-content");
  await expect(sortPopover).toBeVisible();
  await sortPopover.locator('[data-sort-action="add"]').click();

  const fieldTrigger = sortPopover.locator(".sort-field-trigger").first();
  await fieldTrigger.click();
  await page.locator(".sort-select-content").getByRole("option", { name: "name", exact: true }).click();

  const directionTrigger = sortPopover.locator(".sort-direction-trigger").first();
  await directionTrigger.click();
  await page.locator(".sort-direction-content").getByRole("option", { name: "降序", exact: true }).click();

  const sortChip = page.locator('.view-filter-chip.sort-chip[title="name desc"]');
  const filterChip = page.locator(".view-filter-chip:not(.sort-chip)").filter({ hasText: "features" });
  await expect(sortChip).toBeVisible();
  await expect(sortChip).toContainText("鈫?name");
  await expect(filterChip).toBeVisible();
  const filterChipBorderRadius = await filterChip.evaluate((element) => getComputedStyle(element).borderRadius);
  const filterChipFontSize = await filterChip.evaluate((element) => getComputedStyle(element).fontSize);
  await expect(sortChip).toHaveCSS("border-radius", filterChipBorderRadius);
  await expect(sortChip).toHaveCSS("font-size", filterChipFontSize);
  await expect(sortChip.locator(".filter-chip-chevron")).toHaveCount(1);
});

test("sort popover drag handle reorders sort priority and updates the real table order", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_multiselect.json");
  const originalData = await readFile(dataPath, "utf8");

  await writeFile(dataPath, JSON.stringify([
    {
      id: "a_row",
      name: "Beta",
      features: ["spell"],
    },
    {
      id: "b_row",
      name: "Alpha",
      features: ["attack"],
    },
    {
      id: "c_row",
      name: "Alpha",
      features: ["minion"],
    },
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await page.locator(".view-filter-sort-button").click();
    const sortPopover = page.locator(".sort-popover-content");
    await expect(sortPopover).toBeVisible();
    await sortPopover.locator('[data-sort-action="add"]').click();
    await sortPopover.locator('[data-sort-action="add"]').click();

    await sortPopover.locator(".sort-field-trigger").nth(0).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "name", exact: true }).click();
    await sortPopover.locator(".sort-field-trigger").nth(1).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "id", exact: true }).click();

    await expect.poll(() => getVisibleTableIds(page)).toEqual(["b_row", "c_row", "a_row"]);

    await beginSortRuleHandleDrag(page, 1);
    await expect(sortPopover.locator(".sort-rule-drag-ghost")).toBeVisible();
    await expect(sortPopover.locator(".sort-rule-drag-placeholder")).toBeVisible();
    await movePointerOverSortRule(page, 0);
    await endSortRuleHandleDrag(page, 0);
    await expect(sortPopover.locator(".sort-field-trigger")).toHaveCount(2);
    await expect.poll(() => getSortRuleFields(page)).toEqual(["id", "name"]);
    await expect.poll(() => getVisibleTableIds(page)).toEqual(["a_row", "b_row", "c_row"]);

    await sortPopover.locator(".sort-direction-trigger").nth(0).click();
    await page.locator(".sort-direction-content").getByRole("option", { name: "降序", exact: true }).click();
    await expect(sortPopover.locator(".sort-rule-row").nth(0).locator(".sort-direction-trigger")).toContainText("降序");

    await sortPopover.locator('.sort-rule-row').nth(1).getByRole("button", { name: "删除排序" }).click();
    await expect(sortPopover.locator(".sort-rule-row")).toHaveCount(1);
  } finally {
    await bestEffortRestore("e2e_multiselect.json", () => writeFile(dataPath, originalData, "utf8"));
  }
});

test("sort chip popover also supports drag reordering", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_multiselect.json");
  const originalData = await readFile(dataPath, "utf8");

  await writeFile(dataPath, JSON.stringify([
    {
      id: "a_row",
      name: "Beta",
      features: ["spell"],
    },
    {
      id: "b_row",
      name: "Alpha",
      features: ["attack"],
    },
    {
      id: "c_row",
      name: "Alpha",
      features: ["minion"],
    },
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await page.locator(".view-filter-sort-button").click();
    const firstSortPopover = page.locator(".sort-popover-content");
    await firstSortPopover.locator('[data-sort-action="add"]').click();
    await firstSortPopover.locator('[data-sort-action="add"]').click();
    await firstSortPopover.locator(".sort-field-trigger").nth(0).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "name", exact: true }).click();
    await firstSortPopover.locator(".sort-field-trigger").nth(1).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "id", exact: true }).click();
    await closePopoverByClickingOutside(page);

    const sortChip = page.locator(".view-filter-chip.sort-chip");
    await expect(sortChip).toHaveCount(1);
    await expect(sortChip).toContainText("2 个排序");
    await expect(sortChip).toHaveAttribute("title", "name asc, id asc");
    await sortChip.click();
    const chipPopover = page.locator(".sort-popover-content");
    await expect(chipPopover).toBeVisible();

    await dragSortRuleHandle(page, 1, 0);

    await expect.poll(() => getSortRuleFields(page)).toEqual(["id", "name"]);
    await expect.poll(() => getVisibleTableIds(page)).toEqual(["a_row", "b_row", "c_row"]);
  } finally {
    await bestEffortRestore("e2e_multiselect.json", () => writeFile(dataPath, originalData, "utf8"));
  }
});

test("multiple sorts merge into a single summary chip", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.locator(".view-filter-sort-button").click();
  const sortPopover = page.locator(".sort-popover-content");
  await expect(sortPopover).toBeVisible();
  await sortPopover.locator('[data-sort-action="add"]').click();
  await sortPopover.locator(".sort-field-trigger").first().click();
  await page.locator(".sort-select-content").getByRole("option", { name: "name", exact: true }).click();
  await closePopoverByClickingOutside(page);

  const singleSortChip = page.locator(".view-filter-chip.sort-chip");
  await expect(singleSortChip).toHaveCount(1);
  await expect(singleSortChip).toContainText("鈫?name");
  await expect(singleSortChip).toHaveAttribute("title", "name asc");

  await singleSortChip.click();
  await expect(sortPopover).toBeVisible();
  await sortPopover.locator('[data-sort-action="add"]').click();
  await sortPopover.locator(".sort-field-trigger").nth(1).click();
  await page.locator(".sort-select-content").getByRole("option", { name: "id", exact: true }).click();
  await closePopoverByClickingOutside(page);

  const mergedSortChip = page.locator(".view-filter-chip.sort-chip");
  await expect(mergedSortChip).toHaveCount(1);
  await expect(mergedSortChip).toContainText("2 个排序");
  await expect(mergedSortChip).toHaveAttribute("title", "name asc, id asc");
});

test("sort popover drag cancel rolls back preview without changing priority", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_multiselect.json");
  const originalData = await readFile(dataPath, "utf8");

  await writeFile(dataPath, JSON.stringify([
    { id: "a_row", name: "Beta", features: ["spell"] },
    { id: "b_row", name: "Alpha", features: ["attack"] },
    { id: "c_row", name: "Alpha", features: ["minion"] },
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await page.locator(".view-filter-sort-button").click();
    const sortPopover = page.locator(".sort-popover-content");
    await expect(sortPopover).toBeVisible();
    await sortPopover.locator('[data-sort-action="add"]').click();
    await sortPopover.locator('[data-sort-action="add"]').click();

    await sortPopover.locator(".sort-field-trigger").nth(0).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "name", exact: true }).click();
    await sortPopover.locator(".sort-field-trigger").nth(1).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "id", exact: true }).click();

    await expect.poll(() => getSortRuleFields(page)).toEqual(["name", "id"]);
    await expect.poll(() => getVisibleTableIds(page)).toEqual(["b_row", "c_row", "a_row"]);

    await beginSortRuleHandleDrag(page, 1);
    await expect(sortPopover.locator(".sort-rule-drag-ghost")).toBeVisible();
    await expect(sortPopover.locator(".sort-rule-drag-placeholder")).toBeVisible();

    await cancelSortRuleHandleDrag(page);

    await expect(sortPopover.locator(".sort-rule-drag-ghost")).toHaveCount(0);
    await expect(sortPopover.locator(".sort-rule-drag-placeholder")).toHaveCount(0);
    await expect.poll(() => getSortRuleFields(page)).toEqual(["name", "id"]);
    await expect.poll(() => getVisibleTableIds(page)).toEqual(["b_row", "c_row", "a_row"]);
  } finally {
    await bestEffortRestore("e2e_multiselect.json", () => writeFile(dataPath, originalData, "utf8"));
  }
});

test("sort popover drag release over field trigger reorders without opening select", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_multiselect.json");
  const originalData = await readFile(dataPath, "utf8");

  await writeFile(dataPath, JSON.stringify([
    { id: "a_row", name: "Beta", features: ["spell"] },
    { id: "b_row", name: "Alpha", features: ["attack"] },
    { id: "c_row", name: "Alpha", features: ["minion"] },
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await page.locator(".view-filter-sort-button").click();
    const sortPopover = page.locator(".sort-popover-content");
    await expect(sortPopover).toBeVisible();
    await sortPopover.locator('[data-sort-action="add"]').click();
    await sortPopover.locator('[data-sort-action="add"]').click();

    await sortPopover.locator(".sort-field-trigger").nth(0).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "name", exact: true }).click();
    await sortPopover.locator(".sort-field-trigger").nth(1).click();
    await page.locator(".sort-select-content").getByRole("option", { name: "id", exact: true }).click();

    await beginSortRuleHandleDrag(page, 1);
    await movePointerOverSortRule(page, 0);
    await releaseSortRuleHandleDragOverFieldTrigger(page, 0);

    await expect.poll(() => getSortRuleFields(page)).toEqual(["id", "name"]);
    await expect.poll(() => getVisibleTableIds(page)).toEqual(["a_row", "b_row", "c_row"]);
    await expect(page.locator(".sort-select-content")).toHaveCount(0);
    await expect(sortPopover.locator(".sort-rule-row")).toHaveCount(2);
  } finally {
    await bestEffortRestore("e2e_multiselect.json", () => writeFile(dataPath, originalData, "utf8"));
  }
});

test("clickable drag surfaces use pointer by default and grabbing while dragging", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const activeViewTab = page.locator(".view-tab-shell.active .view-tab");
  const sidebarFileItem = page.locator('.sidebar-file-item[title="data/e2e_multiselect.json"]');
  const columnTrigger = columnHeaderTrigger(page, "id");

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

  const sourceColumn = columnHeaderTrigger(page, "id");
  const targetColumn = columnHeaderTrigger(page, "name");
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary .nested-entry-button")).toContainText("mixed");
  await page.locator(".detail-panel.primary .nested-entry-button").click();
  await expect(page.locator(".detail-panel.secondary.open")).toBeVisible();
  await expect(page.locator(".nested-item-list button")).toHaveCount(2);
  await page.locator(".nested-item-list button").nth(1).click();
  await page.locator(".detail-panel.secondary .detail-input").fill("e2e_nested");
  await expect(page.locator(".dirty-pill")).toBeVisible();
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_mixed.json"), "utf8");
    return text.includes("e2e_nested");
  });

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator(".multi-select-trigger").last().click();
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
  await page.locator('.multi-select-color-item[data-color-choice="red"]').click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "strike" }).locator(".chip")).toHaveCSS("background-color", "rgb(255, 217, 214)");
  await page.locator(".multi-select-option-row").filter({ hasText: "spell" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-option-editor .multi-select-option-action.danger").click();
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await closePopoverByClickingOutside(page);
  const featuresBlockAfterEdit = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "features" }),
  });
  await expect(featuresBlockAfterEdit.locator(".multi-select-trigger .chip")).toContainText(["strike", "custom_tag"]);
  await expect(featuresBlockAfterEdit.locator(".multi-select-trigger .chip").filter({ hasText: "strike" })).toBeVisible();
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_multiselect.json"), "utf8");
    return text.includes('"strike"') && !text.includes('"attack"') && !text.includes('"spell"');
  });
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"strike"') && text.includes('"red"') && !text.includes('"attack"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await expect(page.locator('.column-menu-popup [data-field-type="Text"]')).toBeVisible();
  await expect(page.locator('.column-menu-popup [data-field-type="Select"]')).toBeVisible();
  await expect(page.locator('.column-menu-popup [data-field-type]')).toHaveCount(2);
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await expect(page.locator(".dirty-pill")).toBeVisible();
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_select.json:$:category"') &&
      text.includes('"type": "Select"') &&
      text.includes('"attack"') &&
      text.includes('"spell"');
  });
  await tableRow(page, 0).locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await page.locator(".multi-select-option").filter({ hasText: "spell" }).click();
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await expect(tableRow(page, 0).locator(".multi-select-trigger")).toContainText("spell");
  await expect(tableRow(page, 0).locator(".multi-select-trigger .chip")).toBeVisible();
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await page.locator(".multi-select-option-row").filter({ hasText: "attack" }).locator(".option-menu-trigger").click();
  await expect(page.locator(".multi-select-option-editor")).toBeVisible();
  await page.locator(".multi-select-option-name-input").fill("strike");
  await page.locator(".multi-select-option-name-input").press("Enter");
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "strike" })).toBeVisible();
  await page.locator(".multi-select-option-row").filter({ hasText: "strike" }).locator(".option-menu-trigger").click();
  await page.locator('.multi-select-color-item[data-color-choice="blue"]').click();
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await closePopoverByClickingOutside(page);
  await expect(tableRow(page, 0).locator(".multi-select-trigger")).toContainText("spell");
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_select.json"), "utf8");
    return text.includes('"category": "spell"');
  });
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Text"]').click();
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"type": "Text"') && text.includes('"strike"') && text.includes('"blue"') && text.includes('"spell"');
  });

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator(".multi-select-trigger").last().click();
  await page.locator(".multi-select-option-row").filter({ hasText: "custom_tag" }).locator(".option-menu-trigger").click();
  const pinkItem = page.locator('.multi-select-color-item[data-color-choice="pink"]');
  const redItem = page.locator('.multi-select-color-item[data-color-choice="red"]');
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
  await expect(tableRow(page, 1).locator(".issue.warning")).toHaveCount(2);
  await tableRow(page, 0).locator(".relation-trigger").first().click();
  await expect(page.locator(".relation-popover")).toBeVisible();
  await page.locator('.relation-option[data-relation-value="skill_heavy_slash"]').click();
  await page.locator(".relation-popover").press("Escape");
  await tableRow(page, 0).locator(".relation-trigger").nth(1).click();
  await expect(page.locator(".relation-popover")).toBeVisible();
  await page.locator('.relation-option[data-relation-value="focus"]').click();
  await page.locator(".relation-popover").press("Escape");
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8");
    return text.includes('"skill_id": "skill_heavy_slash"') && text.includes('"focus"');
  });
  const relationDataAfterEdit = await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8");
  await tableRow(page, 0).locator(".relation-trigger").first().click();
  await expect(page.locator(".relation-popover")).toBeVisible();
  await page.locator('.relation-option[data-relation-value="skill_heavy_slash"]').locator(".relation-open-target").evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 1 }));
  });
  await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await expect(page.locator(".relation-maintenance-panel")).toContainText("被引用");
  await expect(page.locator(".relation-maintenance-panel")).toContainText("Relation Row");
  await expect(page.locator(".relation-maintenance-panel")).toContainText("skill_id");
  await page.locator(".relation-backlink-item").filter({ hasText: "Relation Row" }).click();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_relation.json");
  await columnHeaderTrigger(page, "skill_id").click();
  await page.locator('.column-menu-popup [data-relation-action="clear"]').click();
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return !text.includes('"data/e2e_relation.json:$:skill_id"') &&
      text.includes('"data/e2e_relation.json:$:keywords"') &&
      !text.includes('"data/skills.json:skills:back_skill_id"') &&
      text.includes('"data/keywords.json:$:back_keywords"');
  }).toBe(true);
  expect(await readFile(path.resolve("tests/.scratch/data/e2e_relation.json"), "utf8")).toBe(relationDataAfterEdit);

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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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

  await columnHeaderTrigger(page, "description").click();
  await expect(page.locator(".menu-content")).toBeVisible();
  await page.locator(".menu-content").press("Escape");
  await expect(page.locator(".menu-content")).toHaveCount(0);

  const headerOrderBeforeDrag = await getColumnHeaderOrder(page);
  expect(headerOrderBeforeDrag.slice(0, 3)).toEqual(["rune_name", "description", "description_zh"]);
  await dragColumnHeader(page, "description_zh", "rune_name");
  await expect(page.locator(".menu-content")).toHaveCount(0);
  const headerOrderAfterDrag = await getColumnHeaderOrder(page);
  expect(headerOrderAfterDrag.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/runes.json:$:all:__order"))).toContain("description_zh,rune_name,description");
  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/runes.json");
  await expect(columnHeaderTrigger(page, "description_zh")).toBeVisible();
  const headerOrderAfterReload = await getColumnHeaderOrder(page);
  expect(headerOrderAfterReload.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);

  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
  await scrollColumnHeaderNearEdge(page, "icon_path", "right");
  await dragColumnHeader(page, "icon_path", "dev_status");
  const headerOrderAfterIconDrag = await getColumnHeaderOrder(page);
  expect(headerOrderAfterIconDrag.indexOf("icon_path")).toBeGreaterThanOrEqual(0);
  expect(headerOrderAfterIconDrag.indexOf("dev_status")).toBeGreaterThanOrEqual(0);
  expect(headerOrderAfterIconDrag.indexOf("icon_path")).toBeLessThan(headerOrderAfterIconDrag.indexOf("dev_status"));
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/skills.json:skills:all:__order"))).toContain("icon_path");
  await page.reload();
  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await expect(columnHeaderTrigger(page, "icon_path")).toBeVisible();
  const headerOrderAfterSkillsReload = await getColumnHeaderOrder(page);
  expect(headerOrderAfterSkillsReload.indexOf("icon_path")).toBeLessThan(headerOrderAfterSkillsReload.indexOf("dev_status"));

  await page.evaluate(() => localStorage.setItem(
    "data-editor:data/skills.json:skills:all:__order",
    "dev_status,skill_name,ap_cost,description,class_pool,complexity,cooldown,description_zh,id,mana_cost,owner,range_type_show,range_value_show,skill_category,skill_id,skill_type,tags,spell_subtype,minion_subtype,form_duration,enemy_behavior_actions,enemy_intent_type,enemy_ai_tags,enemy_interaction_windows,enemy_bonus_answer_tags,enemy_skill_role,control_protection_tags,nodes,icon_path,equipment_requirement,on_expire_effect,replaced_skills,enemy_budget_score,back_skills,back_phase_skills",
  ));
  await page.reload();
  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
  await scrollColumnHeaderNearEdge(page, "icon_path", "right");
  await columnHeaderTrigger(page, "icon_path").click();
  await expect(page.locator(".column-menu-popup")).toBeVisible();
  await page.locator('.column-menu-popup [data-column-action="move-right"]').click();
  const headerOrderAfterIconRightDrag = await getColumnHeaderOrder(page);
  expect(headerOrderAfterIconRightDrag.indexOf("icon_path")).toBeGreaterThan(headerOrderAfterIconRightDrag.indexOf("equipment_requirement"));
  expect(headerOrderAfterIconRightDrag.indexOf("icon_path")).toBeLessThan(headerOrderAfterIconRightDrag.indexOf("on_expire_effect"));
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/skills.json:skills:all:__order"))).toContain("on_expire_effect");
  await page.reload();
  await page.locator('.sidebar-item[title="data/skills.json"]').click();
  await scrollColumnHeaderNearEdge(page, "icon_path", "right");
  const headerOrderAfterIconRightReload = await getColumnHeaderOrder(page);
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
    const td = document.querySelector(`tbody tr[data-row-id] td:nth-child(${colIndex + 1})`) as HTMLTableCellElement;
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

  const descriptionHeaderLayout = await columnHeaderTrigger(page, "description").evaluate((element) => {
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
    const heights = [...document.querySelectorAll("tbody tr[data-row-id]")].map((row) => (row as HTMLTableRowElement).getBoundingClientRect().height);
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
  expect(wrapResult.tdVerticalAlign).toBe("middle");
  expect(wrapResult.whiteSpace).toBe("normal");
  expect(["normal", null]).toContain(wrapResult.titleWhiteSpace);
  expect(wrapResult.contentScrollHeight).toBeLessThanOrEqual(wrapResult.contentClientHeight);
  expect(wrapResult.width).not.toBe(descriptionWidthBefore);
  expect(Math.max(...wrapResult.heights)).toBeGreaterThan(Math.min(...wrapResult.heights));

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await expect(page.locator(".toolbar strong")).toContainText("data/runes.json");

  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await page.locator(".detail-input").first().evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "e2e_edit_value";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/runes.json"), "utf8");
    return text.includes("e2e_edit_value");
  });

  const scratchRunes = JSON.parse(await readFile(path.resolve("tests/.scratch/data/runes.json"), "utf8"));
  expect(Array.isArray(scratchRunes)).toBe(true);

  await page.reload();
  await expect(page.locator('.sidebar-item[title="data/runes.json"]')).toContainText("runes.json");

  const realRunesAfter = await readFile(fixtureRunesPath, "utf8");
  expect(realRunesAfter).toBe(realRunesBefore);
});

test("detail panel reorder emits profiling measures in profile mode", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    localStorage.setItem("data-editor:enable-detail-reorder-profiling", "1");
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "e2e_detail_profile_perf",
        profile: {
          sidebarWidth: null,
          detailPanelWidth: null,
          fileOrder: [],
          lastActiveViews: {},
          viewDrafts: {},
          viewOrderDrafts: {},
          appearance: null,
          viewLayouts: {
            "data/runes.json:$": {
              all: {
                hidden: [],
                wrapped: [],
                order: [],
                detailOrder: ["sub_tags", "prototype_id", "title", "description"],
                widths: {},
              },
            },
          },
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "e2e_detail_profile_perf");
  });

  await page.reload();
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const detailOrderBefore = await page.locator(".detail-panel.primary .detail-property-handle").evaluateAll(
    (items) => items
      .map((item) => item.getAttribute("aria-label")?.replace(/^Reorder\s+/, "").trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 4),
  );
  expect(detailOrderBefore.length).toBeGreaterThanOrEqual(2);

  const draggedField = detailOrderBefore[1]!;
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
    const labels = await page.locator(".detail-panel.primary .detail-property-handle").evaluateAll(
      (items) => items
        .map((item) => item.getAttribute("aria-label")?.replace(/^Reorder\s+/, "").trim())
        .filter((value): value is string => Boolean(value))
        .slice(0, 4),
    );
    return labels.indexOf(draggedField);
  }).toBeLessThan(detailOrderBefore.indexOf(draggedField));

  await expect.poll(async () => {
    const detailReorderMeasures = await page.evaluate(() =>
      performance.getEntriesByType("measure").map((entry) => ({
        name: entry.name,
        duration: Math.round(entry.duration * 100) / 100,
      })),
    );
    return detailReorderMeasures.map((entry) => entry.name);
  }).toEqual(expect.arrayContaining([
    "detail-reorder:profile-update",
    "detail-reorder:build-field-config",
    "detail-reorder:build-issues",
    "detail-reorder:react-main-content",
    "detail-reorder:react-detail-panel",
    "detail-reorder:total",
  ]));
  await expect.poll(async () => {
    const detailReorderMeasures = await page.evaluate(() =>
      performance.getEntriesByType("measure").map((entry) => entry.name),
    );
    return detailReorderMeasures.includes("detail-reorder:react-data-table");
  }).toBe(false);

  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/e2e_detail_profile_perf.json"), "utf8");
    return text.includes("\"detailOrder\"") && text.includes(`\"${draggedField}\"`);
  }).toBe(true);
});

test("nested detail panel renders object items without falling back to raw JSON", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
});

test("detail panel profile layout persists reorder and nested table widths", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const detailOrderBefore = await page.locator(".detail-panel.primary .detail-property-handle").evaluateAll(
    (items) => items
      .map((item) => item.getAttribute("aria-label")?.replace(/^Reorder\s+/, "").trim())
      .filter((value): value is string => Boolean(value))
      .slice(0, 4),
  );
  expect(detailOrderBefore.length).toBeGreaterThanOrEqual(2);
  const draggedField = detailOrderBefore[1]!;
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
    const labels = await page.locator(".detail-panel.primary .detail-property-handle").evaluateAll(
      (items) => items
        .map((item) => item.getAttribute("aria-label")?.replace(/^Reorder\s+/, "").trim())
        .filter((value): value is string => Boolean(value))
        .slice(0, 4),
    );
    return labels.indexOf(draggedField);
  }).toBeLessThan(detailOrderBefore.indexOf(draggedField));
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/e2e_detail_profile.json"), "utf8");
    return text.includes("\"detailOrder\"") && text.includes(`\"${draggedField}\"`);
  }).toBe(true);

  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  const firstDetailTitle = await page.locator(".detail-panel.primary .panel-title").textContent();
  await expect(page.locator(".detail-panel.primary .property-block").filter({ hasText: "description" }).locator("textarea.detail-textarea").first()).toBeVisible();
  await expect(page.locator(".detail-panel.primary .property-block").filter({ hasText: "rune_id" }).locator(".relation-trigger")).toHaveCount(0);
  await tableRow(page, 1).evaluate((element) => (element as HTMLTableRowElement).click());
  const secondDetailTitle = await page.locator(".detail-panel.primary .panel-title").textContent();
  expect(secondDetailTitle).not.toBe(firstDetailTitle);

  await page.locator('.sidebar-item[title="data/status_effects.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await expect(page.locator('col[data-column-field="control"]')).toHaveCount(1);
  await tableRow(page, 20).locator('[data-cell-role="title-action"]').click();
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
});

test("keyword backlink columns support wrapped chip layout after reload", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_relation.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await ensurePrimaryKeySelection(page, "id");
  await configureRelation(page, "keywords", {
    targetFile: "data/keywords.json",
    targetCollection: "$",
    targetKey: "keyword_id",
    mode: "multi",
  });
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_relation.json:$:keywords"') &&
      text.includes('"data/keywords.json:$:back_keywords"');
  }).toBe(true);

  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  await expect(columnHeaderTrigger(page, "back_keyword_id")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("data-editor:data/keywords.json:$:all:back_keyword_id:wrapped", "1");
    localStorage.setItem("data-editor:data/keywords.json:$:all:back_keyword_id:width", "120");
  });
  await page.reload();
  await page.locator('.sidebar-item[title="data/keywords.json"]').click();
  await expect(columnHeaderTrigger(page, "back_keyword_id")).toBeVisible();
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
});

test("autosave persists scratch json edits without toolbar save button", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.locator(".toolbar .primary-button")).toHaveCount(0);
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await page.locator(".detail-panel.primary .nested-entry-button").click();
  await page.locator(".nested-item-list button").nth(1).click();
  await page.locator(".detail-panel.secondary .detail-input").fill("autosave_e2e");
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_mixed.json"), "utf8");
    return text.includes("autosave_e2e");
  });
});

test("detail text input keeps focus while autosave runs", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();

  const nameInput = page.locator(".detail-panel.primary .property-block").filter({ hasText: "name" }).locator(".detail-input").first();
  await nameInput.click();
  await nameInput.evaluate((node) => {
    (node as HTMLElement).dataset.identityProbe = "detail-name-probe";
  });
  await nameInput.fill("focus stable name");

  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_mixed.json"), "utf8");
    return text.includes("focus stable name");
  });

  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveAttribute("data-identity-probe", "detail-name-probe");
});

test("table text edit mode toggles ordinary text cell editing and autosaves", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_wrap_rows.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await tableCell(page, 0, "description").click();
  await expect(page.locator(".table-text-cell-editor")).toHaveCount(0);

  const editButton = page.getByRole("button", { name: "编辑" });
  await expect(editButton).toHaveAttribute("aria-pressed", "false");
  await editButton.click();
  await expect(editButton).toHaveAttribute("aria-pressed", "true");

  const editor = tableCell(page, 0, "description").locator(".table-text-cell-editor input");
  await expect(editor).toBeVisible();
  await editor.click();
  const activeStyle = await tableCell(page, 0, "description").locator(".table-text-cell-editor").evaluate((element) => {
    const style = getComputedStyle(element);
    const editorRect = element.getBoundingClientRect();
    const cellRect = element.closest("td")!.getBoundingClientRect();
    const input = element.querySelector("input") as HTMLInputElement;
    const inputRect = input.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      cellWidth: cellRect.width,
      cellHeight: cellRect.height,
      topDelta: editorRect.top - cellRect.top,
      leftDelta: editorRect.left - cellRect.left,
      rightDelta: editorRect.right - cellRect.right,
      bottomDelta: editorRect.bottom - cellRect.bottom,
      editorWidth: editorRect.width,
      editorHeight: editorRect.height,
      inputWidth: inputRect.width,
      zIndex: style.zIndex,
    };
  });
  expect(activeStyle.background).toBe("rgb(255, 255, 255)");
  expect(activeStyle.borderTopWidth).not.toBe("0px");
  expect(activeStyle.boxShadow).not.toBe("none");
  expect(Math.abs(activeStyle.topDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(activeStyle.leftDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(activeStyle.rightDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(activeStyle.bottomDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(activeStyle.editorWidth - activeStyle.cellWidth)).toBeLessThanOrEqual(2);
  expect(Math.abs(activeStyle.editorHeight - activeStyle.cellHeight)).toBeLessThanOrEqual(2);
  expect(activeStyle.inputWidth).toBeGreaterThan(activeStyle.cellWidth - 24);
  expect(Number(activeStyle.zIndex)).toBeGreaterThan(0);

  await editor.fill("table text edit value");
  await page.waitForTimeout(400);
  const textBeforeBlur = await readFile(path.resolve("tests/.scratch/data/e2e_wrap_rows.json"), "utf8");
  expect(textBeforeBlur).not.toContain("table text edit value");

  await editor.blur();

  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_wrap_rows.json"), "utf8");
    return text.includes("table text edit value");
  });
  await expect(editor).toHaveValue("table text edit value");
});

test("table text edit mode preserves wrapped text layout", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("data-editor:data/e2e_wrap_rows.json:$:all:description:wrapped", "1");
    localStorage.setItem("data-editor:data/e2e_wrap_rows.json:$:all:description:width", "160");
  });
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_wrap_rows.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.getByRole("button", { name: "编辑" }).click();

  const editor = tableCell(page, 0, "description").locator(".table-text-cell-editor textarea");
  await expect(editor).toBeVisible();
  await editor.fill("wrapped table edit value with enough words to span multiple visual lines");

  const layout = await tableCell(page, 0, "description").evaluate((cell) => {
    const textarea = cell.querySelector(".table-text-cell-editor textarea") as HTMLTextAreaElement;
    const editor = cell.querySelector(".table-text-cell-editor") as HTMLElement;
    const cellRect = cell.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return {
      wrapMode: cell.getAttribute("data-wrap-mode"),
      whiteSpace: getComputedStyle(textarea).whiteSpace,
      overflowWrap: getComputedStyle(textarea).overflowWrap,
      clientHeight: textarea.clientHeight,
      scrollHeight: textarea.scrollHeight,
      topDelta: editorRect.top - cellRect.top,
      leftDelta: editorRect.left - cellRect.left,
      rightDelta: editorRect.right - cellRect.right,
      bottomDelta: editorRect.bottom - cellRect.bottom,
      editorHeight: editorRect.height,
      cellHeight: cellRect.height,
      editorWidth: editorRect.width,
      cellWidth: cellRect.width,
    };
  });

  expect(layout.wrapMode).toBe("wrap");
  expect(layout.whiteSpace).toBe("pre-wrap");
  expect(["anywhere", "break-word"]).toContain(layout.overflowWrap);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
  expect(Math.abs(layout.topDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.leftDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.rightDelta)).toBeLessThanOrEqual(1);
  expect(layout.cellHeight).toBeGreaterThan(72);
  expect(Math.abs(layout.editorHeight - layout.cellHeight)).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.bottomDelta)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.editorWidth - layout.cellWidth)).toBeLessThanOrEqual(2);
});

test("wrapped table text editor expands beyond the base cell height while editing", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_wrapped_text_editor_growth.json");
  await writeFile(dataPath, JSON.stringify([
    {
      title: "Growth row",
      description: "短文本"
    }
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/e2e_wrapped_text_editor_growth.json:$:all:description:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_wrapped_text_editor_growth.json:$:all:description:width", "150");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_wrapped_text_editor_growth.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();
    await page.getByRole("button", { name: "编辑" }).click();

    const editor = tableCell(page, 0, "description").locator(".table-text-cell-editor textarea");
    await expect(editor).toBeVisible();
    await editor.fill("向射程4格内的目标位置发射火球，对1格圆形范围内造成对射程燃烧的单体目标造成高额伤害并附加持续灼烧效果。");

    const growth = await tableCell(page, 0, "description").evaluate((cell) => {
      const textarea = cell.querySelector(".table-text-cell-editor textarea") as HTMLTextAreaElement;
      const editorFrame = cell.querySelector(".table-text-cell-editor") as HTMLElement;
      const cellRect = cell.getBoundingClientRect();
      const frameRect = editorFrame.getBoundingClientRect();
      return {
        cellHeight: cellRect.height,
        frameHeight: frameRect.height,
        textareaHeight: textarea.getBoundingClientRect().height,
        scrollHeight: textarea.scrollHeight,
        topDelta: frameRect.top - cellRect.top,
        bottomOverflow: frameRect.bottom - cellRect.bottom,
      };
    });

    expect(growth.cellHeight).toBeGreaterThan(80);
    expect(Math.abs(growth.frameHeight - growth.cellHeight)).toBeLessThanOrEqual(2);
    expect(growth.textareaHeight).toBeGreaterThan(growth.cellHeight - 24);
    expect(growth.scrollHeight).toBeLessThanOrEqual(growth.textareaHeight + 1);
    expect(Math.abs(growth.topDelta)).toBeLessThanOrEqual(1);
    expect(Math.abs(growth.bottomOverflow)).toBeLessThanOrEqual(1);
  } finally {
    await bestEffortRestore("e2e_wrapped_text_editor_growth.json", () => rm(dataPath, { force: true }));
  }
});

test("wrapped table text edit keeps the row height instead of collapsing to one line", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_wrapped_text_editor_row_height.json");
  await writeFile(dataPath, JSON.stringify([
    {
      title: "Height row",
      description: "向射程4格内的目标位置发射火球，对1格圆形范围内造成45点火焰伤害，使目标灼烧2回合。在命中位置产生燃烧地形持续2回合。消耗2AP和15法力。"
    }
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/e2e_wrapped_text_editor_row_height.json:$:all:description:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_wrapped_text_editor_row_height.json:$:all:description:width", "150");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_wrapped_text_editor_row_height.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await page.getByRole("button", { name: "编辑" }).click();

  const cell = tableCell(page, 0, "description");
  const beforeEdit = await cell.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { height: rect.height };
  });

  const editor = cell.locator(".table-text-cell-editor textarea");
  await expect(editor).toBeVisible();
  await editor.fill("向射程4格内的目标位置发射火球，对1格圆形范围内造成45点火焰伤害，使目标灼烧2回合。在命中位置产生燃烧地形持续2回合。消耗2AP和15法力。");

  const duringEdit = await cell.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const editorFrame = node.querySelector(".table-text-cell-editor") as HTMLElement;
    const frameRect = editorFrame.getBoundingClientRect();
    return {
      height: rect.height,
      frameHeight: frameRect.height,
      bottomOverflow: frameRect.bottom - rect.bottom,
    };
  });

  expect(beforeEdit.height).toBeGreaterThan(80);
  expect(Math.abs(duringEdit.height - beforeEdit.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(duringEdit.frameHeight - duringEdit.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(duringEdit.bottomOverflow)).toBeLessThanOrEqual(1);
  } finally {
    await bestEffortRestore("e2e_wrapped_text_editor_row_height.json", () => rm(dataPath, { force: true }));
  }
});

test("toggling table text edit mode does not reflow wrapped row heights", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_toggle_edit_height_stability.json");
  await writeFile(dataPath, JSON.stringify([
    {
      title: "Stable row",
      description: "向射程4格内的目标位置发射火球，对1格圆形范围内造成45点火焰伤害，使目标灼烧2回合。在命中位置产生燃烧地形持续2回合。消耗2AP和15法力。"
    }
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/e2e_toggle_edit_height_stability.json:$:all:description:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_toggle_edit_height_stability.json:$:all:description:width", "150");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_toggle_edit_height_stability.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    const beforeToggle = await tableCell(page, 0, "description").evaluate((node) => ({
      height: node.getBoundingClientRect().height,
    }));

    await page.getByRole("button", { name: "编辑" }).click();

    const afterToggle = await tableCell(page, 0, "description").evaluate((node) => ({
      height: node.getBoundingClientRect().height,
    }));

    expect(beforeToggle.height).toBeGreaterThan(80);
    expect(Math.abs(afterToggle.height - beforeToggle.height)).toBeLessThanOrEqual(2);
  } finally {
    await bestEffortRestore("e2e_toggle_edit_height_stability.json", () => rm(dataPath, { force: true }));
  }
});

test("table text edit active frame fills a tall cell", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_tall_text_cell.json");
  await writeFile(dataPath, JSON.stringify([
    {
      title: "Tall row",
      short_text: "命中率+10%，暴击率+3%",
      long_text: "这是一段用来撑高同行单元格的长文本，开启自动换行后会占用多行高度，从而验证短文本编辑框是否能贴合整个单元格上下边界。"
    }
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/e2e_tall_text_cell.json:$:all:long_text:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_tall_text_cell.json:$:all:long_text:width", "120");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_tall_text_cell.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();
    await page.getByRole("button", { name: "编辑" }).click();

    const editor = tableCell(page, 0, "short_text").locator(".table-text-cell-editor input");
    await expect(editor).toBeVisible();
    await editor.click();

    const frame = await tableCell(page, 0, "short_text").evaluate((cell) => {
      const editorFrame = cell.querySelector(".table-text-cell-editor") as HTMLElement;
      const cellRect = cell.getBoundingClientRect();
      const frameRect = editorFrame.getBoundingClientRect();
      return {
        cellHeight: cellRect.height,
        frameHeight: frameRect.height,
        topDelta: frameRect.top - cellRect.top,
        bottomDelta: frameRect.bottom - cellRect.bottom,
      };
    });

    expect(frame.cellHeight).toBeGreaterThan(48);
    expect(Math.abs(frame.topDelta)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.bottomDelta)).toBeLessThanOrEqual(2);
    expect(Math.abs(frame.frameHeight - frame.cellHeight)).toBeLessThanOrEqual(2);
  } finally {
    await bestEffortRestore("e2e_tall_text_cell.json", () => rm(dataPath, { force: true }));
  }
});

test("single line table cells use the same top inset in tall wrapped rows", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_single_line_padding.json");
  await writeFile(dataPath, JSON.stringify([
    {
      title: "Padding row",
      short_text: "每回合第2次攻击伤害+30%",
      long_text: "这是一段用于撑高同行的长文本。开启自动换行后，普通单行文本单元格应该和多行文本使用同一组顶部内边距。"
    }
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/e2e_single_line_padding.json:$:all:short_text:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_single_line_padding.json:$:all:short_text:width", "180");
      localStorage.setItem("data-editor:data/e2e_single_line_padding.json:$:all:long_text:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_single_line_padding.json:$:all:long_text:width", "120");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_single_line_padding.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    const padding = await tableCell(page, 0, "short_text").evaluate((cell) => {
      const content = cell.querySelector('[data-cell-role="content"] span') as HTMLElement;
      const cellRect = cell.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        wrapMode: cell.getAttribute("data-wrap-mode"),
        cellHeight: cellRect.height,
        topGap: contentRect.top - cellRect.top,
        bottomGap: cellRect.bottom - contentRect.bottom,
      };
    });

    expect(padding.wrapMode).toBe("wrap");
    expect(padding.cellHeight).toBeGreaterThan(48);
    expect(padding.topGap).toBeGreaterThanOrEqual(7);
    expect(padding.topGap).toBeLessThanOrEqual(10);
    expect(padding.bottomGap).toBeGreaterThan(padding.topGap + 8);
  } finally {
    await bestEffortRestore("e2e_single_line_padding.json", () => rm(dataPath, { force: true }));
  }
});

test("title, chip and text share the same top inset in the same tall row", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_cell_layout_alignment.json");
  await writeFile(dataPath, JSON.stringify([
    {
      title: "燃烧之心",
      status: "element",
      description: "火焰技能暴击率+10%",
      long_text: "这是一段用于撑高同行的长文本。开启自动换行后，标题、选项 chip 和普通文本应该统一贴齐同一组顶部内边距。"
    }
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("data-editor:data/e2e_cell_layout_alignment.json:$:all:long_text:wrapped", "1");
      localStorage.setItem("data-editor:data/e2e_cell_layout_alignment.json:$:all:long_text:width", "120");
    });
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_cell_layout_alignment.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await columnHeaderTrigger(page, "status").click();
    await expect(page.locator('.column-menu-popup [data-field-type="Select"]')).toBeVisible();
    await page.locator('.column-menu-popup [data-field-type="Select"]').click();
    await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_cell_layout_alignment.json:$:status"') && text.includes('"type": "Select"'));

    const geometry = await page.evaluate(() => {
      const titleCell = document.querySelector('td[data-column-field="title"]') as HTMLElement;
      const titleText = titleCell?.querySelector('[data-cell-role="title-text"]') as HTMLElement;
      const statusCell = document.querySelector('td[data-column-field="status"]') as HTMLElement;
      const statusChip = statusCell?.querySelector(".multi-select-trigger .chip") as HTMLElement;
      const descriptionCell = document.querySelector('td[data-column-field="description"]') as HTMLElement;
      const descriptionText = descriptionCell?.querySelector('[data-cell-role="content"] span') as HTMLElement;
      if (!titleCell || !titleText || !statusCell || !statusChip || !descriptionCell || !descriptionText) return null;

      return {
        rowHeight: titleCell.getBoundingClientRect().height,
        titleTopGap: titleText.getBoundingClientRect().top - titleCell.getBoundingClientRect().top,
        chipTopGap: statusChip.getBoundingClientRect().top - statusCell.getBoundingClientRect().top,
        textTopGap: descriptionText.getBoundingClientRect().top - descriptionCell.getBoundingClientRect().top,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.rowHeight ?? 0).toBeGreaterThan(48);
    expect(Math.abs((geometry?.titleTopGap ?? 99) - (geometry?.chipTopGap ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((geometry?.titleTopGap ?? 99) - (geometry?.textTopGap ?? 0))).toBeLessThanOrEqual(2);
    expect(geometry?.titleTopGap ?? 0).toBeGreaterThanOrEqual(7);
    expect(geometry?.titleTopGap ?? 99).toBeLessThanOrEqual(10);
  } finally {
    await bestEffortRestore("e2e_cell_layout_alignment.json", () => rm(dataPath, { force: true }));
  }
});

test("table text edit draft flushes before switching files", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_wrap_rows.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await page.getByRole("button", { name: "编辑" }).click();
  const editor = tableCell(page, 0, "description").locator(".table-text-cell-editor input");
  await expect(editor).toBeVisible();
  await editor.fill("flush before file switch");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_mixed.json");

  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/data/e2e_wrap_rows.json"), "utf8");
    return text.includes("flush before file switch");
  }).toBe(true);
});

test("primary key sync confirmation blocks file switching until confirmed", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_primary_key_sync_target.json"]').click();
  await ensurePrimaryKeySelection(page, "target_id");

  await page.locator('.sidebar-item[title="data/e2e_primary_key_sync_source.json"]').click();
  await configureRelation(page, "target_id", {
    targetFile: "data/e2e_primary_key_sync_target.json",
    targetCollection: "$",
    targetKey: "target_id",
    mode: "single",
  });

  await page.locator('.sidebar-item[title="data/e2e_primary_key_sync_target.json"]').click();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  const targetIdInput = page.locator(".detail-panel.primary .property-block").filter({ hasText: "target_id" }).locator(".detail-input").first();
  await targetIdInput.fill("blocked_switch");
  await page.locator('.sidebar-item[title="data/e2e_mixed.json"]').click();

  await expect(page.locator(".primary-key-sync-dialog")).toBeVisible();
  await expect(page.locator(".toolbar strong")).toContainText("data/e2e_primary_key_sync_target.json");
});

test("table text edit mode off keeps select cells interactive instead of text inputs", async ({ page }) => {
  const dataPath = path.resolve("tests/.scratch/data/e2e_select_text_edit_off.json");
  await writeFile(dataPath, JSON.stringify([
    { id: "row_1", status: "review", notes: "plain text" },
    { id: "row_2", status: "parked", notes: "other text" },
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_select_text_edit_off.json"]').click();
    await expect(page.locator(".data-table")).toBeVisible();

    await columnHeaderTrigger(page, "status").click();
    await expect(page.locator('.column-menu-popup [data-field-type="Select"]')).toBeVisible();
    await page.locator('.column-menu-popup [data-field-type="Select"]').click();
    await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select_text_edit_off.json:$:status"') && text.includes('"type": "Select"'));

    await expect(page.getByRole("button", { name: "编辑" })).toHaveAttribute("aria-pressed", "false");
    const statusCell = tableCell(page, 0, "status");
    await expect(statusCell.locator(".multi-select-trigger")).toContainText("review");
    await statusCell.locator(".multi-select-trigger").click();
    await expect(page.locator(".multi-select-popover")).toBeVisible();
    await expect(statusCell.locator(".table-text-cell-editor")).toHaveCount(0);
  } finally {
    await bestEffortRestore("e2e_select_text_edit_off.json", () => rm(dataPath, { force: true }));
  }
});

test("table text edit mode off keeps multi-select cells interactive instead of text inputs", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await expect(page.getByRole("button", { name: "编辑" })).toHaveAttribute("aria-pressed", "false");
  const featuresCell = tableCell(page, 0, "features");
  await expect(featuresCell.locator(".multi-select-trigger .chip")).toHaveCount(1);
  await featuresCell.locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await expect(featuresCell.locator(".table-text-cell-editor")).toHaveCount(0);
});

test("table text edit mode off keeps relation cells interactive instead of text inputs", async ({ page }) => {
  const targetPath = path.resolve("tests/.scratch/data/e2e_relation_text_edit_target.json");
  const sourcePath = path.resolve("tests/.scratch/data/e2e_relation_text_edit_source.json");
  await writeFile(targetPath, JSON.stringify([
    { target_id: "target_1", name: "Target Row 1" },
    { target_id: "target_2", name: "Target Row 2" },
  ], null, 2), "utf8");
  await writeFile(sourcePath, JSON.stringify([
    { id: "source_1", target_id: "target_1", notes: "plain text" },
    { id: "source_2", target_id: null, notes: "other text" },
  ], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/e2e_relation_text_edit_target.json"]').click();
    await ensurePrimaryKeySelection(page, "target_id");

    await page.locator('.sidebar-item[title="data/e2e_relation_text_edit_source.json"]').click();
    await ensurePrimaryKeySelection(page, "id");
    await configureRelation(page, "target_id", {
      targetFile: "data/e2e_relation_text_edit_target.json",
      targetCollection: "$",
      targetKey: "target_id",
      mode: "single",
    });

    await expect(page.getByRole("button", { name: "编辑" })).toHaveAttribute("aria-pressed", "false");
    const relationCell = tableCell(page, 0, "target_id");
    await expect(relationCell.locator(".multi-select-trigger")).toContainText("Target Row 1");
    await relationCell.locator(".multi-select-trigger").click();
    await expect(page.locator(".relation-popover")).toBeVisible();
    await expect(relationCell.locator(".table-text-cell-editor")).toHaveCount(0);
  } finally {
    await bestEffortRestore("e2e_relation_text_edit_target.json", () => rm(targetPath, { force: true }));
    await bestEffortRestore("e2e_relation_text_edit_source.json", () => rm(sourcePath, { force: true }));
  }
});

test("title and nested cells keep full-cell whitespace click targets", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await clickCellWhitespace(page, 0, "name");
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await clickCellWhitespace(page, 0, "effects");
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
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

    await columnHeaderTrigger(page, "status").click();
    await expect(page.locator('.column-menu-popup [data-field-type="Select"]')).toBeVisible();
    await page.locator('.column-menu-popup [data-field-type="Select"]').click();
    await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select_title_fallback.json:$:status"') && text.includes('"type": "Select"'));

    await expect(tableRow(page, 0).locator(".multi-select-trigger")).toContainText("review");
    await expect(tableRow(page, 0).locator(".multi-select-trigger .chip")).toBeVisible();

    await dragColumnHeader(page, "status", "id");

    expect((await getColumnHeaderOrder(page))[0]).toBe("status");
    const firstDataCell = tableRow(page, 0).locator('td[data-column-field="status"]');
    await expect(firstDataCell.locator(".multi-select-trigger")).toContainText("review");
    await expect(firstDataCell.locator(".multi-select-trigger .chip")).toBeVisible();
    await expect(firstDataCell.locator('[data-cell-role="title"]')).toHaveCount(0);
  } finally {
    await bestEffortRestore("e2e_select_title_fallback.json", () => rm(dataPath, { force: true }));
  }
});

test("column header drag previews reordered headers before drop and persists only on release", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const before = await getColumnHeaderOrder(page);
  expect(before.slice(0, 3)).toEqual(["rune_name", "description", "description_zh"]);

  await beginColumnHeaderDrag(page, "description_zh");
  await expect(page.locator(".column-drag-ghost")).toBeVisible();
  await moveColumnHeaderDrag(page, "rune_name");

  const preview = await getColumnHeaderOrder(page);
  expect(preview.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);

  const storedBeforeDrop = await page.evaluate(() => localStorage.getItem("data-editor:data/runes.json:$:all:__order"));
  expect(storedBeforeDrop ?? "").not.toContain("description_zh,rune_name,description");

  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:data/runes.json:$:all:__order"))).toContain("description_zh,rune_name,description");
  const after = await getColumnHeaderOrder(page);
  expect(after.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);
});

test("column header pointercancel rolls back preview without committing order", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const before = await getColumnHeaderOrder(page);
  expect(before.slice(0, 3)).toEqual(["rune_name", "description", "description_zh"]);

  await beginColumnHeaderDrag(page, "description_zh");
  await expect(page.locator(".column-drag-ghost")).toBeVisible();
  await moveColumnHeaderDrag(page, "rune_name");

  const preview = await getColumnHeaderOrder(page);
  expect(preview.slice(0, 3)).toEqual(["description_zh", "rune_name", "description"]);

  await cancelColumnHeaderDrag(page);
  await expect(page.locator(".column-drag-ghost")).toHaveCount(0);

  const after = await getColumnHeaderOrder(page);
  expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
  expect(await page.evaluate(() => localStorage.getItem("data-editor:data/runes.json:$:all:__order"))).toBeNull();
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

test("sidebar renders folder tree", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_sidebar_tree");
  const alphaPath = path.join(folderRoot, "alpha.json");
  const betaPath = path.join(folderRoot, "nested", "beta.json");
  await mkdir(path.dirname(alphaPath), { recursive: true });
  await mkdir(path.dirname(betaPath), { recursive: true });
  await writeFile(alphaPath, JSON.stringify([{ id: "alpha_1", name: "Alpha" }], null, 2), "utf8");
  await writeFile(betaPath, JSON.stringify([{ id: "beta_1", name: "Beta" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(sidebarTreeNode(page, "folder", "e2e_sidebar_tree")).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_tree/alpha.json"]')).toBeVisible();
    await expect(sidebarTreeNode(page, "folder", "nested")).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_tree/nested/beta.json"]')).toBeVisible();

    await toggleSidebarTreeNode(page, "folder", "nested");
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_tree/nested/beta.json"]')).toHaveCount(0);
    await page.locator('.sidebar-item[title="data/runes.json"]').click();
    await expect(page.locator(".toolbar strong")).toContainText("data/runes.json");
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_tree/nested/beta.json"]')).toHaveCount(0);

    await toggleSidebarTreeNode(page, "folder", "nested");
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_tree/nested/beta.json"]')).toBeVisible();
  } finally {
    await bestEffortRestore("e2e_sidebar_tree", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("sidebar tree label alignment stays stable across row types and expansion states", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_label_alignment");
  const rootFilePath = path.join(folderRoot, "root.json");
  const nestedFolderPath = path.join(folderRoot, "nested");
  const nestedFilePath = path.join(nestedFolderPath, "child.json");
  await mkdir(path.dirname(rootFilePath), { recursive: true });
  await mkdir(nestedFolderPath, { recursive: true });
  await writeFile(rootFilePath, JSON.stringify([{ id: "root_1", name: "Root" }], null, 2), "utf8");
  await writeFile(nestedFilePath, JSON.stringify([{ id: "child_1", name: "Child" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(sidebarTreeNode(page, "folder", "e2e_label_alignment")).toBeVisible();
    await expect(sidebarTreeNode(page, "file", "root.json")).toBeVisible();
    await expect(sidebarTreeNode(page, "folder", "nested")).toBeVisible();

    await expectSidebarTreeLabelStartsAligned(page, [
      { kind: "file", label: "root.json" },
      { kind: "folder", label: "nested" },
    ]);
    const rootFileControl = await getSidebarTreeSlotBox(page, "file", "root.json", "control");
    const nestedFolderControl = await getSidebarTreeSlotBox(page, "folder", "nested", "control");
    expect(Math.abs(Math.round(rootFileControl.x - nestedFolderControl.x))).toBeLessThanOrEqual(1);

    const nestedLabelStartBeforeCollapse = await getSidebarTreeLabelStart(page, "file", "child.json");
    await toggleSidebarTreeNode(page, "folder", "nested");
    await expect(sidebarTreeNode(page, "file", "child.json")).toHaveCount(0);
    await toggleSidebarTreeNode(page, "folder", "nested");
    await expect(sidebarTreeNode(page, "file", "child.json")).toBeVisible();
    const nestedLabelStartAfterExpand = await getSidebarTreeLabelStart(page, "file", "child.json");
    expect(Math.abs(nestedLabelStartAfterExpand - nestedLabelStartBeforeCollapse)).toBeLessThanOrEqual(1);

    await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/skills.json"]')).toBeVisible();
    await expect(sidebarTreeSection(page).locator('[data-sidebar-node-kind="source"]')).toHaveCount(0);
    await expectSidebarTreeLabelStartsAligned(page, [
      { kind: "file", label: "runes.json" },
      { kind: "file", label: "skills.json" },
    ]);
  } finally {
    await bestEffortRestore("e2e_label_alignment", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("sidebar tree rows keep a consistent slot skeleton across source folder and file kinds", async ({ page }) => {
  const registry = {
    version: 1,
    activeProjectId: "multi-source-project",
    projects: [{
      id: "multi-source-project",
      name: "Multi Source Project",
      root: "C:\\Code\\DataEditorFixture",
      adapter: "nocturnel",
      dataSources: [
        { id: "data", label: "Data", kind: "relative", path: "data" },
        { id: "mods", label: "Mods", kind: "relative", path: "mods" },
      ],
      filePolicy: { includeExtensions: [".json"] },
    }],
  };
  const files = [
    {
      path: "data/e2e_slot_contract/alpha.json",
      displayPath: "e2e_slot_contract/alpha.json",
      dataSourceId: "data",
      dataSourceLabel: "Data",
      size: 12,
      modifiedAt: "2026-06-10T00:00:00.000Z",
    },
    {
      path: "mods/omega.json",
      displayPath: "omega.json",
      dataSourceId: "mods",
      dataSourceLabel: "Mods",
      size: 12,
      modifiedAt: "2026-06-10T00:00:00.000Z",
    },
  ];
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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(files) });
  });
  await page.route("**/api/view-config?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(viewConfig) });
  });
  await page.route("**/api/view-profiles?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/shared-views?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, collections: {} }) });
  });
  await page.route("**/api/document?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "row_1", name: "Row 1" }]) });
  });

  await page.goto("/");
  await expect(sidebarTreeNode(page, "source", "Data")).toBeVisible();
  await expect(sidebarTreeNode(page, "folder", "e2e_slot_contract")).toBeVisible();
  await expect(sidebarTreeNode(page, "file", "alpha.json")).toBeVisible();

  const sourceRow = await getSidebarTreeRowSlots(page, "source", "Data");
  const folderRow = await getSidebarTreeRowSlots(page, "folder", "e2e_slot_contract");
  const fileRow = await getSidebarTreeRowSlots(page, "file", "alpha.json");

  expect(sourceRow.slotNames).toEqual(["indent", "control", "label", "trailing"]);
  expect(folderRow.slotNames).toEqual(sourceRow.slotNames);
  expect(fileRow.slotNames).toEqual(sourceRow.slotNames);

  expect(sourceRow.slots.find((slot) => slot.name === "control")?.className).toContain("is-present");
  expect(folderRow.slots.find((slot) => slot.name === "control")?.className).toContain("is-present");
  expect(fileRow.slots.find((slot) => slot.name === "control")?.className).toContain("is-present");
  expect(sourceRow.slots.find((slot) => slot.name === "trailing")?.text).toBe("");
  expect(folderRow.slots.find((slot) => slot.name === "trailing")?.text).toBe("");
  expect(fileRow.slots.find((slot) => slot.name === "trailing")?.text).toBe("");

  const folderControl = await getSidebarTreeSlotBox(page, "folder", "e2e_slot_contract", "control");
  const folderLabel = await getSidebarTreeSlotBox(page, "folder", "e2e_slot_contract", "label");
  expect(Math.round(folderLabel.x - (folderControl.x + folderControl.width))).toBeLessThanOrEqual(2);

  const fileControl = await getSidebarTreeSlotBox(page, "file", "alpha.json", "control");
  expect(Math.round(fileControl.width)).toBe(Math.round(folderControl.width));
});

test("sidebar drag reorder only works among siblings", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_sidebar_drag");
  const alphaPath = path.join(folderRoot, "alpha.json");
  const betaPath = path.join(folderRoot, "beta.json");
  const foreignFolder = path.join(folderRoot, "other");
  const gammaPath = path.join(foreignFolder, "gamma.json");
  await mkdir(path.dirname(alphaPath), { recursive: true });
  await mkdir(path.dirname(gammaPath), { recursive: true });
  await writeFile(alphaPath, JSON.stringify([{ id: "alpha_1", name: "Alpha" }], null, 2), "utf8");
  await writeFile(betaPath, JSON.stringify([{ id: "beta_1", name: "Beta" }], null, 2), "utf8");
  await writeFile(gammaPath, JSON.stringify([{ id: "gamma_1", name: "Gamma" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await dragSidebarFile(page, "data/e2e_sidebar_drag/beta.json", "data/e2e_sidebar_drag/alpha.json", "before");
    await expect.poll(async () => {
      const order = await getSidebarFileOrder(page);
      return order.indexOf("data/e2e_sidebar_drag/beta.json") - order.indexOf("data/e2e_sidebar_drag/alpha.json");
    }).toBeLessThan(0);

    const orderAfterSiblingDrag = await getSidebarFileOrder(page);
    expect(orderAfterSiblingDrag.indexOf("data/e2e_sidebar_drag/beta.json")).toBeLessThan(orderAfterSiblingDrag.indexOf("data/e2e_sidebar_drag/alpha.json"));
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_drag/other/gamma.json"]')).toBeVisible();

    await beginSidebarFileDrag(page, "data/e2e_sidebar_drag/beta.json");
    await moveSidebarFileDrag(page, "data/e2e_sidebar_drag/other/gamma.json", "before");
    await releaseSidebarFileDrag(page);

    const orderAfterCrossParentAttempt = await getSidebarFileOrder(page);
    expect(orderAfterCrossParentAttempt).toEqual(orderAfterSiblingDrag);
  } finally {
    await bestEffortRestore("e2e_sidebar_drag", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("sidebar drag reorder preserves folder positions in mixed sibling trees", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_sidebar_mixed_sibling");
  const alphaPath = path.join(folderRoot, "alpha.json");
  const betaPath = path.join(folderRoot, "beta.json");
  const nestedFolder = path.join(folderRoot, "nested");
  const gammaPath = path.join(nestedFolder, "gamma.json");
  await mkdir(path.dirname(alphaPath), { recursive: true });
  await mkdir(nestedFolder, { recursive: true });
  await writeFile(alphaPath, JSON.stringify([{ id: "alpha_1", name: "Alpha" }], null, 2), "utf8");
  await writeFile(betaPath, JSON.stringify([{ id: "beta_1", name: "Beta" }], null, 2), "utf8");
  await writeFile(gammaPath, JSON.stringify([{ id: "gamma_1", name: "Gamma" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(sidebarTreeNode(page, "folder", "e2e_sidebar_mixed_sibling")).toBeVisible();
    await expect(sidebarTreeNode(page, "file", "alpha.json")).toBeVisible();
    await expect(sidebarTreeNode(page, "folder", "nested")).toBeVisible();
    await expect(sidebarTreeNode(page, "file", "beta.json")).toBeVisible();
    const initialMixedRows = (await getSidebarTreeVisibleRowSnapshot(page))
      .filter((row) => row.title.includes("data/e2e_sidebar_mixed_sibling/") || row.label === "nested")
      .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    const initialFolderIndex = initialMixedRows.indexOf("folder:nested");
    expect(initialFolderIndex).toBeGreaterThanOrEqual(0);

    await dragSidebarFile(page, "data/e2e_sidebar_mixed_sibling/beta.json", "data/e2e_sidebar_mixed_sibling/alpha.json", "before");

    await expect.poll(async () => {
      const rows = await getSidebarTreeVisibleRowSnapshot(page);
      const mixedRows = rows.filter((row) => row.title.includes("data/e2e_sidebar_mixed_sibling/") || row.label === "nested");
      return mixedRows.map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    }).toEqual(expect.arrayContaining([
      "data/e2e_sidebar_mixed_sibling/beta.json",
      "data/e2e_sidebar_mixed_sibling/alpha.json",
      "folder:nested",
      "data/e2e_sidebar_mixed_sibling/nested/gamma.json",
    ]));

    const reorderedMixedRows = (await getSidebarTreeVisibleRowSnapshot(page))
      .filter((row) => row.title.includes("data/e2e_sidebar_mixed_sibling/") || row.label === "nested")
      .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    expect(reorderedMixedRows.indexOf("folder:nested")).toBe(initialFolderIndex);
    expect(reorderedMixedRows.indexOf("data/e2e_sidebar_mixed_sibling/beta.json")).toBeLessThan(
      reorderedMixedRows.indexOf("data/e2e_sidebar_mixed_sibling/alpha.json"),
    );

    await expect.poll(() => readLocalSidebarTreePrefsRaw(page)).toContain("\"childOrderByParent\"");

    await page.reload();
    await expect(sidebarTreeNode(page, "folder", "nested")).toBeVisible();
    const reloadedMixedRows = (await getSidebarTreeVisibleRowSnapshot(page))
      .filter((row) => row.title.includes("data/e2e_sidebar_mixed_sibling/") || row.label === "nested")
      .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    expect(reloadedMixedRows.indexOf("folder:nested")).toBe(initialFolderIndex);
    expect(reloadedMixedRows.indexOf("data/e2e_sidebar_mixed_sibling/beta.json")).toBeLessThan(
      reloadedMixedRows.indexOf("data/e2e_sidebar_mixed_sibling/alpha.json"),
    );
  } finally {
    await bestEffortRestore("e2e_sidebar_mixed_sibling", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("sidebar drag reorder supports folders among same-level files", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_sidebar_folder_drag");
  const alphaPath = path.join(folderRoot, "aaa_folder_drag.json");
  const zetaPath = path.join(folderRoot, "zzz_folder_drag.json");
  const movingFolder = path.join(folderRoot, "move_me_folder_drag");
  const gammaPath = path.join(movingFolder, "gamma.json");
  await mkdir(path.dirname(alphaPath), { recursive: true });
  await mkdir(movingFolder, { recursive: true });
  await writeFile(alphaPath, JSON.stringify([{ id: "alpha_1", name: "Alpha" }], null, 2), "utf8");
  await writeFile(zetaPath, JSON.stringify([{ id: "zeta_1", name: "Zeta" }], null, 2), "utf8");
  await writeFile(gammaPath, JSON.stringify([{ id: "gamma_1", name: "Gamma" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(sidebarTreeNode(page, "folder", "move_me_folder_drag")).toBeVisible();
    await expect(sidebarTreeNode(page, "file", "aaa_folder_drag.json")).toBeVisible();
    const initialRows = (await getSidebarTreeVisibleRowSnapshot(page))
      .filter((row) => row.title.includes("data/e2e_sidebar_folder_drag/") || row.label === "move_me_folder_drag")
      .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    expect(initialRows.indexOf("folder:move_me_folder_drag")).toBeGreaterThan(
      initialRows.indexOf("data/e2e_sidebar_folder_drag/aaa_folder_drag.json"),
    );

    await dragSidebarNode(
      page,
      { kind: "folder", label: "move_me_folder_drag" },
      { kind: "file", label: "aaa_folder_drag.json" },
      "before",
    );

    await expect.poll(async () => {
      const rows = await getSidebarTreeVisibleRowSnapshot(page);
      return rows
        .filter((row) => row.title.includes("data/e2e_sidebar_folder_drag/") || row.label === "move_me_folder_drag")
        .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    }).toEqual(expect.arrayContaining([
      "folder:move_me_folder_drag",
      "data/e2e_sidebar_folder_drag/aaa_folder_drag.json",
      "data/e2e_sidebar_folder_drag/zzz_folder_drag.json",
    ]));

    const reorderedRows = (await getSidebarTreeVisibleRowSnapshot(page))
      .filter((row) => row.title.includes("data/e2e_sidebar_folder_drag/") || row.label === "move_me_folder_drag")
      .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    expect(reorderedRows.indexOf("folder:move_me_folder_drag")).toBeLessThan(
      reorderedRows.indexOf("data/e2e_sidebar_folder_drag/aaa_folder_drag.json"),
    );
    await expect.poll(() => readLocalSidebarTreePrefsRaw(page)).toContain("\"childOrderByParent\"");

    await page.reload();
    await expect(sidebarTreeNode(page, "folder", "move_me_folder_drag")).toBeVisible();
    const reloadedRows = (await getSidebarTreeVisibleRowSnapshot(page))
      .filter((row) => row.title.includes("data/e2e_sidebar_folder_drag/") || row.label === "move_me_folder_drag")
      .map((row) => row.kind === "file" ? row.title : `${row.kind}:${row.label}`);
    expect(reloadedRows.indexOf("folder:move_me_folder_drag")).toBeLessThan(
      reloadedRows.indexOf("data/e2e_sidebar_folder_drag/aaa_folder_drag.json"),
    );
  } finally {
    await bestEffortRestore("e2e_sidebar_folder_drag", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("sidebar drag reorder does not commit a stale preview when released back on the source row", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_sidebar_drag_return_to_source");
  const alphaPath = path.join(folderRoot, "alpha.json");
  const betaPath = path.join(folderRoot, "beta.json");
  const gammaPath = path.join(folderRoot, "gamma.json");
  await mkdir(path.dirname(alphaPath), { recursive: true });
  await writeFile(alphaPath, JSON.stringify([{ id: "alpha_1", name: "Alpha" }], null, 2), "utf8");
  await writeFile(betaPath, JSON.stringify([{ id: "beta_1", name: "Beta" }], null, 2), "utf8");
  await writeFile(gammaPath, JSON.stringify([{ id: "gamma_1", name: "Gamma" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_drag_return_to_source/alpha.json"]')).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_drag_return_to_source/beta.json"]')).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_drag_return_to_source/gamma.json"]')).toBeVisible();

    const initialOrder = (await getSidebarFileOrder(page)).filter((item) => item.startsWith("data/e2e_sidebar_drag_return_to_source/"));
    expect(initialOrder).toEqual([
      "data/e2e_sidebar_drag_return_to_source/alpha.json",
      "data/e2e_sidebar_drag_return_to_source/beta.json",
      "data/e2e_sidebar_drag_return_to_source/gamma.json",
    ]);
    const sourceRowCenter = await getSidebarFileRowCenter(page, "data/e2e_sidebar_drag_return_to_source/beta.json");

    await beginSidebarFileDrag(page, "data/e2e_sidebar_drag_return_to_source/beta.json");
    await moveSidebarFileDrag(page, "data/e2e_sidebar_drag_return_to_source/alpha.json", "before");
    await expect.poll(async () => {
      const order = await getSidebarFileOrder(page);
      return order.filter((item) => item.startsWith("data/e2e_sidebar_drag_return_to_source/"));
    }).toEqual([
      "data/e2e_sidebar_drag_return_to_source/beta.json",
      "data/e2e_sidebar_drag_return_to_source/alpha.json",
      "data/e2e_sidebar_drag_return_to_source/gamma.json",
    ]);

    await moveSidebarFileDragToPoint(page, sourceRowCenter);
    await releaseSidebarFileDrag(page);

    const finalOrder = (await getSidebarFileOrder(page)).filter((item) => item.startsWith("data/e2e_sidebar_drag_return_to_source/"));
    expect(finalOrder).toEqual(initialOrder);
    await expect.poll(() => readLocalSidebarTreePrefsRaw(page)).toBeNull();
  } finally {
    await bestEffortRestore("e2e_sidebar_drag_return_to_source", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("sidebar expanded state writes only explicit prefs and clears them when returning to default", async ({ page }) => {
  const folderRoot = path.resolve("tests/.scratch/data/e2e_sidebar_expanded_state");
  const alphaPath = path.join(folderRoot, "alpha.json");
  const nestedPath = path.join(folderRoot, "nested", "beta.json");
  await mkdir(path.dirname(alphaPath), { recursive: true });
  await mkdir(path.dirname(nestedPath), { recursive: true });
  await writeFile(alphaPath, JSON.stringify([{ id: "alpha_1", name: "Alpha" }], null, 2), "utf8");
  await writeFile(nestedPath, JSON.stringify([{ id: "beta_1", name: "Beta" }], null, 2), "utf8");

  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(sidebarTreeNode(page, "folder", "nested")).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_expanded_state/nested/beta.json"]')).toBeVisible();
    await expect.poll(() => readLocalSidebarTreePrefsRaw(page)).toBeNull();

    await toggleSidebarTreeNode(page, "folder", "nested");
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_expanded_state/nested/beta.json"]')).toHaveCount(0);
    await expect.poll(async () => {
      const raw = await readLocalSidebarTreePrefsRaw(page);
      return raw ? JSON.parse(raw) : null;
    }).toMatchObject({
      expandedNodeIds: expect.not.arrayContaining(["folder:data/e2e_sidebar_expanded_state/nested"]),
    });

    await page.reload();

    await expect(sidebarTreeNode(page, "folder", "nested")).toBeVisible();
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_expanded_state/nested/beta.json"]')).toHaveCount(0);

    await toggleSidebarTreeNode(page, "folder", "nested");
    await expect(page.locator('.sidebar-file-item[title="data/e2e_sidebar_expanded_state/nested/beta.json"]')).toBeVisible();
    await expect.poll(() => readLocalSidebarTreePrefsRaw(page)).toBeNull();
  } finally {
    await bestEffortRestore("e2e_sidebar_expanded_state", () => rm(folderRoot, { recursive: true, force: true }));
  }
});

test("single data source hides the source row", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();
  await expect(sidebarTreeSection(page).locator('[data-sidebar-node-kind="source"]')).toHaveCount(0);
});

test("detail panel width can be resized and property spacing stays compact", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/runes.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await expect.poll(async () => page.locator(".detail-panel.primary").evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(widthAfterResize);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:detail-panel-width"))).toBe(null);
});

test("clicking outside detail panels closes primary and nested detail panels", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  expect(await page.locator(".multi-select-popover .selected-chip").count()).toBeGreaterThan(0);
  await page.locator(".multi-select-popover").press("Escape");

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select.json:$:category"') && text.includes('"type": "Select"'));
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const categoryBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "category" }),
  });
  await expect(categoryBlock.locator(".multi-select-trigger")).toBeVisible();
  await expect(categoryBlock.locator(".multi-select-trigger")).toHaveAttribute("data-cell-role", "detail-trigger");
  await expect(categoryBlock.locator(".multi-select-trigger")).toHaveAttribute("data-wrap-mode", "truncate");
  await expect(categoryBlock.locator(".multi-select-trigger .chip")).toHaveCount(1);
  await categoryBlock.locator(".multi-select-trigger").evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(".multi-select-popover")).toBeVisible();
  await expect(page.locator(".multi-select-popover .selected-chip")).toHaveCount(1);
});

test("detail panel textarea height follows actual text content", async ({ page }) => {
  await page.goto("/");

  await page.locator('.sidebar-item[title="data/e2e_wrap_rows.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  const descriptionTextarea = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "description" }),
  }).locator("textarea.detail-textarea");
  await expect(descriptionTextarea).toHaveCount(1);
  const shortHeight = await descriptionTextarea.evaluate((element) => Math.round((element as HTMLTextAreaElement).getBoundingClientRect().height));
  expect(shortHeight).toBeLessThanOrEqual(60);

  await tableRow(page, 1).evaluate((element) => (element as HTMLTableRowElement).click());
  const longHeight = await descriptionTextarea.evaluate((element) => Math.round((element as HTMLTextAreaElement).getBoundingClientRect().height));
  expect(longHeight).toBeGreaterThan(shortHeight + 20);
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
  await tableRow(page, 0).locator("td").nth(devTagsColumnIndex + 1).locator(".multi-select-trigger").click();

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
  await expect(tableRow(page, 0).locator('td[data-column-field="dev_tags"] .multi-select-trigger')).toHaveAttribute("data-wrap-mode", "truncate");
});

test("non-wrapped option field chips use a clipped single-line strip like notion", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const trigger = tableRow(page, 1).locator(".multi-select-trigger");
  const chipsCell = trigger.locator(".chips-cell");
  await expect(trigger).toHaveAttribute("data-wrap-mode", "truncate");
  await expect(chipsCell).toHaveCSS("flex-wrap", "nowrap");
  await expect(chipsCell).toHaveCSS("overflow-x", "hidden");
  await expect(chipsCell.locator(".chip").first()).toHaveCSS("flex-shrink", "0");
});

test("detail panel option field editors reuse the shared popover shell", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select.json:$:category"') && text.includes('"type": "Select"'));
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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

test("detail panel headings show shared field type icons in primary and nested panels", async ({ page }) => {
  await page.goto("/");

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const featuresHeading = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "features" }),
  }).locator(".property-heading [data-field-type-icon='Multi-select']");
  await expect(featuresHeading).toHaveCount(1);
  await expect(featuresHeading).toHaveCSS("color", "rgb(179, 177, 173)");
  await expect(page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "features" }),
  }).locator(".property-heading-label")).toHaveCSS("font-weight", "600");

  const nameHeading = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "name" }),
  }).locator(".property-heading [data-field-type-icon='Text']");
  await expect(nameHeading).toHaveCount(1);

  await page.locator('.sidebar-item[title="data/e2e_nested_panel.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await page.locator(".detail-panel.primary .nested-entry-button").click();
  await expect(page.locator(".detail-panel.secondary.open")).toBeVisible();
  await page.locator(".nested-item-list button").first().click();

  const effectTypeHeading = page.locator(".detail-panel.secondary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "effect_type" }),
  }).locator(".property-heading [data-field-type-icon='Text']");
  await expect(effectTypeHeading).toHaveCount(1);
  await expect(effectTypeHeading).toHaveCSS("color", "rgb(179, 177, 173)");
  await expect(page.locator(".detail-panel.secondary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "effect_type" }),
  }).locator(".property-heading-label")).toHaveCSS("font-weight", "600");
});

test("detail panel header keeps a compact gap before the first field", async ({ page }) => {
  await page.goto("/");

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const spacing = await page.evaluate(() => {
    const subtitle = document.querySelector(".detail-panel.primary .panel-subtitle") as HTMLElement | null;
    const firstHeading = document.querySelector(".detail-panel.primary .property-list .property-heading") as HTMLElement | null;
    if (!subtitle || !firstHeading) return null;
    const subtitleRect = subtitle.getBoundingClientRect();
    const firstHeadingRect = firstHeading.getBoundingClientRect();
    return Math.round(firstHeadingRect.top - subtitleRect.bottom);
  });

  expect(spacing).not.toBeNull();
  expect(spacing).toBeLessThanOrEqual(12);
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

  const relationTrigger = tableRow(page, 0).locator(".relation-trigger").first();
  const initialRelationText = ((await relationTrigger.textContent()) ?? "").trim();
  await relationTrigger.click();
  const relationPopover = page.locator(".relation-popover");
  await expect(relationPopover).toBeVisible();
  await expect(relationPopover.locator(".option-field-popover-shell")).toHaveCount(0);
  await relationPopover.locator('.relation-option[data-relation-value="skill_heavy_slash"]').click();
  await relationPopover.press("Escape");
  await expect(relationTrigger).not.toHaveText(initialRelationText);
});

test("option field editor keeps create rename color and delete actions", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  await page.locator(".multi-select-input").fill("phase2_tag");
  await page.locator(".multi-select-input").press("Enter");
  await expect(page.locator(".multi-select-popover .selected-chip").filter({ hasText: "phase2_tag" })).toBeVisible();
  await page.locator(".multi-select-input").fill("");

  const renameSource = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => (
    items.map((item) => item.textContent?.trim()).find((text) => text && text !== "phase2_tag")
  ));
  expect(renameSource).toBeTruthy();
  await page.locator(".multi-select-option-row").filter({ hasText: renameSource! }).locator(".option-menu-trigger").click();
  await expect(page.locator(".multi-select-option-editor")).toBeVisible();
  await page.locator(".multi-select-option-name-input").fill("phase2_attack");
  await page.locator(".multi-select-option-name-input").press("Enter");
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" })).toBeVisible();

  await page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" }).locator(".option-menu-trigger").click();
  await page.locator('.multi-select-color-item[data-color-choice="blue"]').click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" }).locator(".chip")).toHaveCSS("background-color", "rgb(219, 234, 254)");

  await page.locator(".multi-select-option-row").filter({ hasText: "phase2_tag" }).locator(".option-menu-trigger").click();
  await page.locator(".multi-select-option-editor .multi-select-option-action.danger").click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_tag" })).toHaveCount(0);
  await expect(page.locator(".multi-select-popover .selected-chip").filter({ hasText: "phase2_tag" })).toHaveCount(0);
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await closePopoverByClickingOutside(page);
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveIdle(page);
  await tableRow(page, 0).locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_attack" })).toBeVisible();
  await expect(page.locator(".multi-select-option-row").filter({ hasText: "phase2_tag" })).toHaveCount(0);
});

test("option field editor drag reorder updates visible chip order and persists after save", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const secondRowTrigger = tableRow(page, 1).locator(".multi-select-trigger");
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
  await expect(page.locator(".option-field-drag-ghost")).toBeVisible();
  await expect(page.locator(".option-field-drag-placeholder")).toBeVisible();
  const rowChipTextsDuringPreview = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsDuringPreview).toEqual(rowChipTextsBeforePreview);

  const selectedTextsInPopover = await page.locator(".multi-select-popover .selected-chip span:first-child").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  const selectedTextsInPopoverBeforePreview = rowChipTextsBeforePreview;
  expect(selectedTextsInPopover).toEqual(selectedTextsInPopoverBeforePreview);

  await movePointerOverOptionRow(page, farTargetValue);
  await movePointerOverOptionRow(page, targetValue);
  await expect(page.locator(".option-field-drag-ghost")).toBeVisible();
  await expect(page.locator(".option-field-drag-placeholder")).toBeVisible();

  await expect(page.locator(".dirty-pill")).toHaveCount(0);

  await endOptionHandleDrag(page, sourceValue, targetValue);
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  const rowChipTextsAfterRelease = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsAfterRelease.indexOf(sourceValue)).toBeLessThan(rowChipTextsAfterRelease.indexOf(targetValue));
  await closePopoverByClickingOutside(page);

  const rowChipTexts = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTexts.indexOf(sourceValue)).toBeLessThan(rowChipTexts.indexOf(targetValue));

  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveIdle(page);
  await page.reload();
  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const rowChipTextsAfterReload = await tableRow(page, 1).locator(".multi-select-trigger .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsAfterReload.indexOf(sourceValue)).toBeLessThan(rowChipTextsAfterReload.indexOf(targetValue));
});

test("option field editor drag cancel rolls back preview and leaves the parent row clean", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const secondRowTrigger = tableRow(page, 1).locator(".multi-select-trigger");
  await secondRowTrigger.click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  const rowChipTextsBeforePreview = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsBeforePreview.length).toBeGreaterThan(1);
  const targetValue = rowChipTextsBeforePreview[0]!;
  const sourceValue = rowChipTextsBeforePreview[1]!;

  await beginOptionHandleDrag(page, sourceValue);
  await movePointerOverOptionRow(page, targetValue);
  await expect(page.locator(".option-field-drag-ghost")).toBeVisible();
  await expect(page.locator(".option-field-drag-placeholder")).toBeVisible();

  await cancelOptionHandleDrag(page, sourceValue);

  const optionTextsAfterCancel = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsAfterCancel.indexOf(sourceValue)).toBeGreaterThan(optionTextsAfterCancel.indexOf(targetValue));

  const rowChipTextsAfterCancel = await secondRowTrigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(rowChipTextsAfterCancel).toEqual(rowChipTextsBeforePreview);
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
});

test("option field editor drag reorder also persists for single-select options", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await waitForAutosaveWrite(page, async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-config.json"), "utf8");
    return text.includes('"data/e2e_select.json:$:category"') && text.includes('"type": "Select"');
  });

  const trigger = tableRow(page, 0).locator(".multi-select-trigger");
  await trigger.click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  const optionTextsBefore = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsBefore.length).toBeGreaterThan(1);
  const targetValue = optionTextsBefore[0]!;
  const sourceValue = optionTextsBefore[1]!;

  await beginOptionHandleDrag(page, sourceValue);
  await movePointerOverOptionRow(page, targetValue);
  await expect(page.locator(".option-field-drag-ghost")).toBeVisible();
  await expect(page.locator(".option-field-drag-placeholder")).toBeVisible();
  await endOptionHandleDrag(page, sourceValue, targetValue);
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await page.locator(".multi-select-popover").press("Escape");
  await tableRow(page, 0).locator(".multi-select-trigger").click();
  const optionTextsAfterCancel = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsAfterCancel.indexOf(sourceValue)).toBeGreaterThan(optionTextsAfterCancel.indexOf(targetValue));
  await beginOptionHandleDrag(page, sourceValue);
  await movePointerOverOptionRow(page, targetValue);
  await endOptionHandleDrag(page, sourceValue, targetValue);
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await closePopoverByClickingOutside(page);
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await waitForAutosaveIdle(page);
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 0).locator(".multi-select-trigger").click();
  const optionTextsAfterReload = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsAfterReload.indexOf(sourceValue)).toBeLessThan(optionTextsAfterReload.indexOf(targetValue));
});

test("detail panel option field drag reorder commits only after parent close", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select.json:$:category"') && text.includes('"type": "Select"'));
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const categoryBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "category" }),
  });
  const trigger = categoryBlock.locator(".multi-select-trigger");
  await trigger.click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();
  const optionTextsBefore = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsBefore.length).toBeGreaterThan(1);
  const targetValue = optionTextsBefore[0]!;
  const sourceValue = optionTextsBefore[1]!;
  const triggerChipTextsBefore = await trigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  const sourceHandle = page.locator(".multi-select-option-row").filter({ hasText: sourceValue }).locator(".option-drag-handle");
  const targetRow = page.locator(".multi-select-option-row").filter({ hasText: targetValue }).first();
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2 - 10, { steps: 3 });
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height * 0.1, { steps: 8 });
  await expect(page.locator(".option-field-drag-ghost")).toBeVisible();
  await expect(page.locator(".option-field-drag-placeholder")).toBeVisible();
  const triggerChipTextsDuringPreview = await trigger.locator(".chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(triggerChipTextsDuringPreview).toEqual(triggerChipTextsBefore);

  await page.mouse.up();
  await expect(page.locator(".dirty-pill")).toHaveCount(0);
  await closePopoverByClickingOutside(page);
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
});

test("detail panel option field draft stays bound to the original row when navigating records", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  await waitForProjectConfigWrite(page, (text) => text.includes('"data/e2e_select.json:$:category"') && text.includes('"type": "Select"'));
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();

  const categoryBlock = page.locator(".detail-panel.primary .property-block").filter({
    has: page.locator(".property-heading span", { hasText: "category" }),
  });
  await categoryBlock.locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();
  await page.locator(".multi-select-input").fill("detail_row_commit_tag");
  await page.locator(".multi-select-input").press("Enter");
  await expect(page.locator(".dirty-pill")).toHaveCount(0);

  await page.locator('.detail-panel.primary button[title="Next record"]').click();
  await expect(page.locator(".detail-panel.primary .panel-subtitle")).toContainText("Row 2");
  await expect(page.locator(".dirty-pill")).toContainText("待保存");
  await expect(tableRow(page, 0).locator(".multi-select-trigger")).toContainText("detail_row_commit_tag");
  await expect(tableRow(page, 1).locator(".multi-select-trigger")).not.toContainText("detail_row_commit_tag");
});

test("option field editor drag preview uses a ghost and placeholder instead of moving the live row", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const trigger = tableRow(page, 1).locator(".multi-select-trigger");
  await trigger.click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  const optionTextsBefore = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsBefore.length).toBeGreaterThan(1);
  const targetValue = optionTextsBefore[0]!;
  const sourceValue = optionTextsBefore[1]!;

  await beginOptionHandleDrag(page, sourceValue);
  await movePointerOverOptionRow(page, targetValue);

  await expect(page.locator(".option-field-drag-ghost")).toBeVisible();
  await expect(page.locator(".option-field-drag-ghost .chip")).toContainText(sourceValue);
  await expect(page.locator(".option-field-drag-placeholder")).toBeVisible();
  await expect(page.locator(".multi-select-option-row.is-dragging")).toHaveCount(0);
  const popoverBox = await page.locator(".multi-select-popover.option-field-popover-shell").boundingBox();
  const ghostBox = await page.locator(".option-field-drag-ghost").boundingBox();
  expect(popoverBox).not.toBeNull();
  expect(ghostBox).not.toBeNull();
  expect(ghostBox!.y).toBeGreaterThanOrEqual(popoverBox!.y - 2);
  expect(ghostBox!.y + ghostBox!.height).toBeLessThanOrEqual(popoverBox!.y + popoverBox!.height + 80);

  await releaseSidebarFileDrag(page);
});

test("option field editor drag reorder works after filtering visible options", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const trigger = tableRow(page, 1).locator(".multi-select-trigger");
  await trigger.click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();

  const optionTextsBefore = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  const filteredCandidates = optionTextsBefore.filter((value) => /a/i.test(value ?? ""));
  expect(filteredCandidates.length).toBeGreaterThan(1);
  const targetValue = filteredCandidates[0]!;
  const sourceValue = filteredCandidates[1]!;

  await page.locator(".multi-select-input").fill("a");
  const filteredOptionTexts = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(filteredOptionTexts).toContain(sourceValue);
  expect(filteredOptionTexts).toContain(targetValue);

  await beginOptionHandleDrag(page, sourceValue);
  await movePointerOverOptionRow(page, targetValue);
  await endOptionHandleDrag(page, sourceValue, targetValue);

  await page.locator(".multi-select-input").fill("");
  const optionTextsAfterClear = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsAfterClear.indexOf(sourceValue)).toBeLessThan(optionTextsAfterClear.indexOf(targetValue));
  await page.locator(".multi-select-popover").press("Escape");

  await trigger.click();
  const optionTextsAfterEscape = await page.locator(".multi-select-option-row .chip").evaluateAll((items) => items.map((item) => item.textContent?.trim()).filter(Boolean));
  expect(optionTextsAfterEscape.indexOf(sourceValue)).toBeGreaterThan(optionTextsAfterEscape.indexOf(targetValue));
});

test("option field editor closes the popover cleanly when switching files", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await tableRow(page, 1).locator(".multi-select-trigger").click();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toBeVisible();
  await page.locator(".multi-select-input").fill("draft_discard_tag");
  await page.locator(".multi-select-input").press("Enter");
  await expect(page.locator(".dirty-pill")).toHaveCount(0);

  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await expect(page.locator(".dirty-pill")).toHaveCount(0);

  await page.locator('.sidebar-item[title="data/e2e_multiselect.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();
  await expect(page.locator(".multi-select-popover.option-field-popover-shell")).toHaveCount(0);
  await expect(tableRow(page, 1).locator(".multi-select-trigger")).not.toContainText("draft_discard_tag");
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

test("profile file order drag previews before release and commits only on drop", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_order_preview_profile",
        profile: {
          sidebarWidth: null,
          fileOrder: [],
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "file_order_preview_profile");
  });

  await page.reload();
  await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();

  const orderBeforeDrag = await getSidebarFileOrder(page);
  await beginSidebarFileDrag(page, "data/status_effects.json");
  await moveSidebarFileDrag(page, "data/runes.json", "before");

  const orderDuringPreview = await getSidebarFileOrder(page);
  expect(orderDuringPreview.indexOf("data/status_effects.json")).toBeLessThan(orderDuringPreview.indexOf("data/runes.json"));
  expect(orderDuringPreview).not.toEqual(orderBeforeDrag);

  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/file_order_preview_profile.json"), "utf8");
    const profile = JSON.parse(text);
    return profile.fileOrder?.join(",");
  }).toBe("");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:__file-order"))).toBe(null);

  await releaseSidebarFileDrag(page);

  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/file_order_preview_profile.json"), "utf8");
    const profile = JSON.parse(text);
    return profile.fileOrder?.join(",");
  }).toContain("data/status_effects.json,data/runes.json");
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("data-editor:__file-order"))).toBe(null);
});

test("profile file order drag cancel rolls back preview without committing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "file_order_cancel_profile",
        profile: {
          sidebarWidth: null,
          fileOrder: [],
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", "file_order_cancel_profile");
  });

  await page.reload();
  await expect(page.locator('.sidebar-file-item[title="data/runes.json"]')).toBeVisible();

  const orderBeforeDrag = await getSidebarFileOrder(page);
  await beginSidebarFileDrag(page, "data/status_effects.json");
  await moveSidebarFileDrag(page, "data/runes.json", "before");

  const orderDuringPreview = await getSidebarFileOrder(page);
  expect(orderDuringPreview.indexOf("data/status_effects.json")).toBeLessThan(orderDuringPreview.indexOf("data/runes.json"));

  await cancelSidebarFileDrag(page);

  const orderAfterCancel = await getSidebarFileOrder(page);
  expect(orderAfterCancel).toEqual(orderBeforeDrag);
  await expect(page.locator('.sidebar-file-item[title="data/status_effects.json"]')).not.toHaveClass(/is-dragging/);
  await expect.poll(async () => {
    const text = await readFile(path.resolve("tests/.scratch/.data-editor/view-configs/file_order_cancel_profile.json"), "utf8");
    const profile = JSON.parse(text);
    return profile.fileOrder?.join(",");
  }).toBe("");
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

test("toolbar search filters visible table rows, not just the counter", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  const searchInput = page.locator("header").getByPlaceholder("搜索当前表格", { exact: true });
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Select Two");

  await expect(page.getByText("Visible 1 / Total 3", { exact: true })).toBeVisible();
  await expect.poll(() => getVisibleTableIds(page)).toEqual(["select_2"]);
  await expect(page.getByRole("button", { name: "展开搜索" })).toHaveCount(1);
});

test("detail keeps the selected record when search hides it from the current view", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await expect(page.locator(".data-table")).toBeVisible();

  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
  await expect(page.locator(".detail-panel.primary .panel-title")).toContainText("Select One");
  await expect(page.locator(".detail-panel.primary .panel-subtitle")).toContainText("Row 1 of 3");
  await expect(page.locator(".data-table tbody tr.selected-row")).toHaveCount(1);

  const searchInput = page.locator("header").getByPlaceholder("搜索当前表格", { exact: true });
  await searchInput.fill("Select Two");

  await expect(page.getByText("Visible 1 / Total 3", { exact: true })).toBeVisible();
  await expect.poll(() => getVisibleTableIds(page)).toEqual(["select_2"]);
  await expect(page.locator(".detail-panel.primary .panel-title")).toContainText("Select One");
  await expect(page.locator(".detail-panel.primary .panel-subtitle")).toContainText("Row hidden by current view");
  await expect(page.locator(".detail-panel.primary button[title=\"Previous record\"]")).toBeDisabled();
  await expect(page.locator(".detail-panel.primary button[title=\"Next record\"]")).toBeDisabled();
  await expect(page.locator(".data-table tbody tr.selected-row")).toHaveCount(0);
});

test("select chip grows with column width", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_select_long.json"]').click();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();
  const chip = tableRow(page, 0).locator(".chip").first();
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

test("column header field type label stays top-aligned in a compact header", async ({ page }) => {
  await page.goto("/");
  await page.locator('.sidebar-item[title="data/e2e_select.json"]').click();
  await columnHeaderTrigger(page, "category").click();
  await page.locator('.column-menu-popup [data-field-type="Select"]').click();

  const headerCell = page.locator('th[data-column-field="category"]');
  const trigger = columnHeaderTrigger(page, "category");
  await expect(trigger.locator("small")).toContainText("单选");
  await expect.poll(async () => Number.parseFloat(await headerCell.evaluate((element) => getComputedStyle(element).height))).toBeLessThanOrEqual(37);
  await expect(trigger).toHaveCSS("justify-content", "flex-start");
  const metrics = await trigger.evaluate((element) => {
    const title = element.querySelector("span");
    const subtitle = element.querySelector("small");
    if (!(title instanceof HTMLElement) || !(subtitle instanceof HTMLElement)) return null;
    const triggerRect = element.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const subtitleRect = subtitle.getBoundingClientRect();
    return {
      titleTopGap: titleRect.top - triggerRect.top,
      textGap: subtitleRect.top - titleRect.bottom,
      subtitleBottomGap: triggerRect.bottom - subtitleRect.bottom,
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics!.subtitleBottomGap - metrics!.titleTopGap).toBeGreaterThanOrEqual(0.5);
  expect(metrics!.textGap).toBeLessThanOrEqual(0.5);
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

test("toolbar renders settings, refresh, and close buttons without a save button", async ({ page }) => {
  await page.goto("/");
  const settingsButton = page.locator(".toolbar .toolbar-settings-button");
  const refreshButton = page.locator(".toolbar .toolbar-rebuild-button");
  const closeButton = page.locator(".toolbar .toolbar-close-button");

  await expect(page.locator(".toolbar .primary-button")).toHaveCount(0);
  await expect(settingsButton).toBeVisible();
  await expect(refreshButton).toBeVisible();
  await expect(closeButton).toBeVisible();
  await expect(refreshButton).not.toContainText("刷新构建");
  await expect(closeButton).not.toContainText("关闭");

  const orderIsCorrect = await page.locator(".toolbar").evaluate(() => {
    const settings = document.querySelector(".toolbar-settings-button");
    const refresh = document.querySelector(".toolbar-rebuild-button");
    const close = document.querySelector(".toolbar-close-button");
    return settings?.nextElementSibling === refresh && refresh?.nextElementSibling === close;
  });
  expect(orderIsCorrect).toBe(true);
});

test("toolbar places view profile controls to the left of hidden fields", async ({ page }) => {
  await page.goto("/");
  const profilePicker = page.locator(".toolbar .toolbar-profile-picker");
  const hiddenFields = page.locator(".toolbar .toolbar-hidden-fields");

  await expect(profilePicker).toBeVisible();
  await expect(hiddenFields).toBeVisible();

  const profileBeforeHidden = await page.locator(".toolbar").evaluate(() => {
    const profile = document.querySelector(".toolbar-profile-picker");
    const hidden = document.querySelector(".toolbar-hidden-fields");
    return profile?.nextElementSibling === hidden;
  });
  expect(profileBeforeHidden).toBe(true);
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

test("refresh preserves file view and table scroll", async ({ page }) => {
  const collectionKey = "data/skills.json:skills";
  let originalSharedViews: SharedViewsConfig | null = null;
  let originalLocalStorage: Record<string, string> | null = null;

  await page.goto("/");
  originalSharedViews = await loadSharedViewsConfig(page);
  originalLocalStorage = await snapshotLocalStorage(page);

  try {
    const nextConfig = structuredClone(originalSharedViews);
    nextConfig.collections[collectionKey] = {
      defaultViewId: "all",
      views: [
        { id: "all", name: "全部", type: "table", query: "", filters: { op: "and", rules: [] }, sorts: [] },
        { id: "e2e-scroll-a", name: "E2E Scroll A", type: "table", query: "", filters: { op: "and", rules: [] }, sorts: [] },
      ],
    };
    await saveSharedViewsConfig(page, nextConfig);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/skills.json"]').click();
    await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
    await selectViewTab(page, "E2E Scroll A");
    await waitForTableScrollReady(page, { vertical: true, horizontal: true });

    await setTableScrollPosition(page, 640, 420);
    const beforeReload = await readTableScrollPosition(page);
    expect(beforeReload).not.toBeNull();
    expect(beforeReload!.scrollTop).toBeGreaterThan(300);
    expect(beforeReload!.scrollLeft).toBeGreaterThan(200);

    await page.reload();

    await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
    await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText("E2E Scroll A");
    const afterReload = await readTableScrollPosition(page);
    expect(afterReload).not.toBeNull();
    expect(afterReload!.scrollTop).toBeGreaterThan(0);
    expect(afterReload!.scrollLeft).toBeGreaterThan(0);
    expect(Math.abs(afterReload!.scrollTop - beforeReload!.scrollTop)).toBeLessThanOrEqual(80);
    expect(Math.abs(afterReload!.scrollLeft - beforeReload!.scrollLeft)).toBeLessThanOrEqual(80);
  } finally {
    if (originalSharedViews) await bestEffortRestore("shared views config", () => saveSharedViewsConfig(page, originalSharedViews));
    if (originalLocalStorage) await bestEffortRestore("localStorage", () => restoreLocalStorage(page, originalLocalStorage));
  }
});

test("refresh keeps scroll scoped to active view", async ({ page }) => {
  const collectionKey = "data/skills.json:skills";
  let originalSharedViews: SharedViewsConfig | null = null;
  let originalLocalStorage: Record<string, string> | null = null;

  await page.goto("/");
  originalSharedViews = await loadSharedViewsConfig(page);
  originalLocalStorage = await snapshotLocalStorage(page);

  try {
    const nextConfig = structuredClone(originalSharedViews);
    nextConfig.collections[collectionKey] = {
      defaultViewId: "all",
      views: [
        { id: "all", name: "全部", type: "table", query: "", filters: { op: "and", rules: [] }, sorts: [] },
        { id: "e2e-scroll-a", name: "E2E Scroll A", type: "table", query: "", filters: { op: "and", rules: [] }, sorts: [] },
        { id: "e2e-scroll-b", name: "E2E Scroll B", type: "table", query: "", filters: { op: "and", rules: [] }, sorts: [] },
      ],
    };
    await saveSharedViewsConfig(page, nextConfig);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.locator('.sidebar-item[title="data/skills.json"]').click();
    await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
    await waitForTableScrollReady(page, { vertical: true, horizontal: true });

    await selectViewTab(page, "E2E Scroll A");
    await setTableScrollPosition(page, 700, 440);
    const buildScroll = await readTableScrollPosition(page);
    expect(buildScroll).not.toBeNull();
    expect(buildScroll!.scrollTop).toBeGreaterThan(350);
    expect(buildScroll!.scrollLeft).toBeGreaterThan(200);

    await selectViewTab(page, "E2E Scroll B");
    await setTableScrollPosition(page, 180, 120);
    const subScroll = await readTableScrollPosition(page);
    expect(subScroll).not.toBeNull();
    expect(subScroll!.scrollTop).toBeGreaterThan(80);
    expect(subScroll!.scrollLeft).toBeGreaterThan(40);
    expect(Math.abs(buildScroll!.scrollTop - subScroll!.scrollTop)).toBeGreaterThan(300);
    expect(Math.abs(buildScroll!.scrollLeft - subScroll!.scrollLeft)).toBeGreaterThan(150);

    await page.reload();

    await expect(page.locator(".toolbar strong")).toContainText("data/skills.json");
    await expect(page.locator(".view-tab-shell.active .view-tab")).toContainText("E2E Scroll B");
    const afterReload = await readTableScrollPosition(page);
    expect(afterReload).not.toBeNull();
    expect(Math.abs(afterReload!.scrollTop - subScroll!.scrollTop)).toBeLessThanOrEqual(80);
    expect(Math.abs(afterReload!.scrollLeft - subScroll!.scrollLeft)).toBeLessThanOrEqual(80);
    expect(Math.abs(afterReload!.scrollTop - buildScroll!.scrollTop)).toBeGreaterThan(220);
    expect(Math.abs(afterReload!.scrollLeft - buildScroll!.scrollLeft)).toBeGreaterThan(120);
  } finally {
    if (originalSharedViews) await bestEffortRestore("shared views config", () => saveSharedViewsConfig(page, originalSharedViews));
    if (originalLocalStorage) await bestEffortRestore("localStorage", () => restoreLocalStorage(page, originalLocalStorage));
  }
});

test("refresh fallback ignores stale page context", async ({ page }) => {
  await page.goto("/");
  const activeProjectId = await getActiveProjectId(page);
  expect(activeProjectId).toBeTruthy();

  await page.evaluate(({ projectId }) => {
    localStorage.clear();
    localStorage.setItem("data-editor:page-context", JSON.stringify({
      projects: {
        [projectId]: {
          selectedPath: "data/__missing_refresh_context__.json",
          collectionPath: "__missing_collection__",
          scrollByView: {
            "data/__missing_refresh_context__.json:__missing_collection__:ghost": {
              scrollTop: 999,
              scrollLeft: 555,
            },
          },
        },
      },
    }));
  }, { projectId: activeProjectId });

  await page.reload();

  await expect(page.locator(".toolbar strong")).toBeVisible();
  await expect(page.locator(".toolbar strong")).not.toContainText("__missing_refresh_context__");
  await expect(page.locator(".data-table")).toBeVisible();

  const currentSelectedPath = await page.locator(".toolbar strong").textContent();
  expect(currentSelectedPath).toBeTruthy();
  const defaultCollectionPath = await getDefaultCollectionPath(page, currentSelectedPath!, activeProjectId);
  await expect.poll(async () => page.evaluate(({ projectId }) => {
    const raw = localStorage.getItem("data-editor:page-context");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      projects?: Record<string, {
        selectedPath?: string | null;
        collectionPath?: string | null;
      }>;
    };
    return parsed.projects?.[projectId] ?? null;
  }, { projectId: activeProjectId! })).toMatchObject({
    selectedPath: currentSelectedPath,
    collectionPath: defaultCollectionPath,
  });
  const initialScroll = await readTableScrollPosition(page);
  expect(initialScroll).not.toBeNull();
  expect(initialScroll!.scrollTop).toBe(0);
  expect(initialScroll!.scrollLeft).toBe(0);
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await expect(page.locator(".detail-panel.primary")).toBeVisible();
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

  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(closeButton).toBeDisabled();
  await expect(closeButton).toContainText("关闭中...");
  await expect(page.locator(".toolbar .primary-button")).toHaveCount(0);

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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
  await page.locator(".detail-panel.primary .detail-input").first().fill("Dirty name");
  await expect(page.locator(".dirty-pill")).toBeVisible();
  await expect(page.locator(".dirty-pill")).toContainText("保存失败");

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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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
  await tableRow(page, 0).locator('[data-cell-role="title-action"]').click();
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

