# shared view 字段隐藏排障：优先检查 profile `viewLayouts` 对 `hidden` 的覆盖

status: accepted

## context

本条 truth 记录 `skills.json` 的“全部”标签组里 enemy 相关字段仍显示这一类问题的长期排障入口。当前真实根因边界不是 `shared-views.json` 缺少 `hidden`，而是浏览器最终渲染时会优先合并个人 profile 里的 `viewLayouts`，并且 `hidden` 的覆盖语义是整组替换，不是与 shared base 做并集。

## 结论

1. 当某个 shared view 明明已经在 `C:\Code\Nocturnel\.data-editor\shared-views.json` 配好了 `hidden`，但浏览器里字段仍然显示时，优先检查对应 profile 文件里的 `viewLayouts`，不要先假设 shared 配置没生效。
2. 真实渲染链路里，`src/view-state-storage.mjs` 的 `readViewLayoutState()` 会先取 profile 中同 collection 的 `all` 基底布局，再叠加当前 view 的 `activeLayout`，得到浏览器实际使用的列布局。
3. `mergeCollectionViewState()` 对 `hidden` 的判定不是“补丁式追加”，而是只要 `overrideState.hidden` 非空，或 `overrideState.overrides.hidden === true`，就直接用 override 的整组 `hidden` 替换 base 的 `hidden`。
4. 因此，只要个人 profile 里还保留旧的 `hidden` 集合，就会把 shared view 新增的隐藏字段整体盖掉；这属于 shared view 与个人布局分层覆盖问题，不属于 shared view 缺配置。

## 长期规则

- shared view 的 `hidden` 是团队基线，profile `viewLayouts` 是最终渲染前的个人覆盖层。
- 排查“团队已经隐藏，但我这里还看得到”的问题时，顺序应是：先看 `shared-views.json` 是否已配，再看当前命名 profile 的 `viewLayouts` 是否保留旧覆盖。
- 只要 profile override 仍存在，shared base 后续新增的 `hidden` 字段不会自动透传到该用户当前视图。

## 真实渲染链路

- `src/App.tsx` 读取当前 collection/view 的布局时，会调用 `readViewLayoutState(...)`
- `src/view-state-storage.mjs` 的 `readViewLayoutState(...)`：
  - 从 `profile.viewLayouts[collectionKey][viewId]` 读取 `activeLayout`
  - 从 `profile.viewLayouts[collectionKey].all` 读取 `baseLayout`
  - 调用 `mergeCollectionViewState(baseLayout, activeLayout)` 生成最终布局
- `mergeCollectionViewState(...)` 里，`hidden` / `wrapped` / `order` / `detailOrder` 都按“有 override 就整组覆盖”的规则处理；`widths` 才是对象级合并

## 本轮稳定例子

- `C:\Code\Nocturnel\.data-editor\shared-views.json` 中，`skills` 的“全部”标签组叶子视图已经包含 enemy 相关字段的 `hidden`
- `C:\Code\Nocturnel\.data-editor\view-configs\Lans.json` 中，对多个 `skills` 视图仍保留了只含 `icon_path` 等旧字段的 `hidden`
- 结果是浏览器最终采用 `Lans.json` 的旧 `hidden` 覆盖层，shared 新增的 enemy 字段隐藏没有实际渲染出来

## 关联代码

- `src/view-state-storage.mjs`
- `src/App.tsx`
- `docs/05_数据与配置模型.md`
- `C:\Code\Nocturnel\.data-editor\shared-views.json`
- `C:\Code\Nocturnel\.data-editor\view-configs\Lans.json`

## 验证标准

- `shared-views.json` 中目标 shared view 已包含预期 `hidden`
- 当前 profile 的 `viewLayouts` 中存在同 collection/view 的 `hidden` override，且内容仍是旧集合
- 删除或重建该 profile 布局覆盖后，shared 新增的隐藏字段开始生效

## 关键检索词

`shared-views.json`、`viewLayouts`、`hidden override`、`readViewLayoutState`、`mergeCollectionViewState`、`skills.json`、`全部`、`enemy`、`Lans.json`
