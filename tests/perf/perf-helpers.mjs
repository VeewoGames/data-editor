import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectRoot = path.resolve(process.env.DATA_EDITOR_PERF_PROJECT_ROOT ?? path.join(toolRoot, "..", "Nocturnel"));

export function resolveProjectRoot() {
  return projectRoot;
}

export async function createRegistryHome(prefix) {
  return mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

export async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export async function findAvailableBridgePort(mainPort) {
  while (true) {
    const candidate = await findAvailablePort();
    if (candidate !== mainPort && candidate !== mainPort + 1) return candidate;
  }
}

export async function runNodeScript(scriptPath, args = [], options = {}) {
  return runCommand(process.execPath, [scriptPath, ...args], options);
}

export async function runNpmScript(scriptName, extraArgs = [], options = {}) {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(npmBin, ["run", scriptName, "--", ...extraArgs], options);
}

export async function runBuild(options = {}) {
  return runNodeScript(path.join(toolRoot, "node_modules", "vite", "bin", "vite.js"), ["build"], {
    cwd: toolRoot,
    ...options,
  });
}

export async function startOpenService({ mode, port, bridgePort, registryHome, projectRoot: root = projectRoot }) {
  await runNodeScript(path.join(toolRoot, "open.mjs"), [
    "--project",
    root,
    "--mode",
    mode,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
    "--registry-home",
    registryHome,
  ], { cwd: toolRoot });
}

export async function finalizeTempService({ port, bridgePort, registryHome }) {
  return runNodeScript(path.join(toolRoot, "scripts", "service-finalize.mjs"), [
    "--cleanup",
    "--recover",
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
    "--registry-home",
    registryHome,
  ], { cwd: toolRoot });
}

export async function waitForHealth(url, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function withBrowserPage(baseURL, fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL });
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export async function preparePerfProfile(page, profileName, filePath) {
  await page.goto("/");
  await page.evaluate(async ({ profileName, filePath }) => {
    localStorage.clear();
    localStorage.setItem("data-editor:enable-detail-reorder-profiling", "1");
    await fetch("/api/view-profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: profileName,
        profile: {
          sidebarWidth: null,
          detailPanelWidth: null,
          fileOrder: [],
          lastActiveViews: {},
          viewDrafts: {},
          viewOrderDrafts: {},
          appearance: null,
          viewLayouts: {
            [`${filePath}:$`]: {
              all: {
                hidden: [],
                wrapped: [],
                order: [],
                detailOrder: [],
                widths: {},
              },
            },
          },
          collections: {},
        },
      }),
    });
    localStorage.setItem("data-editor:selected-view-profile", profileName);
  }, { profileName, filePath });
  await page.reload();
}

export async function openSidebarFile(page, title) {
  const direct = page.locator(`.sidebar-item[title="${title}"]`);
  if (await direct.count()) {
    await direct.first().click();
    await page.locator(".data-table tbody tr[data-row-id]").first().waitFor();
    return;
  }
  const fallback = page.locator(".sidebar-item", { hasText: path.basename(title) });
  await fallback.first().click();
  await page.locator(".data-table tbody tr[data-row-id]").first().waitFor();
}

export async function captureTableStats(page) {
  return page.evaluate(() => ({
    visibleRows: document.querySelectorAll(".data-table tbody tr[data-row-id]").length,
    totalFields: document.querySelectorAll("th[data-column-field]").length,
  }));
}

export async function captureVisibleRowSignature(page) {
  return page.evaluate(() => [...document.querySelectorAll(".data-table tbody tr[data-row-id]")]
    .slice(0, 12)
    .map((row) => {
      const title = row.querySelector('[data-cell-role="title-text"]')?.textContent?.trim() ?? "";
      return `${row.getAttribute("data-row-id")}:${title}`;
    })
    .join("|"));
}

export async function dragFirstDetailFieldUp(page) {
  const detailOrderBefore = await page.locator(".detail-panel.primary .detail-property-handle").evaluateAll(
    (items) => items
      .map((item) => item.getAttribute("aria-label")?.replace(/^Reorder\s+/, "").trim())
      .filter((value) => Boolean(value))
      .slice(0, 4),
  );
  if (detailOrderBefore.length < 2) throw new Error("Not enough detail fields to reorder.");
  const draggedField = detailOrderBefore[1];
  const targetField = detailOrderBefore[0];
  const draggedLocator = page.locator(`.detail-panel.primary .detail-property-handle[aria-label="Reorder ${draggedField}"]`);
  const targetLocator = page.locator(`.detail-panel.primary .detail-property-handle[aria-label="Reorder ${targetField}"]`);
  const draggedHandle = await draggedLocator.boundingBox();
  const targetHandle = await targetLocator.boundingBox();
  const detailPanelBox = await page.locator(".detail-panel.primary").boundingBox();
  if (!draggedHandle || !targetHandle || !detailPanelBox) throw new Error("Failed to resolve drag geometry.");

  const dragStart = { x: draggedHandle.x + draggedHandle.width / 2, y: draggedHandle.y + draggedHandle.height / 2 };
  const dragMid = { x: dragStart.x, y: dragStart.y - 40 };
  const dragEnd = { x: targetHandle.x + targetHandle.width / 2, y: detailPanelBox.y + 96 };

  await draggedLocator.evaluate((element, point) => {
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

  await page.waitForFunction((expectedIndex) => {
    const labels = [...document.querySelectorAll(".detail-panel.primary .detail-property-handle")]
      .map((item) => item.getAttribute("aria-label")?.replace(/^Reorder\s+/, "").trim())
      .filter(Boolean)
      .slice(0, 4);
    return labels.indexOf(expectedIndex.draggedField) !== expectedIndex.draggedIndex;
  }, {
    draggedField,
    draggedIndex: detailOrderBefore.indexOf(draggedField),
  });

  return { draggedField, targetField, detailOrderBefore };
}

export async function readDetailReorderMeasures(page) {
  return page.evaluate(() => performance.getEntriesByType("measure")
    .filter((entry) => entry.name.startsWith("detail-reorder:"))
    .map((entry) => ({
      name: entry.name,
      duration: Math.round(entry.duration * 100) / 100,
    })));
}

export function printJson(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? toolRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stderr || stdout}`));
    });
  });
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
