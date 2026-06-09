import {
  captureTableStats,
  captureVisibleRowSignature,
  createRegistryHome,
  findAvailablePort,
  findAvailableBridgePort,
  finalizeTempService,
  openSidebarFile,
  printJson,
  resolveProjectRoot,
  runBuild,
  startOpenService,
  waitForHealth,
  withBrowserPage,
} from "./perf-helpers.mjs";

const filePath = "data/prototypes_expansion.json";
const searchQuery = "部署物";

const registryHome = await createRegistryHome("data-editor-perf-static");
const projectRoot = resolveProjectRoot();
const port = await findAvailablePort();
const bridgePort = await findAvailableBridgePort(port);

try {
  await runBuild();
  await startOpenService({ mode: "static", port, bridgePort, registryHome, projectRoot });
  await waitForHealth(`http://127.0.0.1:${port}/api/health`);

  const result = await withBrowserPage(`http://127.0.0.1:${port}`, async (page) => {
    const timings = {};

    const startedAt = performance.now();
    await page.goto("/");
    await page.locator(".sidebar-item").first().waitFor();
    timings.goto = round(performance.now() - startedAt);

    const openStartedAt = performance.now();
    await openSidebarFile(page, filePath);
    const tableStats = await captureTableStats(page);
    const baselineSignature = await captureVisibleRowSignature(page);
    timings.openDocument = round(performance.now() - openStartedAt);

    const searchStartedAt = performance.now();
    await page.locator(".search-box input").fill(searchQuery);
    await page.waitForFunction((signature) => {
      const nextSignature = [...document.querySelectorAll(".data-table tbody tr[data-row-id]")]
        .slice(0, 12)
        .map((row) => {
          const title = row.querySelector('[data-cell-role="title-text"]')?.textContent?.trim() ?? "";
          return `${row.getAttribute("data-row-id")}:${title}`;
        })
        .join("|");
      return nextSignature !== signature;
    }, baselineSignature);
    const filteredSignature = await captureVisibleRowSignature(page);
    timings.search = round(performance.now() - searchStartedAt);

    const clearStartedAt = performance.now();
    await page.locator(".search-box input").fill("");
    await page.waitForFunction((signature) => {
      const nextSignature = [...document.querySelectorAll(".data-table tbody tr[data-row-id]")]
        .slice(0, 12)
        .map((row) => {
          const title = row.querySelector('[data-cell-role="title-text"]')?.textContent?.trim() ?? "";
          return `${row.getAttribute("data-row-id")}:${title}`;
        })
        .join("|");
      return nextSignature === signature;
    }, baselineSignature);
    timings.clearSearch = round(performance.now() - clearStartedAt);

    const detailStartedAt = performance.now();
    await page.locator(".data-table tbody tr[data-row-id]").first().locator('[data-cell-role="title-action"]').click();
    await page.locator(".detail-panel.primary").waitFor();
    timings.openDetail = round(performance.now() - detailStartedAt);

    return {
      mode: "static",
      projectRoot,
      filePath,
      searchQuery,
      tableStats,
      timings,
      baselineSignature,
      filteredSignature,
    };
  });

  printJson(result);
} finally {
  await finalizeTempService({ port, bridgePort, registryHome }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}

function round(value) {
  return Math.round(value * 100) / 100;
}
