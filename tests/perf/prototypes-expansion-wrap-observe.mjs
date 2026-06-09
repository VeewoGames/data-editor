import {
  captureTableStats,
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
const wrappedField = "description";

const registryHome = await createRegistryHome("data-editor-perf-wrap-observe");
const projectRoot = resolveProjectRoot();
const port = await findAvailablePort();
const bridgePort = await findAvailableBridgePort(port);

try {
  await runBuild();
  await startOpenService({ mode: "static", port, bridgePort, registryHome, projectRoot });
  await waitForHealth(`http://127.0.0.1:${port}/api/health`);

  const result = await withBrowserPage(`http://127.0.0.1:${port}`, async (page) => {
    const timings = {};

    const gotoStartedAt = performance.now();
    await page.goto("/");
    await page.locator(".sidebar-item").first().waitFor();
    timings.goto = round(performance.now() - gotoStartedAt);

    const openStartedAt = performance.now();
    await openSidebarFile(page, filePath);
    await page.locator(".data-table tbody tr[data-row-id]").first().waitFor();
    timings.openDocument = round(performance.now() - openStartedAt);

    const before = await captureWrapObservation(page);

    const toggleStartedAt = performance.now();
    await toggleWrapForField(page, wrappedField, false);
    await page.waitForFunction((fieldName) => {
      const cell = document.querySelector(`.data-table tbody td[data-column-field="${fieldName}"]`);
      return cell?.getAttribute("data-wrap-mode") === "wrap";
    }, wrappedField);
    timings.enableWrap = round(performance.now() - toggleStartedAt);

    const afterWrap = await captureWrapObservation(page);

    const scrollStartedAt = performance.now();
    await scrollTableTo(page, 1200);
    await page.waitForTimeout(100);
    timings.scrollAfterWrap = round(performance.now() - scrollStartedAt);

    const afterScroll = await captureWrapObservation(page);

    const restoreStartedAt = performance.now();
    await scrollTableTo(page, 0);
    await page.waitForTimeout(100);
    timings.restoreScrollAfterWrap = round(performance.now() - restoreStartedAt);

    const afterScrollRestore = await captureWrapObservation(page);

    const detailStartedAt = performance.now();
    await page.locator(".data-table tbody tr[data-row-id]").first().locator('[data-cell-role="title-action"]').click();
    await page.locator(".detail-panel.primary").waitFor();
    timings.openDetailAfterWrap = round(performance.now() - detailStartedAt);

    const afterDetail = await captureWrapObservation(page);

    const selectStartedAt = performance.now();
    await page.locator(".data-table tbody tr[data-row-id]").nth(1).click();
    await page.waitForTimeout(100);
    timings.selectSecondRowAfterWrap = round(performance.now() - selectStartedAt);

    const afterSelect = await captureWrapObservation(page);

    return {
      mode: "static-wrap-observe",
      projectRoot,
      filePath,
      wrappedField,
      tableStats: await captureTableStats(page),
      timings,
      before,
      afterWrap,
      afterScroll,
      afterScrollRestore,
      afterDetail,
      afterSelect,
      deltas: {
        domRows: afterWrap.domRowCount - before.domRowCount,
        maxRowHeight: round(afterWrap.maxRowHeight - before.maxRowHeight),
        topSpacerHeight: round(afterWrap.topSpacerHeight - before.topSpacerHeight),
        bottomSpacerHeight: round(afterWrap.bottomSpacerHeight - before.bottomSpacerHeight),
        anchorChangedAtWrap: before.firstVisibleRowId !== afterWrap.firstVisibleRowId,
        anchorChangedOnScroll: afterWrap.firstVisibleRowId !== afterScroll.firstVisibleRowId,
        anchorRestoredAtTop: before.firstVisibleRowId === afterScrollRestore.firstVisibleRowId,
      },
      evaluation: evaluateWrapPoc({
        totalRows: 187,
        before,
        afterWrap,
        afterScroll,
        afterScrollRestore,
      }),
    };
  });

  printJson(result);
} finally {
  await finalizeTempService({ port, bridgePort, registryHome }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}

async function toggleWrapForField(page, fieldName, currentlyWrapped) {
  const header = page.locator(`th[data-column-field="${fieldName}"] .column-trigger`);
  await header.click();
  const actionText = currentlyWrapped ? "取消内容自动换行" : "内容自动换行";
  await page.locator(".column-menu-popup .menu-item", { hasText: actionText }).click();
}

async function captureWrapObservation(page) {
  return page.evaluate(() => {
    const roundInPage = (value) => Math.round(value * 100) / 100;
    const scrollContainer = document.querySelector(".table-scroll");
    const scrollRect = scrollContainer instanceof HTMLElement ? scrollContainer.getBoundingClientRect() : null;
    const rows = [...document.querySelectorAll(".data-table tbody tr[data-row-id]")];
    const heights = rows.map((row) => row.getBoundingClientRect().height);
    const visibleRows = scrollRect
      ? rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > scrollRect.top && rect.top < scrollRect.bottom;
      })
      : rows;
    const firstVisibleRow = visibleRows[0] ?? null;
    const lastVisibleRow = visibleRows[visibleRows.length - 1] ?? null;
    const tbody = document.querySelector(".data-table tbody");
    const bodyChildren = tbody ? [...tbody.children] : [];
    const firstChild = bodyChildren[0] ?? null;
    const lastChild = bodyChildren[bodyChildren.length - 1] ?? null;
    const topSpacerCell = (
      firstChild instanceof HTMLTableRowElement
      && !firstChild.hasAttribute("data-row-id")
    ) ? firstChild.querySelector("td") : null;
    const bottomSpacerCell = (
      lastChild instanceof HTMLTableRowElement
      && !lastChild.hasAttribute("data-row-id")
    ) ? lastChild.querySelector("td") : null;
    const descriptionCell = document.querySelector('.data-table tbody td[data-column-field="description"]');
    return {
      domRowCount: rows.length,
      firstVisibleRowId: firstVisibleRow?.getAttribute("data-row-id") ?? null,
      lastVisibleRowId: lastVisibleRow?.getAttribute("data-row-id") ?? null,
      topSpacerHeight: Number(topSpacerCell instanceof HTMLElement ? topSpacerCell.style.height.replace("px", "") : 0) || 0,
      bottomSpacerHeight: Number(bottomSpacerCell instanceof HTMLElement ? bottomSpacerCell.style.height.replace("px", "") : 0) || 0,
      minRowHeight: heights.length ? roundInPage(Math.min(...heights)) : 0,
      maxRowHeight: heights.length ? roundInPage(Math.max(...heights)) : 0,
      wrapMode: descriptionCell?.getAttribute("data-wrap-mode") ?? null,
      scrollTop: (scrollContainer instanceof HTMLElement)
        ? scrollContainer.scrollTop
        : 0,
    };
  });
}

async function scrollTableTo(page, scrollTop) {
  await page.locator(".table-scroll").evaluate((element, nextScrollTop) => {
    if (!(element instanceof HTMLElement)) return;
    element.scrollTop = nextScrollTop;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, scrollTop);
}

function evaluateWrapPoc({ totalRows, before, afterWrap, afterScroll, afterScrollRestore }) {
  const maxDomRowsAfterWrap = Math.max(before.domRowCount + 24, Math.ceil(before.domRowCount * 1.5));
  const checks = {
    remainsWindowedAfterWrap: afterWrap.domRowCount < totalRows && afterWrap.domRowCount <= maxDomRowsAfterWrap,
    preservesSpacerAfterWrap: afterWrap.bottomSpacerHeight > 0 || afterWrap.topSpacerHeight > 0,
    scrollAdvancesVisibleAnchor: afterWrap.firstVisibleRowId !== afterScroll.firstVisibleRowId,
    restoresAnchorAtTop: before.firstVisibleRowId === afterScrollRestore.firstVisibleRowId,
  };
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    thresholds: {
      totalRows,
      maxDomRowsAfterWrap,
      requiredAnchorRestore: true,
    },
    checks,
    failedChecks,
    verdict: failedChecks.length ? "no-go" : "go",
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
