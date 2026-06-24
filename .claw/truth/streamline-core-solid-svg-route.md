# Streamline core-solid SVG 路线切换

status: accepted

## context

`core-solid` 这条 family 的正式批量 SVG 导出路线已经从网页端 `Copy SVG` / `Download SVG` 彻底切换为官方 `hash -> MCP/API -> svg -> manifest success/failed` 路线。这个切换不是偏好调整，而是由真实执行结果推动的：网页端 `Copy SVG` 会持续卡在 `COPYING...`，同时官方页面已经出现 `100% of your weekly downloads used`，说明浏览器导出不再适合作为批量主路径。

在本次收口前，`artifacts/streamline-export/core-solid-full.manifest.json` 先完成了 `core-solid` 全量导入，再通过 `--retry-failed` 把先前的 `38` 个 failed 收口确认；这些 failed 全部属于可恢复异常，不是永久缺失资源。

随后在全量导入完成后，又发现 manifest 中存在 `12` 组 exact duplicate，它们不是缺文件，而是同一 `itemId/sourceId/hash/outputPath` 被重复记入 manifest，导致 manifest 数量大于 registry 数量。对应的收口修复已经落到 `scripts/streamline-export/repair-streamline-manifest-collisions.mjs`，并由 `tests/streamline-export/repair-streamline-manifest-collisions.test.mjs` 覆盖 exact duplicate 去重行为。

`scripts/streamline-export/verify-streamline-svg.mjs` 已经修正 CLI 入口守卫，避免被测试导入时误执行 `main()`，因此它可以作为每批导入后的 manifest / 磁盘收口校验门。

## 结论

1. `core-solid` 的正式批量主路径已经固定为 `hash -> MCP/API -> svg`，不再把网页端 `Copy SVG` 或 `Download SVG` 作为批量主路径。
2. `scripts/streamline-export/import-streamline-svg-from-mcp.mjs` 是当前这条非 Copy 路线的正式导入入口，对应的核心调用语义是 `get_icon_by_hash -> svg -> 本地文件 -> manifest success/failed`。
3. `scripts/streamline-export/verify-streamline-svg.mjs` 是导入后的正式验证门，用来收口 manifest 与磁盘文件是否一致，避免只看导入过程日志。
4. `scripts/streamline-export/repair-streamline-manifest-collisions.mjs` 已把 exact duplicate 去重作为正式收口步骤；在当前结果里，`duplicateSlugExactDuplicateGroups = 0`，说明 exact duplicate 已清理完毕，剩余碰撞只保留为正常变体碰撞。
5. `core-solid` 正式修复后，manifest 权威状态已经收敛为 `success 5603 / pending 0 / failed 0`，对应 `verify-svg` 结果为 `presentFiles 5603`、`missingFiles []`、`invalidSvg []`、`emptyFiles []`。
6. `core-solid` preview registry 已重生为 `5603` icons；随后主 registry 默认输入范围也已扩展为 `micro-solid + micro-line + core-solid`，`src/generated/streamline-shared-view-icons.*` 当前总图标数 `9535`，groups `3`。

## 相关代码

- `scripts/streamline-export/hydrate-streamline-manifest-hashes.mjs`
- `scripts/streamline-export/import-streamline-item-hashes.mjs`
- `scripts/streamline-export/import-streamline-svg-from-mcp.mjs`
- `scripts/streamline-export/verify-streamline-svg.mjs`
- `scripts/streamline-export/repair-streamline-manifest-collisions.mjs`
- `scripts/streamline-export/lib/streamline-family-entry-config.mjs`
- `docs/10_Streamline图标资产导入.md`
- `docs/11_Streamline core-solid 非Copy导出方案.md`

## 长期行为 / 规则

- `core-solid` 后续批量导出统一以 manifest 中的官方 `hash` 为入口，不再回到浏览器单标签 `Copy SVG` 作为正式路径。
- `STREAMLINE_API_KEY` 是非 Copy 路线的硬前提；缺少它时，问题应被表述为“外部 API 前提未满足”，而不是“导出脚本不可用”。
- `verify-streamline-svg.mjs` 应在每批导入后执行，用于确认 `success` 文件、`pending` 文件和 `failed` 文件都与 manifest 状态一致。
- `repair-streamline-manifest-collisions.mjs` 负责把 exact duplicate 从 manifest 中清出去；它只处理同一 `itemId/sourceId/hash/outputPath` 的重复记账，不应把正常变体碰撞当成缺陷。
- 网页端 `Copy SVG` / `Download SVG` 只保留给偶发人工检查、局部核对和故障定位，不再承担正式批量吞吐职责。

## 验证标准

- 本次验证收口时，`verify-svg:core-solid` 的 `presentFiles` 为 `5603`，`missingFiles`、`invalidSvg`、`emptyFiles` 均为空。
- `core-solid` manifest 已收敛到 `success 5603 / pending 0 / failed 0`，且 exact duplicate 已被修复为 `0` 组。
- `core-solid` preview registry 与主 registry 产物都已更新，主 registry 当前总图标数为 `9535`，groups 为 `3`。

## update 2026-06-24 batch-48

### decision delta

7. `core-solid` 的正式批量 SVG 路径已经稳定收敛为 `hash -> MCP/API -> svg -> manifest success/failed`；网页端 `Copy SVG` / `Download SVG` 只保留给人工核对、局部排障和偶发检查，不再承担正式批量吞吐职责。
8. 对 `failed` 项的正式收口策略是先继续批量推进 `pending`，再单独执行 `--retry-failed`；首次出现 `failed` 时不应直接把它视为永久失败或缺失资源。
9. 当 manifest 数量与 registry 数量不一致时，应先审计 exact duplicate；若确认是同一 `itemId/sourceId/hash/outputPath` 的重复记账，正式修复入口固定为 `scripts/streamline-export/repair-streamline-manifest-collisions.mjs`，不走人工改 registry 或手工改 JSON。
10. 主 registry 的默认输入范围已经扩展为 `micro-solid + micro-line + core-solid`，`core-solid` 不再停留在 preview-only。

### consequence delta

- 这把 `core-solid` 的批量导出、失败收口、碰撞修复和 registry 输入范围统一进同一条长期规则，后续不再需要把网页端导出当成正式主路径。
- `failed` 的第一次落盘只是暂态信号，正式收口仍要靠后续 `pending` 推进和独立的 `--retry-failed` 阶段完成。
- manifest / registry 不一致时，先查 exact duplicate 再走 `repair-streamline-manifest-collisions.mjs`，可以避免把正常重复记账误当成手工修复问题。
- `core-solid` 已进入主 registry 的默认输入面，因此后续生成与验收不应再把它当成仅供 preview 的例外家族。

## 关键检索词

`core-solid`、`Copy SVG`、`Download SVG`、`COPYING...`、`weekly downloads used`、`hash -> MCP/API -> svg`、`get_icon_by_hash`、`STREAMLINE_API_KEY`、`verify-streamline-svg.mjs`、`import-streamline-svg-from-mcp.mjs`、`--retry-failed`、`exact duplicate`、`repair-streamline-manifest-collisions.mjs`、`preview-only`
