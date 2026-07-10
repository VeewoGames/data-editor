# Relation Target File Searchable Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `RelationConfigDialog` 的“目标文件”增加快速搜索筛选能力，并与自动化目标文件选择共用同一个受控 `SearchablePicker` 公共组件。

**Architecture:** 先把自动化目标文件选择里现有的 `Popover + 搜索框 + 列表` 外壳抽成中性受控组件，再让自动化目标文件与 relation 目标文件都接到这个组件上。业务侧继续持有 `open/query/value` 真值、候选构建逻辑与选中回写逻辑，公共组件只承载 UI 外壳与基础交互。

**Tech Stack:** React 18, TypeScript, Radix `Popover` / `Dialog` / `Select`, existing CSS in `src/styles.css`, Node built-in test runner, Playwright

---

## File Structure

- Create: `src/components/SearchablePicker.tsx`
  - 受控 searchable picker 公共组件，负责 `Popover`、搜索输入、列表容器、空态、关闭时清 query 的事件透传接口。
- Create: `tests/searchable-picker-utils.test.mjs`
  - 纯函数测试，覆盖文件名/路径匹配行为，避免为本轮单独引入 React 组件测试框架。
- Modify: `src/components/RelationConfigDialog.tsx`
  - 将“目标文件”从 `Select` 改为公共 `SearchablePicker`，保留 `targetFile/pendingCollection/pendingKey/loadDocument` 原逻辑。
- Modify: `src/App.tsx`
  - 将自动化“目标文件”切到公共 `SearchablePicker`，保留 `targetPickerOpenId/targetPickerQuery` 受控模型与现有 helper。
- Modify: `src/styles.css`
  - 从 `automation-*` 样式中抽出 searchable picker 的中性样式类；relation 只复用内容弹层样式，不改整个 dialog 主宽度。
- Modify: `tests/data-editor.spec.ts`
  - 将 relation 的 `chooseDialogSelect(...)` 拆成或扩展为兼容 searchable picker；补 relation 与 automation 的回归用例。

## Task 1: 抽离共享匹配 helper 与纯函数测试

**Files:**
- Create: `tests/searchable-picker-utils.test.mjs`
- Modify: `src/App.tsx`
- Modify: `src/components/RelationConfigDialog.tsx`

- [ ] **Step 1: 先抽出可复用的文件名描述与匹配 helper 设计**

```ts
function describeFileBasename(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function matchesFileSearchQuery(filePath: string, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return filePath.toLowerCase().includes(normalized) || describeFileBasename(filePath).toLowerCase().includes(normalized);
}
```

- [ ] **Step 2: 先写纯函数失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { describeFileBasename, matchesFileSearchQuery } from "../src/searchable-picker-utils.mjs";

test("matches file query by full path and basename", () => {
  assert.equal(matchesFileSearchQuery("data/affixes.json", "affixes"), true);
  assert.equal(matchesFileSearchQuery("data/analysis/prototype_mechanic_gap.json", "analysis/prototype"), true);
  assert.equal(matchesFileSearchQuery("data/affixes.json", "runes"), false);
});

test("empty query keeps all file options visible", () => {
  assert.equal(matchesFileSearchQuery("data/affixes.json", ""), true);
  assert.equal(matchesFileSearchQuery("data/affixes.json", "   "), true);
});

test("describe basename strips directory segments", () => {
  assert.equal(describeFileBasename("data/analysis/prototype_mechanic_gap.json"), "prototype_mechanic_gap.json");
});
```

- [ ] **Step 3: 运行测试确认先失败**

Run:

```powershell
node --test tests/searchable-picker-utils.test.mjs
```

Expected: FAIL，报缺少 `src/searchable-picker-utils.mjs` 或缺少导出。

- [ ] **Step 4: 写最小 helper 实现**

```js
export function describeFileBasename(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function matchesFileSearchQuery(filePath, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return true;
  const fullPath = String(filePath ?? "").toLowerCase();
  const basename = describeFileBasename(filePath).toLowerCase();
  return fullPath.includes(normalized) || basename.includes(normalized);
}
```

- [ ] **Step 5: 回接自动化/ relation 现有 helper 到共享实现**

```ts
import { describeFileBasename, matchesFileSearchQuery } from "./searchable-picker-utils.mjs";

function describeTargetFileName(filePath: string) {
  return describeFileBasename(filePath);
}

function matchesAutomationTargetFileQuery(option: AutomationTargetCatalogItem, query: string) {
  return matchesFileSearchQuery(option.file, query);
}
```

```ts
const visibleFiles = props.files.filter((file) => matchesFileSearchQuery(file.path, targetFileQuery));
```

- [ ] **Step 6: 运行 helper 测试确认通过**

Run:

```powershell
node --test tests/searchable-picker-utils.test.mjs
```

Expected: PASS，3 tests passing。

- [ ] **Step 7: Commit**

```powershell
git add src/searchable-picker-utils.mjs tests/searchable-picker-utils.test.mjs src/App.tsx src/components/RelationConfigDialog.tsx
git commit -m "抽取文件搜索匹配 helper"
```

## Task 2: 新建受控 SearchablePicker 公共组件与中性样式

**Files:**
- Create: `src/components/SearchablePicker.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 先写组件骨架，锁定受控 API**

```ts
type SearchablePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  trigger: React.ReactNode;
  searchPlaceholder: string;
  searchAriaLabel: string;
  listAriaLabel: string;
  emptyContent: React.ReactNode;
  contentClassName?: string;
  shellClassName?: string;
  listClassName?: string;
  children: React.ReactNode;
};
```

- [ ] **Step 2: 写最小受控组件实现**

```tsx
import * as Popover from "@radix-ui/react-popover";

export function SearchablePicker(props: SearchablePickerProps) {
  const {
    open,
    onOpenChange,
    query,
    onQueryChange,
    trigger,
    searchPlaceholder,
    searchAriaLabel,
    listAriaLabel,
    emptyContent,
    contentClassName = "",
    shellClassName = "",
    listClassName = "",
    children,
  } = props;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) onQueryChange("");
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`menu-content searchable-picker-content ${contentClassName}`.trim()} sideOffset={6} align="start">
          <div className={`searchable-picker-shell ${shellClassName}`.trim()}>
            <input
              aria-label={searchAriaLabel}
              className="searchable-picker-search"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              value={query}
            />
            <div
              className={`searchable-picker-list ${listClassName}`.trim()}
              role="listbox"
              aria-label={listAriaLabel}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {children || emptyContent}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 3: 把空态判定收敛到调用侧，避免组件理解业务 option shape**

```tsx
<SearchablePicker
  open={open}
  onOpenChange={setOpen}
  query={query}
  onQueryChange={setQuery}
  trigger={<button type="button" className="select-trigger">...</button>}
  searchPlaceholder="筛选文件..."
  searchAriaLabel="筛选目标文件"
  listAriaLabel="目标文件候选列表"
  emptyContent={<div className="searchable-picker-empty">没有匹配的文件。</div>}
>
  {visibleOptions.map(...)}
</SearchablePicker>
```

- [ ] **Step 4: 抽取中性样式，不再让公共组件依赖 `automation-*` 命名**

```css
.searchable-picker-content {
  min-width: 280px;
  width: min(460px, calc(100vw - 48px));
}

.searchable-picker-shell {
  display: grid;
  gap: 10px;
}

.searchable-picker-search {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  min-height: 34px;
  padding: 6px 10px;
}

.searchable-picker-list {
  display: grid;
  gap: 4px;
  max-height: min(320px, calc(100vh - 220px));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.searchable-picker-empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 8px 10px;
}
```

- [ ] **Step 5: 运行 typecheck，确认公共组件签名可编译**

Run:

```powershell
npm run typecheck
```

Expected: PASS，无 `SearchablePicker` props / JSX 类型错误。

- [ ] **Step 6: Commit**

```powershell
git add src/components/SearchablePicker.tsx src/styles.css
git commit -m "新增受控 searchable picker 公共组件"
```

## Task 3: 迁移自动化目标文件选择到公共组件

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 先只替换自动化“目标文件”picker，不碰目标集合**

```tsx
<SearchablePicker
  open={targetPickerOpenId === filePickerId}
  onOpenChange={(open) => {
    setTargetPickerOpenId(open ? filePickerId : null);
    if (!open) setTargetPickerQuery("");
  }}
  query={targetPickerQuery}
  onQueryChange={setTargetPickerQuery}
  searchPlaceholder="筛选文件..."
  searchAriaLabel="筛选目标文件"
  listAriaLabel="目标文件候选列表"
  contentClassName="automation-target-picker-content"
  listClassName="automation-target-picker-list"
  trigger={(
    <button
      type="button"
      className="select-trigger automation-target-picker-trigger"
      aria-label={`目标文件 ${targetIndex + 1}`}
      title={target.file}
    >
      <span className="automation-target-picker-trigger__value">{describeTargetFileName(target.file)}</span>
      <icons.chevronDown size={16} />
    </button>
  )}
  emptyContent={<div className="searchable-picker-empty">没有匹配的文件。</div>}
>
  {visibleFileOptions.map((option) => (
    <button
      className={`searchable-picker-option automation-target-picker-option ${option.file === target.file ? "is-selected" : ""}`}
      key={option.file}
      type="button"
      onClick={() => {
        updateRuleTargetFile(selectedIndex, targetIndex, option.file);
        setTargetPickerOpenId(null);
        setTargetPickerQuery("");
      }}
      title={option.file}
    >
      <span className="searchable-picker-option__title">{describeTargetFileName(option.file)}</span>
    </button>
  ))}
</SearchablePicker>
```

- [ ] **Step 2: 保留自动化现有受控状态模型**

```ts
const [targetPickerOpenId, setTargetPickerOpenId] = useState<string | null>(null);
const [targetPickerQuery, setTargetPickerQuery] = useState("");
```

Requirement: 不新增 `SearchablePicker` 内部 query state，不引入第二套 target picker 状态。

- [ ] **Step 3: 只把公共样式别名回自动化 modifier，避免目标集合被误改**

```css
.automation-target-picker-content {
  width: min(460px, calc(100vw - 48px));
}

.automation-target-picker-list {
  gap: 2px;
}

.automation-target-picker-option {
  align-items: center;
  min-height: 38px;
  padding: 6px 10px;
}
```

- [ ] **Step 4: 运行 typecheck 和现有自动化相关 E2E**

Run:

```powershell
npm run typecheck
npx playwright test tests/data-editor.spec.ts -g "automation settings loads personal rules and local bindings"
```

Expected: PASS，自动化对话框仍能显示既有目标文件值与 chip 摘要。

- [ ] **Step 5: Commit**

```powershell
git add src/App.tsx src/styles.css
git commit -m "迁移自动化目标文件选择到公共 picker"
```

## Task 4: 将 relation 目标文件切到公共 SearchablePicker

**Files:**
- Modify: `src/components/RelationConfigDialog.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 为 relation 目标文件引入局部受控状态**

```ts
const [targetFilePickerOpen, setTargetFilePickerOpen] = useState(false);
const [targetFileQuery, setTargetFileQuery] = useState("");
```

- [ ] **Step 2: 在对话框打开时同步清理 relation picker 状态**

```ts
useEffect(() => {
  if (!props.open) {
    setTargetFilePickerOpen(false);
    setTargetFileQuery("");
    return;
  }
  setTargetFilePickerOpen(false);
  setTargetFileQuery("");
}, [props.open]);
```

- [ ] **Step 3: 将“目标文件”从 `Select.Root` 替换为 `SearchablePicker`**

```tsx
const visibleTargetFiles = props.files.filter((file) => matchesFileSearchQuery(file.path, targetFileQuery));

<SearchablePicker
  open={targetFilePickerOpen}
  onOpenChange={setTargetFilePickerOpen}
  query={targetFileQuery}
  onQueryChange={setTargetFileQuery}
  searchPlaceholder="筛选文件..."
  searchAriaLabel="筛选目标文件"
  listAriaLabel="目标文件候选列表"
  contentClassName="relation-target-file-picker-content"
  trigger={(
    <button type="button" className="select-trigger relation-target-file-picker-trigger" title={targetFile}>
      <span className="relation-target-file-picker-trigger__value">{describeFileBasename(targetFile || "选择目标文件")}</span>
      <icons.chevronDown size={16} />
    </button>
  )}
  emptyContent={<div className="searchable-picker-empty">没有匹配的文件。</div>}
>
  {visibleTargetFiles.map((file) => (
    <button
      key={file.path}
      type="button"
      className={`searchable-picker-option ${file.path === targetFile ? "is-selected" : ""}`}
      onClick={() => {
        setPendingCollection("");
        setPendingKey("");
        setTargetCollection("");
        setTargetKey("");
        setTargetFile(file.path);
        setTargetFilePickerOpen(false);
        setTargetFileQuery("");
      }}
      title={file.path}
    >
      <span className="searchable-picker-option__title">{describeFileBasename(file.path)}</span>
    </button>
  ))}
</SearchablePicker>
```

- [ ] **Step 4: 保留其余三个字段的 `Select` 语义不变**

Requirement:

```txt
目标集合 -> 继续 Select
目标主键 -> 继续 Select
关系模式 -> 继续 Select
```

不要顺手把 relation 全部选择器一起重构。

- [ ] **Step 5: 只调 relation picker content 样式，不改整个 dialog 宽度**

```css
.relation-target-file-picker-content {
  width: min(460px, calc(100vw - 48px));
}

.relation-target-file-picker-trigger {
  width: 100%;
}

.relation-target-file-picker-trigger__value {
  color: inherit;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 6: 运行 typecheck，确认 relation 对话框编译通过**

Run:

```powershell
npm run typecheck
```

Expected: PASS，无 `Select.Trigger` 残留引用错误、无 `SearchablePicker` import 错误。

- [ ] **Step 7: Commit**

```powershell
git add src/components/RelationConfigDialog.tsx src/styles.css
git commit -m "为关联字段目标文件接入公共搜索选择器"
```

## Task 5: 修正 Playwright helper 并补 relation / automation 回归

**Files:**
- Modify: `tests/data-editor.spec.ts`

- [ ] **Step 1: 先拆 relation 目标文件专用 helper，避免污染其它 Select 用例**

```ts
async function chooseRelationTargetFile(page: Page, option: string, query?: string) {
  const field = page.locator(".relation-config-dialog .dialog-field").filter({ hasText: "目标文件" });
  const trigger = field.locator(".relation-target-file-picker-trigger");
  await trigger.click();
  if (query) {
    await page.getByRole("textbox", { name: "筛选目标文件" }).fill(query);
  }
  await page.getByRole("button", { name: option }).first().click();
}
```

- [ ] **Step 2: 让 `configureRelation(...)` 只把“目标文件”改走新 helper，其余字段仍复用 `chooseDialogSelect(...)`**

```ts
async function configureRelation(page: Page, fieldName: string, options: {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  mode: "single" | "multi";
}) {
  ...
  await chooseRelationTargetFile(page, "affixes.json", "affixes");
  await chooseDialogSelect(page, "目标集合", options.targetCollection);
  await chooseDialogSelect(page, "目标主键", options.targetKey);
  await chooseDialogSelect(page, "关系模式", options.mode);
  ...
}
```

- [ ] **Step 3: 为 relation 增加搜索选择用例**

```ts
test("relation config target file supports searchable picker", async ({ page }) => {
  await page.goto("/");
  await configureRelation(page, "starting_random_pool", {
    targetFile: "data/affixes.json",
    targetCollection: "$",
    targetKey: "id",
    mode: "multi",
  });
  await expect(page.locator('[data-column-field="starting_random_pool"]')).toBeVisible();
});
```

- [ ] **Step 4: 为自动化加一个最小搜索回归，不只检查已有值**

```ts
test("automation target file picker still filters visible files after shared picker extraction", async ({ page }) => {
  ...
  await page.getByRole("combobox", { name: "目标文件 1" }).click();
  await page.getByRole("textbox", { name: "筛选目标文件" }).fill("e2e_select");
  await expect(page.getByRole("button", { name: "e2e_select.json" })).toBeVisible();
});
```

- [ ] **Step 5: 运行针对性回归**

Run:

```powershell
npx playwright test tests/data-editor.spec.ts -g "relation config target file supports searchable picker|automation target file picker still filters visible files after shared picker extraction|automation settings loads personal rules and local bindings"
```

Expected: PASS，relation 能通过搜索选中文件，自动化搜索行为不退化。

- [ ] **Step 6: 运行最终收口验证**

Run:

```powershell
node --test tests/searchable-picker-utils.test.mjs
npm run typecheck
npx playwright test tests/data-editor.spec.ts -g "relation config target file supports searchable picker|automation target file picker still filters visible files after shared picker extraction|automation settings loads personal rules and local bindings"
```

Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```powershell
git add tests/data-editor.spec.ts
git commit -m "补充搜索选择器 relation 与 automation 回归"
```

## Self-Review Checklist

- [ ] spec 里“只改目标文件，不改目标集合/目标主键”在 Task 4 中有明确约束
- [ ] 公共组件受控 `open/query` 的要求在 Task 2/Task 3/Task 4 都有落点
- [ ] 没有为本轮引入新的 React 组件测试框架
- [ ] relation E2E helper 调整已明确写入 Task 5，而不是留到实现时临场处理
- [ ] 样式只抽公共 picker 壳，没有把 relation 整体 dialog 改版混进来
