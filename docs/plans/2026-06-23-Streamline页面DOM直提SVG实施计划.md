# Streamline 页面 DOM 直提 SVG 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一条从 Streamline 图标详情页 DOM 直接提取当前图标 SVG，并落盘为本地 `.svg` 资产的可断点恢复采集链路。

**Architecture:** 方案分成三段：先生成 manifest，再逐个进入详情页提取当前图标详情区的 SVG `outerHTML`，最后基于 manifest 扫描输出目录做校验。页面结构逻辑集中在 `streamline-page.mjs`，批处理状态集中在 `manifest-store.mjs`，业务脚本只做编排。

**Tech Stack:** Node.js ESM、Chrome browser-client / node_repl、JSON manifest、本地文件系统。

---

## 文件结构

- Create: `C:\Code\data-editor\scripts\streamline-export\collect-streamline-icons.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\extract-streamline-svg-dom.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\verify-streamline-svg.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\manifest-store.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\normalize-name.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\file-writer.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\streamline-page.mjs`
- Create: `C:\Code\data-editor\tests\streamline-export\manifest-store.test.mjs`
- Create: `C:\Code\data-editor\tests\streamline-export\normalize-name.test.mjs`
- Create: `C:\Code\data-editor\tests\streamline-export\streamline-page.test.mjs`

---

### Task 1: 定义 manifest 与命名基础

**Files:**
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\manifest-store.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\normalize-name.mjs`
- Test: `C:\Code\data-editor\tests\streamline-export\manifest-store.test.mjs`
- Test: `C:\Code\data-editor\tests\streamline-export\normalize-name.test.mjs`

- [ ] **Step 1: 写 manifest-store 失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManifest,
  loadManifest,
  markManifestItemFailed,
  markManifestItemSuccess,
} from "../../scripts/streamline-export/lib/manifest-store.mjs";

test("createManifest writes pending items with stable output paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await createManifest({
    manifestPath: path,
    family: "micro-solid",
    items: [
      { slug: "attachment-1", name: "Attachment 1", iconUrl: "https://example.test/attachment-1" },
      { slug: "attachment-2", name: "Attachment 2", iconUrl: "https://example.test/attachment-2" },
    ],
    outputDir: "vendor/streamline-svg/micro-solid",
  });

  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.family, "micro-solid");
  assert.equal(manifest.items[0].status, "pending");
  assert.equal(manifest.items[0].outputPath, "vendor/streamline-svg/micro-solid/attachment-1.svg");
});

test("markManifestItemSuccess persists timestamp and output path", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await writeFile(path, JSON.stringify({
    family: "micro-solid",
    generatedAt: "2026-06-23T00:00:00.000Z",
    items: [
      { slug: "attachment-1", status: "pending", attempts: 0, outputPath: "vendor/streamline-svg/micro-solid/attachment-1.svg", error: null, extractedAt: null }
    ]
  }, null, 2));

  await markManifestItemSuccess({
    manifestPath: path,
    slug: "attachment-1",
    extractedAt: "2026-06-23T10:00:00.000Z",
  });

  const manifest = await loadManifest(path);
  assert.equal(manifest.items[0].status, "success");
  assert.equal(manifest.items[0].extractedAt, "2026-06-23T10:00:00.000Z");
  assert.equal(manifest.items[0].error, null);
});

test("markManifestItemFailed increments attempts and stores error", async () => {
  const root = await mkdtemp(join(tmpdir(), "streamline-manifest-"));
  const path = join(root, "micro-solid.manifest.json");
  await writeFile(path, JSON.stringify({
    family: "micro-solid",
    generatedAt: "2026-06-23T00:00:00.000Z",
    items: [
      { slug: "attachment-1", status: "pending", attempts: 0, outputPath: "vendor/streamline-svg/micro-solid/attachment-1.svg", error: null, extractedAt: null }
    ]
  }, null, 2));

  await markManifestItemFailed({
    manifestPath: path,
    slug: "attachment-1",
    error: "svg-not-found",
  });

  const manifest = await loadManifest(path);
  assert.equal(manifest.items[0].status, "failed");
  assert.equal(manifest.items[0].attempts, 1);
  assert.equal(manifest.items[0].error, "svg-not-found");
});
```

- [ ] **Step 2: 写 normalize-name 失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIconSlugToFilename } from "../../scripts/streamline-export/lib/normalize-name.mjs";

test("normalizeIconSlugToFilename keeps stable kebab slugs", () => {
  assert.equal(normalizeIconSlugToFilename("attachment-1"), "attachment-1.svg");
  assert.equal(normalizeIconSlugToFilename("edit-write-circle"), "edit-write-circle.svg");
});

test("normalizeIconSlugToFilename strips unsafe characters", () => {
  assert.equal(normalizeIconSlugToFilename(" Attachment 1 "), "attachment-1.svg");
  assert.equal(normalizeIconSlugToFilename("A/B:C"), "a-b-c.svg");
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
node --test tests/streamline-export/manifest-store.test.mjs tests/streamline-export/normalize-name.test.mjs
```

Expected:

- FAIL because `manifest-store.mjs` and `normalize-name.mjs` do not exist yet

- [ ] **Step 4: 写最小实现**

`C:\Code\data-editor\scripts\streamline-export\lib\normalize-name.mjs`

```js
export function normalizeIconSlugToFilename(slug) {
  const normalized = String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${normalized || "icon"}.svg`;
}
```

`C:\Code\data-editor\scripts\streamline-export\lib\manifest-store.mjs`

```js
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { normalizeIconSlugToFilename } from "./normalize-name.mjs";

export async function loadManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export async function saveManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function createManifest({ manifestPath, family, items, outputDir }) {
  const manifest = {
    family,
    generatedAt: new Date().toISOString(),
    items: items.map((item) => ({
      slug: item.slug,
      name: item.name,
      iconUrl: item.iconUrl,
      status: "pending",
      attempts: 0,
      outputPath: join(outputDir, normalizeIconSlugToFilename(item.slug)).replace(/\\\\/g, "/"),
      error: null,
      extractedAt: null,
    })),
  };
  await saveManifest(manifestPath, manifest);
}

function updateItem(manifest, slug, updater) {
  return {
    ...manifest,
    items: manifest.items.map((item) => (item.slug === slug ? updater(item) : item)),
  };
}

export async function markManifestItemSuccess({ manifestPath, slug, extractedAt }) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, slug, (item) => ({
      ...item,
      status: "success",
      error: null,
      extractedAt,
    })),
  );
}

export async function markManifestItemFailed({ manifestPath, slug, error }) {
  const manifest = await loadManifest(manifestPath);
  await saveManifest(
    manifestPath,
    updateItem(manifest, slug, (item) => ({
      ...item,
      status: "failed",
      attempts: (item.attempts ?? 0) + 1,
      error,
    })),
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
node --test tests/streamline-export/manifest-store.test.mjs tests/streamline-export/normalize-name.test.mjs
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add tests/streamline-export/manifest-store.test.mjs tests/streamline-export/normalize-name.test.mjs scripts/streamline-export/lib/manifest-store.mjs scripts/streamline-export/lib/normalize-name.mjs
git commit -m "feat: add streamline export manifest foundation"
```

### Task 2: 固化详情页 SVG 定位规则

**Files:**
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\streamline-page.mjs`
- Test: `C:\Code\data-editor\tests\streamline-export\streamline-page.test.mjs`

- [ ] **Step 1: 写 DOM 定位失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFindCurrentIconSvgScript,
  parseIconSlugFromUrl,
} from "../../scripts/streamline-export/lib/streamline-page.mjs";

test("parseIconSlugFromUrl extracts download slug", () => {
  assert.equal(
    parseIconSlugFromUrl("https://www.streamlinehq.com/icons/download/attachment-1--26582"),
    "attachment-1",
  );
});

test("find script prefers detail toolbar context over list cards", async () => {
  const html = `
    <body>
      <a href="/icons/download/attachment-1--26582"><figure><svg id="list-svg"></svg></figure></a>
      <div role="toolbar">
        <a href="/icons/download/attachment-2--26582">Attachment 2</a>
        <button>SVG</button>
        <button>Copy</button>
      </div>
      <div data-detail-preview>
        <svg id="detail-svg"><path d="M0 0"/></svg>
      </div>
    </body>
  `;
  const document = new DOMParser().parseFromString(html, "text/html");
  const script = buildFindCurrentIconSvgScript();
  const result = Function("document", `${script}; return findCurrentIconSvg();`)(document);
  assert.equal(result.svgId, "detail-svg");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test tests/streamline-export/streamline-page.test.mjs
```

Expected:

- FAIL because `streamline-page.mjs` does not exist yet

- [ ] **Step 3: 写最小实现**

`C:\Code\data-editor\scripts\streamline-export\lib\streamline-page.mjs`

```js
export function parseIconSlugFromUrl(iconUrl) {
  const match = String(iconUrl ?? "").match(/\/icons\/download\/([a-z0-9-]+)--/i);
  return match ? match[1].toLowerCase() : null;
}

export function buildFindCurrentIconSvgScript() {
  return `
    function findCurrentIconSvg() {
      const toolbars = [...document.querySelectorAll('[role="toolbar"]')];
      const detailToolbar = toolbars.find((toolbar) => {
        const text = (toolbar.textContent || "");
        return text.includes("Copy") && text.includes("Download");
      });
      if (!detailToolbar) return null;

      const detailRoot =
        detailToolbar.parentElement?.parentElement ??
        detailToolbar.parentElement ??
        detailToolbar;

      const detailSvg =
        detailRoot.querySelector('svg') ||
        detailRoot.parentElement?.querySelector('svg') ||
        null;

      if (!detailSvg) return null;
      return {
        svgId: detailSvg.getAttribute('id'),
        svgOuterHTML: detailSvg.outerHTML,
      };
    }
  `;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
node --test tests/streamline-export/streamline-page.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add tests/streamline-export/streamline-page.test.mjs scripts/streamline-export/lib/streamline-page.mjs
git commit -m "feat: add streamline detail svg locator"
```

### Task 3: 实现单图 DOM 提取脚本

**Files:**
- Create: `C:\Code\data-editor\scripts\streamline-export\extract-streamline-svg-dom.mjs`
- Create: `C:\Code\data-editor\scripts\streamline-export\lib\file-writer.mjs`

- [ ] **Step 1: 写文件写入最小实现**

`C:\Code\data-editor\scripts\streamline-export\lib\file-writer.mjs`

```js
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeSvgFile(outputPath, svgText) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${svgText.trim()}\n`, "utf8");
}
```

- [ ] **Step 2: 写 DOM 提取脚本骨架**

`C:\Code\data-editor\scripts\streamline-export\extract-streamline-svg-dom.mjs`

```js
import { loadManifest, markManifestItemFailed, markManifestItemSuccess } from "./lib/manifest-store.mjs";
import { writeSvgFile } from "./lib/file-writer.mjs";
import { buildFindCurrentIconSvgScript } from "./lib/streamline-page.mjs";

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node extract-streamline-svg-dom.mjs <manifestPath>");
  }

  const manifest = await loadManifest(manifestPath);
  console.log(JSON.stringify({
    message: "Use this script with a Chrome browser session runner.",
    family: manifest.family,
    pending: manifest.items.filter((item) => item.status !== "success").length,
    detailSvgScript: buildFindCurrentIconSvgScript(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 3: 运行脚本骨架确认可读 manifest**

Run:

```powershell
node scripts/streamline-export/extract-streamline-svg-dom.mjs artifacts/streamline-export/micro-solid.manifest.json
```

Expected:

- 打印 family、pending 数量和详情 SVG 查找脚本

- [ ] **Step 4: Commit**

```bash
git add scripts/streamline-export/lib/file-writer.mjs scripts/streamline-export/extract-streamline-svg-dom.mjs
git commit -m "feat: scaffold streamline dom extraction script"
```

### Task 4: 实现清单采集脚本

**Files:**
- Create: `C:\Code\data-editor\scripts\streamline-export\collect-streamline-icons.mjs`

- [ ] **Step 1: 写采集脚本最小接口**

`C:\Code\data-editor\scripts\streamline-export\collect-streamline-icons.mjs`

```js
import { createManifest } from "./lib/manifest-store.mjs";

async function main() {
  const manifestPath = process.argv[2];
  const family = process.argv[3];
  if (!manifestPath || !family) {
    throw new Error("Usage: node collect-streamline-icons.mjs <manifestPath> <family>");
  }

  await createManifest({
    manifestPath,
    family,
    outputDir: `vendor/streamline-svg/${family}`,
    items: [],
  });

  console.log(JSON.stringify({ manifestPath, family, message: "Manifest scaffold created. Fill items from browser collector next." }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: 运行脚本确认输出**

Run:

```powershell
node scripts/streamline-export/collect-streamline-icons.mjs artifacts/streamline-export/micro-solid.manifest.json micro-solid
```

Expected:

- 生成空 manifest scaffold

- [ ] **Step 3: Commit**

```bash
git add scripts/streamline-export/collect-streamline-icons.mjs
git commit -m "feat: add streamline manifest scaffold command"
```

### Task 5: 实现校验脚本

**Files:**
- Create: `C:\Code\data-editor\scripts\streamline-export\verify-streamline-svg.mjs`

- [ ] **Step 1: 写校验脚本**

`C:\Code\data-editor\scripts\streamline-export\verify-streamline-svg.mjs`

```js
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { loadManifest } from "./lib/manifest-store.mjs";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node verify-streamline-svg.mjs <manifestPath>");
  }

  const manifest = await loadManifest(manifestPath);
  const results = [];
  for (const item of manifest.items) {
    const present = await exists(item.outputPath);
    const content = present ? await readFile(item.outputPath, "utf8") : "";
    results.push({
      slug: item.slug,
      status: item.status,
      present,
      hasSvg: content.includes("<svg"),
      empty: content.trim().length === 0,
    });
  }

  console.log(JSON.stringify({
    family: manifest.family,
    total: results.length,
    success: results.filter((item) => item.status === "success").length,
    missingFiles: results.filter((item) => !item.present).map((item) => item.slug),
    invalidSvg: results.filter((item) => item.present && !item.hasSvg).map((item) => item.slug),
    emptyFiles: results.filter((item) => item.present && item.empty).map((item) => item.slug),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: 运行校验脚本**

Run:

```powershell
node scripts/streamline-export/verify-streamline-svg.mjs artifacts/streamline-export/micro-solid.manifest.json
```

Expected:

- 输出 total、success、missingFiles、invalidSvg、emptyFiles

- [ ] **Step 3: Commit**

```bash
git add scripts/streamline-export/verify-streamline-svg.mjs
git commit -m "feat: add streamline svg verification report"
```

### Task 6: 小范围试点执行说明

**Files:**
- Modify: `C:\Code\data-editor\docs\plans\2026-06-23-Streamline页面DOM直提SVG方案.md`
- Modify: `C:\Code\data-editor\docs\plans\2026-06-23-Streamline页面DOM直提SVG实施计划.md`

- [ ] **Step 1: 在方案文档补试点命令段**

追加内容：

```md
### 试点命令

```powershell
node scripts/streamline-export/collect-streamline-icons.mjs artifacts/streamline-export/micro-solid.manifest.json micro-solid
node scripts/streamline-export/extract-streamline-svg-dom.mjs artifacts/streamline-export/micro-solid.manifest.json
node scripts/streamline-export/verify-streamline-svg.mjs artifacts/streamline-export/micro-solid.manifest.json
```
```

- [ ] **Step 2: 复跑相关测试**

Run:

```powershell
node --test tests/streamline-export/manifest-store.test.mjs tests/streamline-export/normalize-name.test.mjs tests/streamline-export/streamline-page.test.mjs
```

Expected:

- PASS

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-06-23-Streamline页面DOM直提SVG方案.md docs/plans/2026-06-23-Streamline页面DOM直提SVG实施计划.md
git commit -m "docs: add streamline dom svg pilot commands"
```

---

## 自检

- 方案覆盖：
  - 已覆盖 manifest、DOM 定位、落盘、校验、试点顺序
- 占位符扫描：
  - 没有 `TODO` / `TBD`
- 类型一致性：
  - `status` 使用 `pending | success | failed`
  - 输出固定为 `.svg`

## 执行交接

Plan complete and saved to `docs/plans/2026-06-23-Streamline页面DOM直提SVG实施计划.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
