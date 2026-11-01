import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPerfWorkspace,
  cleanupPerfWorkspace,
  perfFilePath,
  findAvailableBridgePort,
  findAvailablePort,
  finalizeTempService,
  startOpenService,
  waitForHealth,
  withBrowserPage,
} from "./perf-helpers.mjs";

const filePath = perfFilePath;
const outputPath = path.resolve("artifacts/icon-pack-performance/shared-view-icons-closeout.json");

const { registryHome, projectRoot } = await createPerfWorkspace();
const port = await findAvailablePort();
const bridgePort = await findAvailableBridgePort(port);

try {
  await startOpenService({ mode: "dev", port, bridgePort, registryHome, projectRoot });
  await waitForHealth(`http://127.0.0.1:${port}/api/health`);

  const result = await withBrowserPage(`http://127.0.0.1:${port}`, async (page) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.evaluate(() => localStorage.removeItem("data-editor:shared-view-recent-icons"));
    const timings = {};
    const startedAt = performance.now();
    await page.goto("/");
    timings.goto = round(performance.now() - startedAt);

    const openDocumentStartedAt = performance.now();
    await page.locator(`.sidebar-item[title="${filePath}"]`).click();
    await page.locator(".data-table").waitFor();
    timings.openDocument = round(performance.now() - openDocumentStartedAt);

    const openMenuStartedAt = performance.now();
    await openActiveViewMenu(page, "规划");
    timings.openViewMenu = round(performance.now() - openMenuStartedAt);

    const openPickerStartedAt = performance.now();
    await page.locator(".view-tab-menu-icon-trigger[data-view-icon-trigger='view']").click();
    await page.locator(".view-tab-icon-picker-content").waitFor();
    timings.openPicker = round(performance.now() - openPickerStartedAt);

    const switchCoreStartedAt = performance.now();
    await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Micro S" }).click();
    if(await page.locator('.view-tab-icon-picker-empty').isVisible())await page.locator('.view-tab-icon-picker-empty button').click();
    await page.locator('.view-tab-icon-picker-grid .view-tab-icon-picker-option').first().waitFor();
    const microSolidCount = await page.locator(".view-tab-icon-picker-grid .view-tab-icon-picker-option").count();
    await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Core S" }).click();
    await page.locator('.view-tab-icon-picker-empty').filter({hasText:'Core S 未加载'}).waitFor();
    timings.switchToCoreSolid = round(performance.now() - switchCoreStartedAt);

    const loadCorePackStartedAt = performance.now();
    await page.locator(".view-tab-icon-picker-options-trigger").click();
    const coreSolidPackRow = page.locator(".view-tab-icon-pack-row").filter({ hasText: "Core S" });
    await coreSolidPackRow.getByRole("button", { name: "加载" }).click();
    await coreSolidPackRow.getByRole("button", { name: "卸载" }).waitFor();
    await page.locator(".view-tab-icon-picker-options-trigger").click();
    await page.locator(".view-tab-icon-pack-options").waitFor({ state: "hidden" });
    await page.locator(".view-tab-icon-picker-grid [data-view-icon='streamlineCoreSolidApplyToAll']").waitFor();
    timings.loadCoreSolidPack = round(performance.now() - loadCorePackStartedAt);

    const switchLegacyStartedAt = performance.now();
    await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Legacy" }).click();
    if(await page.locator('.view-tab-icon-picker-empty').isVisible())await page.locator('.view-tab-icon-picker-empty button').click();
    await page.locator(".view-tab-icon-picker-grid .view-tab-icon-picker-option").first().waitFor();
    timings.switchToLegacy = round(performance.now() - switchLegacyStartedAt);

    const legacyCount = await page.locator(".view-tab-icon-picker-grid .view-tab-icon-picker-option").count();
    await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Core S" }).click();
    const coreSolidCount = await page.locator(".view-tab-icon-picker-grid .view-tab-icon-picker-option").count();
    await page.locator(".view-tab-icon-picker-options-trigger").click();
    const packDetails = await page.locator(".view-tab-icon-pack-row").evaluateAll((nodes) => nodes.map((node) => ({
      label: node.querySelector(".view-tab-icon-pack-name")?.textContent?.trim() ?? "",
      detail: node.querySelector(".view-tab-icon-pack-detail")?.textContent?.trim() ?? "",
      action: node.querySelector("button")?.textContent?.trim() ?? "",
    })));

    return {
      capturedAt: new Date().toISOString(),
      phase: "shared-view-icons-closeout",
      mode: "dev",
      projectRoot,
      filePath,
      timings,
      groupCounts: {
        microSolidCount,
        coreSolidCount,
        legacyCount,
      },
      packDetails,
      legacyCount,
    };

  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await finalizeTempService({ port, bridgePort, registryHome, projectRoot });
  await cleanupPerfWorkspace(projectRoot);
}

async function openActiveViewMenu(page, name = "规划") {
  const activeTab = page.locator(".view-tabs-top-level .view-tab").filter({ hasText: name }).first();
  await activeTab.click();
  await activeTab.click();
  await page.locator(".view-tab-menu-content").waitFor();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
