import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createRegistryHome,
  findAvailableBridgePort,
  findAvailablePort,
  finalizeTempService,
  resolveProjectRoot,
  startOpenService,
  waitForHealth,
  withBrowserPage,
} from "./perf-helpers.mjs";

const filePath = "data/runes.json";
const collectionKey = `${filePath}:$`;
const outputPath = path.resolve("artifacts/icon-pack-performance/shared-view-icons-closeout.json");

const registryHome = await createRegistryHome("data-editor-perf-shared-view-icons");
const projectRoot = resolveProjectRoot();
const port = await findAvailablePort();
const bridgePort = await findAvailableBridgePort(port);

try {
  await startOpenService({ mode: "dev", port, bridgePort, registryHome, projectRoot });
  await waitForHealth(`http://127.0.0.1:${port}/api/health`);

  const result = await withBrowserPage(`http://127.0.0.1:${port}`, async (page) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
    const originalSharedViews = await page.evaluate(async () => {
      const response = await fetch("/api/shared-views");
      return response.json();
    });

    try {
      const nextConfig = structuredClone(originalSharedViews);
      nextConfig.collections[collectionKey] = {
        defaultViewId: "utility",
        items: [
          {
            kind: "view",
            icon: "tablerFilledAccessible",
            view: {
              id: "utility",
              name: "功能",
              type: "table",
              query: "support",
              filters: { op: "and", rules: [] },
              sorts: [],
            },
          },
        ],
      };
      await page.evaluate(async (config) => {
        await fetch("/api/shared-views", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(config),
        });
        localStorage.removeItem("data-editor:shared-view-recent-icons");
      }, nextConfig);

      const timings = {};
      const startedAt = performance.now();
      await page.goto("/");
      timings.goto = round(performance.now() - startedAt);

      const openDocumentStartedAt = performance.now();
      await page.locator(`.sidebar-item[title="${filePath}"]`).click();
      await page.locator(".data-table").waitFor();
      timings.openDocument = round(performance.now() - openDocumentStartedAt);

      const openMenuStartedAt = performance.now();
      await openActiveViewMenu(page, "功能");
      timings.openViewMenu = round(performance.now() - openMenuStartedAt);

      const openPickerStartedAt = performance.now();
      await page.locator(".view-tab-menu-icon-trigger[data-view-icon-trigger='view']").click();
      await page.locator(".view-tab-icon-picker-content").waitFor();
      timings.openPicker = round(performance.now() - openPickerStartedAt);

      const switchCoreStartedAt = performance.now();
      await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Micro S" }).click();
      const microSolidCount = await page.locator(".view-tab-icon-picker-grid .view-tab-icon-picker-option").count();
      await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Core S" }).click();
      await page.locator(".view-tab-icon-picker-grid [data-view-icon='streamlineCoreSolidApplyToAll']").waitFor();
      timings.switchToCoreSolid = round(performance.now() - switchCoreStartedAt);

      const loadCorePackStartedAt = performance.now();
      await page.locator(".view-tab-icon-picker-options-trigger").click();
      const coreSolidPackRow = page.locator(".view-tab-icon-pack-row").filter({ hasText: "Core S" });
      await coreSolidPackRow.getByRole("button", { name: "加载" }).click();
      await coreSolidPackRow.getByRole("button", { name: "卸载" }).waitFor();
      await page.locator(".view-tab-icon-picker-options-trigger").click();
      await page.locator(".view-tab-icon-pack-options").waitFor({ state: "hidden" });
      timings.loadCoreSolidPack = round(performance.now() - loadCorePackStartedAt);

      const switchLegacyStartedAt = performance.now();
      await page.locator(".view-tab-icon-picker-tab").filter({ hasText: "Legacy" }).click();
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
    } finally {
      await page.evaluate(async (config) => {
        await fetch("/api/shared-views", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(config),
        });
      }, originalSharedViews);
    }
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await finalizeTempService({ port, bridgePort, registryHome }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}

async function openActiveViewMenu(page, name = "功能") {
  const activeTab = page.locator(".view-tabs-top-level .view-tab").filter({ hasText: name }).first();
  await activeTab.click();
  await activeTab.click();
  await page.locator(".view-tab-menu-content").waitFor();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
