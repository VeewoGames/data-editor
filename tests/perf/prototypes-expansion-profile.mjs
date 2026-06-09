import {
  captureTableStats,
  createRegistryHome,
  dragFirstDetailFieldUp,
  findAvailablePort,
  findAvailableBridgePort,
  finalizeTempService,
  openSidebarFile,
  preparePerfProfile,
  printJson,
  readDetailReorderMeasures,
  resolveProjectRoot,
  startOpenService,
  waitForHealth,
  withBrowserPage,
} from "./perf-helpers.mjs";

const filePath = "data/prototypes_expansion.json";
const profileName = "perf_prototypes_expansion";

const registryHome = await createRegistryHome("data-editor-perf-profile");
const projectRoot = resolveProjectRoot();
const port = await findAvailablePort();
const bridgePort = await findAvailableBridgePort(port);

try {
  await startOpenService({ mode: "dev", port, bridgePort, registryHome, projectRoot });
  await waitForHealth(`http://127.0.0.1:${port}`);

  const result = await withBrowserPage(`http://127.0.0.1:${port}`, async (page) => {
    await preparePerfProfile(page, profileName, filePath);
    await openSidebarFile(page, filePath);
    const tableStats = await captureTableStats(page);
    await page.locator(".data-table tbody tr[data-row-id]").first().locator('[data-cell-role="title-action"]').click();
    await page.locator(".detail-panel.primary").waitFor();
    const drag = await dragFirstDetailFieldUp(page);

    let totalPresent = true;
    try {
      await page.waitForFunction(() => {
        const names = performance.getEntriesByType("measure").map((entry) => entry.name);
        return names.includes("detail-reorder:total");
      }, { timeout: 5_000 });
    } catch {
      totalPresent = false;
    }

    const measures = await readDetailReorderMeasures(page);
    const reactSamples = summarizeReactSamples(measures);
    return {
      mode: "dev-profile",
      projectRoot,
      filePath,
      tableStats,
      drag,
      measures,
      reactSamples,
      totalPresent,
      reactDataTablePresent: measures.some((entry) => entry.name === "detail-reorder:react-data-table"),
      totals: Object.fromEntries(measures.map((entry) => [entry.name, entry.duration])),
    };
  });

  printJson(result);
} finally {
  await finalizeTempService({ port, bridgePort, registryHome }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}

function summarizeReactSamples(measures) {
  const samples = measures.filter((entry) => entry.name.endsWith(":sample"));
  const summary = {};
  for (const sample of samples) {
    const key = sample.name.slice(0, -":sample".length);
    summary[key] ??= { count: 0, totalDuration: 0, maxDuration: 0 };
    summary[key].count += 1;
    summary[key].totalDuration = round(summary[key].totalDuration + sample.duration);
    summary[key].maxDuration = Math.max(summary[key].maxDuration, sample.duration);
  }
  return summary;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
