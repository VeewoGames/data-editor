# Streamline Export Manifest 与 Tags 元数据接入

## 范围

本轮沉淀 `Streamline` Tags 的稳定真值源、manifest 元数据回写链路、并行批量回填的正式执行路径、离线官方 metadata 导入的正式折中方案，以及在线详情页批量回填的长期限制。核心边界不在列表页 DOM，而在详情页内嵌的 JSON state。

## 结论

- `Streamline` 官方 `tags` 的稳定真值源仍然是详情页页面内嵌的 `script[type="application/json"]`，其中 `props.pageProps.initialState.streamlineApi.queries.getIconDetailsBySlugAndSubcategoryId(...)` 已实测包含官方 `tags` 数组。
- manifest metadata 回填现在有两条正式执行边界：默认生产推进仍以“并行抓取 + 批量安全写回”为主，而低频真实站点回填则以 `humanMode` 小批次链路作为正式补充，统一由 `scripts/streamline-export/run-streamline-metadata-session.mjs` 的 loop runner 承接，而不是临时在线操作页。
- `humanMode` 不是宽松开关，而是受约束的正式模式：`scripts/streamline-export/run-streamline-metadata-session.mjs` 会自动套用推荐 pacing 默认值，`scripts/streamline-export/lib/streamline-metadata-session.mjs` 会强制 `concurrency = 1`，`scripts/streamline-export/extract-streamline-detail-metadata.mjs` 负责逐项执行 pre-navigation、post-load、post-item 三段节奏控制。
- 当真实站点批量访问稳定命中 `403 Forbidden` / `Server: Vercel` 时，正式折中方案是保留 manifest 的官方 `hash`，再通过离线官方 metadata 导入脚本按 `hash` 优先、`slug` 兜底回填 `tags`。
- 在线详情页回填不应再表述为“只能做 smoke demo 的临时工具”：它的正式边界是“真实 Chrome 登录态下的 low-frequency human-mode 小批次回填”，可稳定推进 manifest，但不适合扩展成高并发或全量生产抓取。
- registry 消费链路已经把回填 `tags` 视为正式搜索语料：`scripts/streamline-export/generate-shared-view-streamline-icons.mjs` 会把 `tags` 原样输出到 registry，并合并进 `searchText`，下游搜索无需额外建立第二套 tags 索引。

## 真值源

- `https://www.streamlinehq.com/icons/micro-line` 与 `https://www.streamlinehq.com/icons/micro-solid` 已确认是 family 入口。
- 列表页首屏卡片 DOM 与首个分组 state 只稳定提供 `slug`、`name`、`url`，不直接暴露官方 `tags`。
- 直接抓列表页 HTML 会命中 Vercel Security Checkpoint，因此裸 HTTP 和列表 DOM 都不能作为 `tags` 真值源。
- 详情页页面内嵌的 `script[type="application/json"]` 中，`props.pageProps.initialState.streamlineApi.queries.getIconDetailsBySlugAndSubcategoryId(...)` 已实测包含官方 `tags` 数组，是当前稳定真值源。

## 离线官方 metadata 导入

- `scripts/streamline-export/import-streamline-official-metadata.mjs` 是正式的离线导入入口，接收 `manifestPath` 和 `metadataPath`，再把官方 metadata 合并回 manifest。
- `scripts/streamline-export/lib/streamline-official-metadata-source.mjs` 负责把官方 metadata 记录索引成 `hash` / `slug` 双索引，并在匹配时优先走 `hash`，只有找不到 `hash` 才回退到 `slug`。
- `scripts/streamline-export/lib/streamline-metadata-manifest.mjs` 负责选择待回填项并构造 metadata 更新 payload；失败项在未显式 `retryFailed` 时保持跳过，避免把旧失败记录误当成新一轮全量推进。
- `scripts/streamline-export/lib/manifest-store.mjs` 的 `updateManifestItemsMetadataBatch` 是批量回写收敛点，避免并发场景下对整份 manifest 的重复覆盖。

## 长期行为 / 规则

- `scripts/streamline-export/lib/manifest-store.mjs` 负责统一归一化 metadata，并提供 `updateManifestItemsMetadataBatch`、`summarizeManifestMetadata`、`loadManifestMetadataSummary`，使批量写回与真实进度统计成为正式能力。
- `scripts/streamline-export/extract-streamline-detail-metadata.mjs` 负责详情页 metadata 提取；`runManifestMetadataExtractionParallel` 以 tab chunk 并行抓取，并在 chunk 结束后统一批量写回 manifest。
- `scripts/streamline-export/extract-streamline-detail-metadata.mjs` 的并行路径会按 tab 分块并发处理 manifest items，再在每个 chunk 完成后统一调用 `updateManifestItemsMetadataBatch`，避免单项并发写回时整文件互相覆盖。
- `scripts/streamline-export/extract-streamline-detail-metadata.mjs` 的串行路径已经内建低频 human-mode 节奏能力：`preNavigationDelayMs`、`preNavigationJitterMs`、`postLoadJitterMs`、`postItemDelayMs`、`postItemJitterMs` 与 `random` 都是正式参数，而不是一次性调试字段。
- `shouldProcessItem(...)` 默认跳过 `metadataStatus === "success"` 且已有 `tags` 的项，也默认跳过 `metadataStatus === "failed"` 的项；只有显式传入 `retryFailed: true` 或 `force: true` 才会重新处理失败项。
- `scripts/streamline-export/lib/streamline-metadata-session.mjs` 支持 `concurrency`，在 `concurrency > 1` 时走并行 extraction；但 `humanMode` 明确禁止并行，并固定要求 `concurrency = 1`。`DEFAULT_STREAMLINE_HUMAN_METADATA_PACING` 是当前正式推荐值，不应在真实 human-mode 批次里回退到零延迟。
- `scripts/streamline-export/run-streamline-metadata-session.mjs` 提供 loop runner，支持 `batchSize`、`maxBatches`、`reuseBrowser`、`retryFailed`、`concurrency`、`humanMode`，是当前适合真实大批量推进与低频小批次真实回填的统一正式入口。
- `scripts/streamline-export/import-streamline-official-metadata.mjs` 会先从 manifest 里筛出候选项，再按官方 metadata 索引解析 `hash` / `slug`，最后把 `tags`、`metadataStatus`、`metadataError`、`metadataUpdatedAt` 一次性批量写回 manifest。
- `scripts/streamline-export/generate-shared-view-streamline-icons.mjs` 会输出 `tags` 字段，并把 `tags` 合并进 `searchText`；下游搜索链路继续由 `src/components/ViewTabs.tsx` 消费 registry 侧的搜索文本，无需为 Tags 另开搜索动作。
- 从批次 8 起，`scripts/streamline-export/lib/streamline-tag-normalization.mjs` 成为统一的 tags 清洗入口：它会去除 fenced-code 包裹、折叠空白，并支持可选 lowercasing。
- `scripts/streamline-export/lib/streamline-detail-metadata.mjs`、`scripts/streamline-export/lib/streamline-official-metadata-source.mjs`、`scripts/streamline-export/lib/streamline-mcp-client.mjs`、`scripts/streamline-export/lib/manifest-store.mjs` 已统一接入该清洗逻辑，意味着 detail、official、MCP、manifest load 四个入口都会阻断同类 fenced-code 污染继续写入或继续扩散。

## 真实调用链路

- family 入口由 `scripts/streamline-export/lib/streamline-family-entry-config.mjs` 固化。
- 详情页 payload 解析与 tags 归一化由 `scripts/streamline-export/lib/streamline-detail-metadata.mjs` 完成。
- manifest metadata 提取由 `scripts/streamline-export/extract-streamline-detail-metadata.mjs` 执行。
- 浏览器 session 复用、并发 tab 管理与 finalize 由 `scripts/streamline-export/lib/streamline-metadata-session.mjs` 承接。
- Node 侧批处理入口与循环推进由 `scripts/streamline-export/run-streamline-metadata-session.mjs` 承接。
- 离线官方 metadata 导入由 `scripts/streamline-export/import-streamline-official-metadata.mjs` 承接，索引与匹配逻辑分别落在 `scripts/streamline-export/lib/streamline-official-metadata-source.mjs` 和 `scripts/streamline-export/lib/streamline-metadata-manifest.mjs`。
- 回填后的 registry 生成由 `scripts/streamline-export/generate-shared-view-streamline-icons.mjs` 承接。

## micro-solid 真实推进证据

- `artifacts/streamline-export/micro-solid-full.manifest.json` 在本轮真实回填前的 summary 为 `{ total: 1904, withTags: 22, success: 22, failed: 32, pending: 1850, withHash: 1904 }`。
- 真实 Chrome 登录态下，`runStreamlineMetadataExtractionLoopFromNodeRepl({ manifestPath, batchSize: 3, maxBatches: 1, stopOnFailure: false, reuseBrowser: true, retryFailed: false, humanMode: true, connectBrowser: async () => browser })` 已实测推进一轮 low-frequency human-mode batch，结果为 `{ success: 3, failed: 0, pendingBefore: 1850, pendingAfter: 1847 }`。
- 运行后同一份 manifest summary 变为 `{ total: 1904, withTags: 25, success: 25, failed: 32, pending: 1847, withHash: 1904 }`，证明 human-mode 正式链路会稳定持久化真实成功项，而不是只停留在浏览器内存态。
- 本轮新增成功样例可直接作为人工 spot check 锚点：`application-add`、`application-remove`、`application-remove-subtract`。
- `application-remove` 的官方 tags 已进入 manifest 与 registry，包含 `uninstall`；`application-remove-subtract` 包含 `toolbar`。这说明真实回填结果已经进入消费侧可检索语料，而不只是 manifest 内部字段。
- 持续批次推进的第二轮真实证据表明，这条 low-frequency 链路不是一次性成功。后续批次开始前，manifest summary 为 `{ total: 1904, withTags: 25, success: 25, failed: 32, pending: 1847 }`。
- 在同一真实 Chrome 登录态策略下连续执行两轮 human-mode batch 后，batch A 结果为 `{ requested: 10, success: 10, failed: 0, pendingBefore: 1847, pendingAfter: 1837 }`，batch B 结果为 `{ requested: 10, success: 10, failed: 0, pendingBefore: 1837, pendingAfter: 1827 }`。
- 两轮之后，manifest summary 变为 `{ total: 1904, withTags: 45, success: 45, failed: 32, pending: 1827 }`。这说明在未触发真实官网风控的情况下，human-mode 小批次可连续稳定累积成功项，而不是只能推进单个试验批次。
- 本轮新增成功样例可继续作为人工 spot check 锚点：`arrows-bend-down-left-3`、`arrows-bend-down-left-2`、`arrows-bend-down-left-1`、`arrows-all-direction`、`arrow-transfer-vertical-2`。这些样例的 `metadataUpdatedAt` 已连续落在 manifest 最新成功项顶部，适合作为后续核对“持续推进是否真的写回”的检索入口。
- 更长连续窗口的第三轮真实证据进一步说明，这条链路在 `reuseBrowser: true` 的单窗口内也能稳定推进。该轮开始前，manifest summary 为 `{ total: 1904, withTags: 45, success: 45, failed: 32, pending: 1827 }`。
- 在真实 Chrome 登录态下执行 `runStreamlineMetadataExtractionLoopFromNodeRepl({ batchSize: 10, maxBatches: 3, stopOnFailure: false, reuseBrowser: true, retryFailed: false, humanMode: true })` 后，三个 batch 全部成功：batch 1 为 `{ requested: 10, success: 10, failed: 0, pendingBefore: 1827, pendingAfter: 1817 }`，batch 2 为 `{ requested: 10, success: 10, failed: 0, pendingBefore: 1817, pendingAfter: 1807 }`，batch 3 为 `{ requested: 10, success: 10, failed: 0, pendingBefore: 1807, pendingAfter: 1797 }`。
- 连续窗口结束后，manifest summary 变为 `{ total: 1904, withTags: 75, success: 75, failed: 32, pending: 1797 }`。这说明 human-mode 在线回填在更长的 `3 x 10 item` 连续窗口里仍可稳定推进，没有引入新的 `failed` 项。
- 本轮最新成功样例可作为更长窗口的 spot check 锚点：`arrows-crossover-left`、`arrows-crossover-down`、`arrows-cross-over`、`arrows-corner-down-left`、`arrows-button-zigzag`、`arrows-button-to-top`。这些样例的 `metadataUpdatedAt` 继续落在 manifest 最新成功项顶部，可用于核对连续窗口是否真实累计写回。
- 更大窗口的第四轮真实证据说明，node_repl 调用表面的超时不应直接等价为批次失败。该轮开始前，manifest summary 为 `{ total: 1904, withTags: 75, success: 75, failed: 32, pending: 1797 }`。
- 在真实 Chrome 登录态下尝试 `batchSize: 20, maxBatches: 4` 时，node_repl browser call 约在 300 秒时超时，但 manifest 真实状态仍推进到 `{ total: 1904, withTags: 116, success: 116, failed: 32, pending: 1756 }`，说明 tool 调用等待上限先触发，并不代表底层 human-mode 批次已经失败。
- 随后继续尝试 `batchSize: 20, maxBatches: 2`，同样在约 300 秒时超时，但 manifest 又进一步推进到 `{ total: 1904, withTags: 160, success: 160, failed: 32, pending: 1712 }`。
- 因此，这一轮的大窗口净推进应按 manifest 复核结果认定：`success/withTags 75 -> 160`，`pending 1797 -> 1712`，`failed` 维持 `32` 未增加。对于大窗口 human-mode 回填，manifest summary 才是最终判定真实推进是否发生的正式依据。
- 本轮新增成功样例可作为大窗口 + timeout 场景下的人工 spot check 锚点：`attachment-1`、`attachment-2`、`auto-flash`、`axe`、`baby-botlle`。
- 第五轮真实证据进一步说明，`4 x 10` 窗口比 `20-item batch` 更贴近当前约 300 秒的工具等待上限。该轮开始时，manifest summary 为 `{ total: 1904, withTags: 186, success: 186, failed: 36, pending: 1682 }`。
- 在完整拿到 runner 返回的 `4 x 10` human-mode 连续窗口中，四个 batch 都稳定成功：batch 1 为 `{ pending: 1677 -> 1667, success: 10, failed: 0 }`，batch 2 为 `{ pending: 1667 -> 1657, success: 10, failed: 0 }`，batch 3 为 `{ pending: 1657 -> 1647, success: 10, failed: 0 }`，batch 4 为 `{ pending: 1647 -> 1637, success: 10, failed: 0 }`；runner 返回的 after summary 为 `{ total: 1904, success: 226, failed: 41, pending: 1637, withTags: 226 }`。
- 这里新增的 `5` 个 failed 不是官网风控，而是 stale session/tab 错误：`Tab 683905182 is not part of browser session ...` / `Tab not found: 683905182 ...`。这类失败属于会话态中断，不应与站点级 `403 Forbidden` / `Server: Vercel` 风控混为一类。
- 将 `bill-2`、`bill-cashless`、`bills`、`binocular`、`bitcoin-currency`、`blessed-face-smiley`、`block`、`blood-donate-drop`、`blood-drop-donation` 这 `9` 个会话型 failed 项重排回 pending 后，counts 变为 `{ total: 1904, success: 226, failed: 32, pending: 1646 }`。
- 随后再跑一个 post-reset `2 x 10` human-mode 窗口后，batch 1 为 `{ pending: 1646 -> 1636, success: 10, failed: 0 }`，batch 2 为 `{ pending: 1636 -> 1626, success: 10, failed: 0 }`；after summary 变为 `{ total: 1904, success: 246, failed: 32, pending: 1626, withTags: 246 }`。
- 这说明 stale session/tab failed 是可重排并重新吃回的暂时性会话失败，不应被记成长期坏数据；对 human-mode runner 的真实判定，需要同时区分“官网风控失败”和“会话态失败”两类根因。
- 本轮会话型 failed 吃回后的样例可作为人工 spot check 锚点：`bitcoin-currency`、`block`、`blood-donate-drop`、`bills`。这些项后续都已回到 `metadataStatus = success` 并带上真实 tags。
- 第六轮真实证据说明，标准 `4 x 10` human-mode 连续窗口已经连续多轮稳定推进，可视为当前 surface 上的标准在线回填策略。该轮开始前，manifest summary 为 `{ total: 1904, withTags: 246, success: 246, failed: 32, pending: 1626 }`。
- 在完整拿到 runner 返回的标准 `4 x 10` 连续窗口中，四个 batch 继续全部成功：batch 1 为 `{ pending: 1626 -> 1616, success: 10, failed: 0 }`，batch 2 为 `{ pending: 1616 -> 1606, success: 10, failed: 0 }`，batch 3 为 `{ pending: 1606 -> 1596, success: 10, failed: 0 }`，batch 4 为 `{ pending: 1596 -> 1586, success: 10, failed: 0 }`；after summary 为 `{ total: 1904, success: 286, failed: 32, pending: 1586, withTags: 286 }`。
- 这说明标准 `4 x 10` 策略在本轮继续稳定推进，没有新增会话型 failed，也没有新增风控 failed；在当前 surface 上，优先应把它视为在线真实回填的默认窗口配置。
- 本轮新增成功样例可作为当前标准窗口的人工 spot check 锚点：`candy-cane`、`camping-tent`、`camera-setting-pin`、`campfire`、`cane`。
- 批次 7 的基线确认进一步固定了当前在线回填的起跑线：截至 `2026-06-24`，`artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `{ total: 1904, withTags: 286, success: 286, failed: 32, pending: 1586 }`。
- 这些计数来自 manifest 当前状态复核，应继续视为 micro-solid 在线回填进度的唯一真相源；后续批次无论 runner 是否中断、超时或只返回部分 telemetry，最终都应回到这份 manifest summary 判定真实推进结果。
- 本轮继续沿 low-frequency `humanMode` 路径推进，不恢复高频脚本抓取；计划目标保持为使用标准 `4 x 10` 窗口持续压降 `pending`，并在批次后复核 registry 搜索消费。
- 批次 7 的 `4 x 10 human-mode` 批次执行进一步验证了这一标准窗口的可复用性。使用 `node_repl + Chrome extension` 登录态复用正式链路，执行 `runStreamlineMetadataExtractionLoopFromNodeRepl({ batchSize: 10, maxBatches: 4, stopOnFailure: false, reuseBrowser: true, retryFailed: false, humanMode: true })` 后，4 个 batch 全部完整返回。
- 本轮四个 batch 均为 `success 10 / failed 0`，`pending` 依次变化为 `1586 -> 1576 -> 1566 -> 1556 -> 1546`，说明在当前 surface 上，标准 `4 x 10` 窗口不仅能稳定执行，而且能稳定拿到完整 runner 返回。
- 本轮批次后，micro-solid manifest 权威计数更新为 `{ total: 1904, withTags: 326, success: 326, failed: 32, pending: 1546 }`。这再次证明 manifest summary 是批次结果的最终判定依据。
- 本轮再次没有新增 failed，进一步支持“`4 x 10` human-mode 连续窗口是当前默认在线回填策略”这一结论；真实站点访问仍应维持 low-frequency `humanMode`，不恢复高频脚本抓取为默认策略。
- 批次 8 的 tags 清洗链路修补以 `{ total: 1904, withTags: 326, success: 326, failed: 32, pending: 1546 }` 作为起点基线。该轮关注点不在继续推进批次，而在修补 metadata 污染传播路径。
- 在真实 manifest 中，fenced-code 污染此前只确认命中 2 条 `success` 记录：`call-alert` 与 `chat-bubble-disable-oval`。完成清洗回写后，当前 manifest 复核结果为 `pollutedCount = 0`，说明这类污染已从真实文件层面清除。
- 这轮修补说明：manifest 既是在线回填进度的唯一真相源，也是污染清理是否真正落地的最终验收面；仅修脚本而不回写 manifest，不能视为清理完成。
- 批次 8 的 `4 x 10 human-mode` 批次执行进一步证明，tags 清洗修补不会破坏当前标准在线回填窗口。继续使用 `node_repl + Chrome extension` 登录态复用正式链路，执行 `runStreamlineMetadataExtractionLoopFromNodeRepl({ batchSize: 10, maxBatches: 4, stopOnFailure: false, reuseBrowser: true, retryFailed: false, humanMode: true })` 后，4 个 batch 全部完整返回。
- 本轮四个 batch 均为 `success 10 / failed 0`，`pending` 依次变化为 `1546 -> 1536 -> 1526 -> 1516 -> 1506`，说明在加入 tags 清洗修补后，标准 `4 x 10` 窗口仍保持稳定、可复用且无新增 failed。
- 本轮批次后，micro-solid manifest 权威计数更新为 `{ total: 1904, withTags: 366, success: 366, failed: 32, pending: 1506, pollutedCount: 0 }`。这说明清洗链路修补与真实批次推进可以共存，且当前 manifest 中已无残留 fenced-code 污染 success 项。
- 当前仓库已切换到正式折中方案：manifest 保留官方 `hash`，离线官方 metadata 导入按 `hash` 优先、`slug` 兜底回填 `tags`，但尚未拿到真实离线官方 metadata 文件，所以没有伪装成“已完成全量 tags 回填”。
- 当前 summary 同时说明该流程尚未完成全量回填；未完成部分不代表真值源错误，而主要受真实站点批量访问时的风控影响。

## registry 搜索消费验证

- `npm run streamline:generate-registry` 是 manifest metadata 到运行时 registry 的正式再生成步骤。
- `src/generated/streamline-shared-view-icons.mjs` 中，`streamlineMicroSolidApplicationAdd`、`streamlineMicroSolidApplicationRemove`、`streamlineMicroSolidApplicationRemoveSubtract` 都已带有真实回填后的 `tags`。
- 同一文件内的 `searchText` 已合并这些 `tags`，因此消费侧搜索不需要理解 manifest 结构，只需继续消费 registry 中的 `searchText`。
- 真实样例中，`streamlineMicroSolidApplicationRemove` 的 `searchText` 已包含 `uninstall`，`streamlineMicroSolidApplicationRemoveSubtract` 的 `searchText` 已包含 `toolbar`；用这些词做 query 时可以直接命中对应图标。
- 持续回填后的补充样例也满足同一消费契约：`streamlineMicroSolidApplicationSearch` 的 `searchText` 已包含 `magnifyingglass`，`streamlineMicroSolidArchiveFolder` 已包含 `logistics`，`streamlineMicroSolidArchiveBox` 已包含 `compress`；这些词都可直接作为 query 命中对应图标。
- 更长连续窗口后的新增样例也继续满足同一消费契约：`streamlineMicroSolidArrowsButtonZigzag` 可被 `query=zigzag` 命中，`streamlineMicroSolidArrowsButtonToTop` 可被 `query=skyward` 命中，`streamlineMicroSolidArrowsCrossOver`、`streamlineMicroSolidArrowsCrossoverDown`、`streamlineMicroSolidArrowsCrossoverLeft` 可被 `query=crossover` 命中，`streamlineMicroSolidArrowsCornerDownLeft` 可被 `query=decline` 命中。
- 这进一步说明，连续 `3 x 10` human-mode 窗口下新增的 tags 不只停留在 manifest；在重新执行 `npm run streamline:generate-registry` 后，会持续进入 registry `searchText`，并被 UI 搜索链路直接消费。
- 大窗口 + timeout 场景下的新增样例也同样进入了 registry `searchText`：`streamlineMicroSolidAttachment1` 附近已确认有 `paperclip`，`streamlineMicroSolidAxe` 附近已确认有 `woodworking`，`streamlineMicroSolidBabyBotlle` 附近已确认有 `formula`，`streamlineMicroSolidAutoFlash` 附近已确认有 `thunder`。因此即使上层 tool call 超时，只要 manifest 已真实推进并重建 registry，这些 tags 仍会进入消费侧搜索语料。
- 会话型 failed 被重排并吃回后，对应新增 tags 也继续满足同一消费契约：`cryptocurrency` 可命中 `bitcoin-currency`，`forbidden` 可命中 `bill-cashless` / `block`，`hemoglobin` 可命中 `blood-donate-drop`，`banknotes` 可命中 `bills`。
- 当前标准 `4 x 10` 窗口下的新增样例也继续满足同一消费契约：`peppermint` 可命中 `candy-cane`，`teepee` 可命中 `camping-tent`，`geotag` 可命中 `camera-setting-pin`，`bonfire` 可命中 `campfire`。
- 批次 7 的 registry 搜索消费复核进一步确认，`npm run streamline:generate-registry` 成功刷新了运行时产物，当前生成结果为 `{ icons: 3932, groups: 2 }`，输出已落到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 本轮新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下命中：`bubbly -> champagne-party-alcohol`、`portable -> chair`、`skyrocketing -> chart-profit-growth-skyrocketing`、`formatting -> center-align-1`、`mute -> chat-bubble-disable-square`。
- 这说明只要 manifest metadata 已写回且完成 registry 重建，新增 tags 会直接进入运行时搜索语料，不需要为这批词再单独维护额外索引。
- 批次 8 的 registry 搜索消费复核进一步确认，`npm run streamline:generate-registry` 成功刷新了运行时产物，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，输出已落到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 都已不再包含 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 本轮新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下命中：`berries -> cherries`、`culinary -> chef-toque`、`recheck -> check-backward`、`caution -> chat-bubble-warning`、`healthcare -> checkup-medical-report-clipboard`。
- 这说明清洗链路修补之后，registry 搜索消费仍保持正常，且污染消除不会削弱既有命中能力。
- 批次 9 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 9 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 批次 9 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下命中：`eyedrop -> color-picker`、`swatch -> color-palette`、`generosity -> coin-share`、`espresso -> coffee-mug`、`inspection -> code-analysis`、`software -> code-block`。
- 这说明在继续批量推进 `code / coffee / coin / color` 段时，registry 搜索消费链路仍然正确，且 tags 清洗修补没有对 `searchText` 注入造成回归。
- 批次 10 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 10 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 批次 10 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下命中：`blocked -> credit-card-disable`、`attribution -> creative-commons`、`duplicate -> copy-paste`、`privacy -> cookie-settings-off`、`gamepad -> controller-wireless`、`login -> correct-password`。
- 这说明在继续批量推进 `controller / cookie / copy / copyright / credit-card` 段时，registry 搜索消费链路仍然正确，没有因为 tags 清洗修补出现回归。
- 批次 11 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 11 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 批次 11 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下命中：`backup -> database-download`、`forbidden -> database-block`、`inspect -> data-analytics`、`apps -> dashboard-square`、`widgets -> dashboard-layout-2`、`certified -> database-check`。
- 这说明在继续批量推进 `dashboard / data / database` 段时，registry 搜索消费链路仍然正确；即使 tool-call 超时，重建 registry 后的消费验证与 manifest 进度仍保持一致。
- 批次 12 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 12 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 批次 12 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下命中：`programming -> desktop-code`、`internet -> desktop-search`、`privacy -> desktop-unlock`、`navigation -> diagonal-scroll-1`、`signin -> dial-pad-1`、`buddhism -> dhammajak`。
- 额外复核表明，初次粗抽样把 `dial-pad-1` 的 miss 误归因到消费异常，真实原因是误看到了 `micro-line` 同 slug 条目；`micro-solid` 生成结果本身是正确的，不应把这类跨 family 误读当作 registry 消费回归。
- 批次 13 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 13 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 批次 13 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下条目级命中：`sidebyside -> edit-compare-image`、`equator -> earth`、`otology -> ear-speciality`、`earbuds -> ear-pods`、`quadcopter -> drone`、`women -> dress`。
- 额外复核表明，初次用全局字符串方式抽样时出现了若干 false negative；后续以条目级片段核对后可确认 `micro-solid` 生成结果本身是正确的，因此后续搜索验证应优先采用条目级证据，而不是全文件粗匹配。
- 批次 14 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 14 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，且 `src/generated/streamline-shared-view-icons.mjs` 中也没有 `````plaintext`` 文本命中。
- 批次 14 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下条目级命中：`pupil -> eye-optic`、`spectacles -> eye-glasses`、`maximize -> expand`、`economy -> euro-currency`、`ascend -> escalator-up`、`stationery -> eraser`。
- 额外复核表明，本轮初次检查里看到的空 tags 只是旧片段或截取误差；通过条目级片段核对与独立内存生成结果，已确认 generator 与落盘产物本身没有回归。
- 批次 15 的 registry 搜索消费复核继续保持同一结论：`npm run streamline:generate-registry` 已成功执行，当前生成结果仍为 `{ icons: 3932, groups: 2 }`，运行时产物刷新到 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/streamline-shared-view-icons.d.ts`。
- 当前 micro-solid manifest 与生成后的 registry 在批次 15 后继续保持无 fenced-code 污染：manifest 复核 `pollutedCount = 0`，通过运行时模块导入读取结果也已确认新增条目的 `tags` 与 `searchText` 完整。
- 批次 15 新增样例的 tags 已进入 micro-solid registry `searchText`，至少已复核以下条目级命中：`forbidden -> flash-off`、`bright -> flash-always-on`、`banner -> flag`、`aspect ratio -> fit-screen`、`solidarity -> fist`、`astronomy -> first-quarter-moon`。
- 额外复核表明，本轮直接通过模块级导入 `src/generated/streamline-shared-view-icons.mjs` 读取运行时对象时，结果与 manifest 保持一致；这比文本切片更可靠，可作为后续 closeout 的首选消费验证方式。
- 因此，真实官网连续两批未触发风控时新增的 tags，不只是写回 manifest；在重新执行 `npm run streamline:generate-registry` 后，也会稳定进入运行时 registry 的搜索文本，供 UI 搜索链路直接消费。

## 已知陷阱

- 在线详情页批量回填不适合作为正式生产方案。虽然页面结构与 `tags` 真值判断是正确的，但真实执行会反复命中 `403 Forbidden` / `Server: Vercel` / Vercel Security Checkpoint。
- 因此，真实浏览器回填的长期定位应保持在“登录态 low-frequency 小批次推进、结构确认、局部排障”，而不是恢复到高并发在线全量抓取；正式全量推进仍应优先使用 manifest `hash` + 离线官方 metadata 导入。
- 当前 Codex `node_repl` browser surface 存在约 300 秒的工具等待上限。对更大窗口的 `runStreamlineMetadataExtractionLoopFromNodeRepl(...)` 调用，tool timeout 只能说明上层等待被中断，不能直接当作底层批次失败；必须回到 manifest summary 复核 `success` / `failed` / `pending` 的真实变化。
- stale session/tab 错误如 `Tab ... is not part of browser session`、`Tab not found ...` 属于暂时性会话失败。它们可能在 runner 返回里短暂抬高 `failed` 计数，但可以通过重排回 pending 并在 reset 后重跑吃回；这类错误应与官网风控失败分开统计和解读。
- 从当前实证看，`4 x 10` human-mode 连续窗口比 `20-item batch` 更贴合约 300 秒工具上限，更容易完整拿到 runner 返回并减少“表层超时掩盖真实推进”的观测偏差。
- 从连续多轮实证看，`4 x 10` 不只是“较合适”的窗口，而是当前 surface 上已经验证过可持续稳定推进、且本轮未新增任何 failed 的标准在线回填策略。
- 2026-06-24 的批次 9 再次复用了 `node_repl + Chrome extension` 登录态，通过 `runStreamlineMetadataExtractionLoopFromNodeRepl({ batchSize: 10, maxBatches: 4, stopOnFailure: false, reuseBrowser: true, retryFailed: false, humanMode: true })` 完整跑完一个标准 `4 x 10` 窗口；四个 batch 全部返回 `success 10 / failed 0`，`pending` 依次从 `1506 -> 1496 -> 1486 -> 1476 -> 1466`。
- 批次 9 结束后的 `artifacts/streamline-export/micro-solid-full.manifest.json` 权威计数为 `total 1904, withTags 406, success 406, failed 32, pending 1466, pollutedCount 0`。这说明标准 `4 x 10` 窗口在 tags 清洗修补上线后仍能持续稳定推进，且本轮没有新增 failed，也没有 fenced-code 污染回归。
- 批次 10 的基线确认沿用了同一判定口径：2026-06-24 当前 `artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 406, success 406, failed 32, pending 1466, pollutedCount 0`，应继续视为在线回填进度的唯一真相源。
- 这也说明 tags 清洗修补后的状态在进入批次 10 前仍保持稳定，本轮起点没有 fenced-code 污染回归；后续推进继续沿 low-frequency `humanMode` 的标准 `4 x 10` 窗口执行，并在批次后复核 registry 搜索消费。
- 批次 10 的 `4 x 10 human-mode` 批次执行继续复用了 `node_repl + Chrome extension` 登录态正式链路，通过 `runStreamlineMetadataExtractionLoopFromNodeRepl({ batchSize: 10, maxBatches: 4, stopOnFailure: false, reuseBrowser: true, retryFailed: false, humanMode: true })` 完整跑完一个标准窗口；四个 batch 全部完整返回，且每个 batch 都是 `success 10 / failed 0`，`pending` 依次从 `1466 -> 1456 -> 1446 -> 1436 -> 1426`。
- 批次 10 结束后的 `artifacts/streamline-export/micro-solid-full.manifest.json` 权威计数更新为 `total 1904, withTags 446, success 446, failed 32, pending 1426, pollutedCount 0`。这进一步证明标准 `4 x 10` human-mode 连续窗口在当前 surface 上仍稳定可复用，且 tags 清洗后的链路没有新增 failed，也没有污染回归。
- 批次 11 的基线确认继续沿用同一判定口径：2026-06-24 当前 `artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 446, success 446, failed 32, pending 1426, pollutedCount 0`，应继续视为在线回填进度的唯一真相源。
- 这也说明 tags 清洗修补后的状态在进入批次 11 前仍保持稳定，本轮起点没有 fenced-code 污染回归；后续推进继续沿 low-frequency `humanMode` 的标准 `4 x 10` 窗口执行，并在批次后复核 registry 搜索消费。
- 批次 11 的 `4 x 10 human-mode` 批次执行继续沿 `node_repl + Chrome extension` 正式链路推进，但当前 surface 在约 300 秒处出现了 tool timeout；这类超时不能直接视为批次失败，仍需回到 manifest 做最终复核。
- 权威 manifest 复核显示，该轮底层批次实际上已经完整推进：`artifacts/streamline-export/micro-solid-full.manifest.json` 从 `total 1904, withTags 446, success 446, failed 32, pending 1426` 变为 `total 1904, withTags 486, success 486, failed 32, pending 1386`，等价于本轮真实完成了 `40 success / 0 new failed`。
- 本轮新增样例的最新 `metadataUpdatedAt` 时间戳集中在 `dashboard / data / database` 段，说明在 tool timeout 之后，仍应优先以 manifest counts 与最新成功项时间分布作为是否真实推进的判据，而不是以 tool 返回是否完整作为成功标准。
- 这进一步证明，在当前 surface 上，tool-call timeout 与真实批次进度并不等价；manifest 复核仍是唯一可信的收敛依据。
- 批次 12 的基线确认继续沿用同一判定口径：2026-06-24 当前 `artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 486, success 486, failed 32, pending 1386, pollutedCount 0`，应继续视为在线回填进度的唯一真相源。
- 这也说明 tags 清洗修补后的状态在进入批次 12 前仍保持稳定，本轮起点没有 fenced-code 污染回归；后续推进继续沿 low-frequency `humanMode` 的标准 `4 x 10` 窗口执行，并在批次后复核 registry 搜索消费。
- 批次 12 的 `4 x 10 human-mode` 批次执行继续沿 `node_repl + Chrome extension` 正式链路推进，但当前 surface 在约 300 秒处再次出现 tool timeout；这类超时仍不能直接视为批次失败，必须回到 manifest 做最终复核。
- 权威 manifest 复核显示，该轮底层批次实际上已经完整推进：`artifacts/streamline-export/micro-solid-full.manifest.json` 从 `total 1904, withTags 486, success 486, failed 32, pending 1386` 变为 `total 1904, withTags 526, success 526, failed 32, pending 1346`，等价于本轮真实完成了 `40 success / 0 new failed`。
- 本轮新增样例的最新 `metadataUpdatedAt` 时间戳集中在 `desktop / diagonal / dial / dhammajak` 段，继续说明在 tool timeout 之后，仍应优先以 manifest counts 与最新成功项时间分布作为是否真实推进的判据，而不是以 tool 返回是否完整作为成功标准。
- 额外复核还表明，`dial-pad-1` 的 `micro-solid` `searchText` 已正确包含 `signin` / `signout`；此前抽样 miss 只是因为误看到了 `micro-line` 同 slug 条目，不应误判为 registry 消费缺失。
- 批次 13 的基线确认继续沿用同一判定口径：2026-06-24 当前 `artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 526, success 526, failed 32, pending 1346, pollutedCount 0`，应继续视为在线回填进度的唯一真相源。
- 这也说明 tags 清洗修补后的状态在进入批次 13 前仍保持稳定，本轮起点没有 fenced-code 污染回归；后续推进继续沿 low-frequency `humanMode` 的标准 `4 x 10` 窗口执行，并在批次后复核 registry 搜索消费。
- 批次 13 的 `4 x 10 human-mode` 批次执行继续沿 `node_repl + Chrome extension` 正式链路推进，但当前 surface 在约 300 秒处再次出现 tool timeout；这类超时仍不能直接视为批次失败，必须回到 manifest 做最终复核。
- 权威 manifest 复核显示，该轮底层批次实际上已经完整推进：`artifacts/streamline-export/micro-solid-full.manifest.json` 从 `total 1904, withTags 526, success 526, failed 32, pending 1346` 变为 `total 1904, withTags 566, success 566, failed 32, pending 1306`，等价于本轮真实完成了 `40 success / 0 new failed`。
- 本轮新增样例的最新 `metadataUpdatedAt` 时间戳集中在 `edit / east / earth / ear / drone / dress` 段，继续说明在 tool timeout 之后，仍应优先以 manifest counts 与最新成功项时间分布作为是否真实推进的判据，而不是以 tool 返回是否完整作为成功标准。
- 额外复核还表明，`edit-compare-image`、`earth`、`ear-speciality`、`dress` 的 `micro-solid` `searchText` 都已正确包含对应 tags；此前全局字符串抽样产生的 miss 不能直接当作消费回归结论。
- 批次 14 的基线确认继续沿用同一判定口径：2026-06-24 当前 `artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 566, success 566, failed 32, pending 1306, pollutedCount 0`，应继续视为在线回填进度的唯一真相源。
- 这也说明 tags 清洗修补后的状态在进入批次 14 前仍保持稳定，本轮起点没有 fenced-code 污染回归；后续推进继续沿 low-frequency `humanMode` 的标准 `4 x 10` 窗口执行，并在批次后复核 registry 搜索消费。
- 批次 14 的 `4 x 10 human-mode` 批次执行继续沿 `node_repl + Chrome extension` 正式链路推进，但当前 surface 在约 300 秒处再次出现 tool timeout；这类超时仍不能直接视为批次失败，必须回到 manifest 做最终复核。
- 权威 manifest 复核显示，该轮底层批次实际上已经完整推进：`artifacts/streamline-export/micro-solid-full.manifest.json` 从 `total 1904, withTags 566, success 566, failed 32, pending 1306` 变为 `total 1904, withTags 606, success 606, failed 32, pending 1266`，等价于本轮真实完成了 `40 success / 0 new failed`。
- 本轮新增样例的最新 `metadataUpdatedAt` 时间戳集中在 `eye / exponent / expand / escalator / euro / eraser` 段，继续说明在 tool timeout 之后，仍应优先以 manifest counts 与最新成功项时间分布作为是否真实推进的判据，而不是以 tool 返回是否完整作为成功标准。
- 额外复核还表明，最初看到的空 tags 只是旧片段或截取误差；直接调用 `loadManifest` 与 `generateSharedViewStreamlineIcons` 后，这些 `micro-solid` 条目都带有完整 `tags` 和 `searchText`，不应误判为生成链路丢字段。
- 批次 15 的基线确认继续沿用同一判定口径：2026-06-24 当前 `artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 606, success 606, failed 32, pending 1266, pollutedCount 0`，应继续视为在线回填进度的唯一真相源。
- 这也说明 tags 清洗修补后的状态在进入批次 15 前仍保持稳定，本轮起点没有 fenced-code 污染回归；后续推进继续沿 low-frequency `humanMode` 的标准 `4 x 10` 窗口执行，并在批次后复核 registry 搜索消费。
- 批次 15 的 `4 x 10 human-mode` 批次执行继续沿 `node_repl + Chrome extension` 正式链路推进，但当前 surface 在约 300 秒处再次出现 tool timeout；这类超时仍不能直接视为批次失败，必须回到 manifest 做最终复核。
- 权威 manifest 复核显示，该轮底层批次实际上已经完整推进：`artifacts/streamline-export/micro-solid-full.manifest.json` 从 `total 1904, withTags 606, success 606, failed 32, pending 1266` 变为 `total 1904, withTags 646, success 646, failed 32, pending 1226`，等价于本轮真实完成了 `40 success / 0 new failed`。
- 本轮新增样例的最新 `metadataUpdatedAt` 时间戳集中在 `flash / flag / fit-screen / fist / fish / moon` 段，继续说明在 tool timeout 之后，仍应优先以 manifest counts 与最新成功项时间分布作为是否真实推进的判据，而不是以 tool 返回是否完整作为成功标准。
- 额外复核还表明，即使文本截片看起来像空 tags，直接导入 `src/generated/streamline-shared-view-icons.mjs` 的运行时对象后，这些 `micro-solid` 条目也都带有完整 `tags` 与 `searchText`；这类文本截取误差不应误判为 registry 生成回归。
- 批次 16 / 任务 1 的基线确认进一步固定了新的权威起跑线：截至 `2026-06-24`，`artifacts/streamline-export/micro-solid-full.manifest.json` 的权威计数为 `total 1904, withTags 646, success 646, failed 32, pending 1226, pollutedCount 0`。此前基于更旧快照的 `606 / 32 / 1266` 口径已不再适合作为后续批次起点，因为前一轮 tool timeout 后的真实推进已经完成落盘。
- 这轮基线复核同时确认，当前 manifest 根结构已稳定为 `{ family, generatedAt, items }`，后续所有统计脚本都必须按 `items` 读取，不应再沿用旧的 `icons` 根字段口径。
- 单项 manifest 记录当前应以 `metadataStatus` 作为 metadata 回填状态字段，以清洗后的 `tags` 作为官方 tags 真值；`pollutedCount = 0` 继续说明 tags 清洗链路在连续多轮批次后仍保持稳定，没有 fenced-code 污染回归。
- 批次 16 / 执行与验证进一步说明，当前 Streamline 风控下，shell 驱动的 `run-streamline-metadata-session.mjs` 旧执行面已经不再适合作为默认在线推进路径：无论是标准 `4 x 10 human-mode`，还是更保守的 `1 x 1` 探针，都会出现超时且 manifest 无推进。Chrome 插件链路同时确认浏览器本身仍可用，因此问题不在 Chrome 连接，而在旧 runner 的执行面。
- 当前详情页可见 DOM 或 body text 里，即使完全不渲染 `Tags`，也不代表官方 tags 真值消失。权威来源仍然是 `#__NEXT_DATA__` 中 `props.pageProps.initialState.streamlineApi.queries.getIconDetailsBySlugAndSubcategoryId(...).data.tags`；现有 `streamline-detail-metadata.mjs` 的正式真值源本来就是这里，而不是 description 反推。
- 改用 Chrome 插件直接驱动真实用户会话后，低频串行微批次已再次实测可推进真实 manifest：本轮成功回填 `flashlight` 与 `flatten` 两个 pending 项，其中 `flashlight` 的前 8 个 tags 为 `flashlight, torch, beam, light, brightness, portable, handheld, shine`，`flatten` 的前 8 个 tags 为 `flatten, down, arrow, downarrow, bottom, filetransfer, receive, download`。
- 这轮真实推进后，manifest 权威计数从 `total 1904 / success 646 / failed 32 / pending 1226 / pollutedCount 0` 更新为 `total 1904 / success 648 / failed 32 / pending 1224 / pollutedCount 0`；重新生成 `src/generated/streamline-shared-view-icons.mjs` 后，`flashlight`、`beam` 可命中 `flashlight`，`flatten`、`filetransfer` 可命中 `flatten`，且污染继续为 `0`。
- 因此，后续在线回填的默认策略应从 shell `4 x 10` 切换为 Chrome 插件驱动的低频串行微批次；统计与验收仍以 manifest 为唯一权威，运行时消费验证继续以 registry query 命中为准。
- 在 `C:\Code\data-editor` 下使用用户提供的 `STREAMLINE_API_KEY` 直接调用 `scripts/streamline-export/lib/streamline-mcp-client.mjs` 的 `callStreamlineMcpTool({ toolName: 'get_icon_by_hash', arguments: { iconHash: 'ico_7JijoMbs7DVhdN13' } })`，已真实返回完整 icon metadata，包含 `hash`、`name`、`webUrl`、`setSlug`、`category`、`subcategory`、`svg` 与完整官方 `tags`。这证明 `get_icon_by_hash` 真实可用，且官方 API/MCP 链路可以绕开详情页页面风控。
- 基于这条实证，metadata runner 的正式优先执行面应从页面驱动切换为 API key 驱动的 MCP/API 链路，而不是继续把页面 human-mode 当成默认在线推进面。页面侧 Chrome 插件低频串行微批次仍保留价值，但其定位应降级为 fallback surface，用于页面侧 spot check、结构确认和 API 不可用时的小规模兜底。
- 这条 API/MCP 链路天然更适合 `concurrency > 1` 的并行批处理，也更贴合 manifest 当前大量 `metadataStatus = pending` 且已有 `hash` 的事实；因此后续默认应按 `hash` 批处理回填，而不是继续优先依赖 shell human-mode 页面访问。
- 后续正式 loop runner 的提升方向应以 `sync-streamline-metadata-from-mcp.mjs` 为中心，而浏览器链路应明确降级为 fallback。即使执行面切换，统计与验收边界仍不变：manifest 依旧是唯一权威，registry query 命中依旧是运行时消费验证标准。
- 执行链路重构后的正式实现进一步把这条方向固化成代码结构：新增 `scripts/streamline-export/lib/streamline-metadata-loop.mjs` 作为 metadata 批次循环的通用 loop，统一承接 manifest summary 读取、按 `batchSize` / `maxBatches` 推进、complete 判定与 batch telemetry 记录，不再把这类共性逻辑散落在单一执行面里。
- `scripts/streamline-export/run-streamline-metadata-session.mjs` 现在不再只承载 browser human-mode loop，还正式导出 `runStreamlineMetadataSyncLoopFromMcp(...)` 与 `runStreamlineMetadataHybridLoop(...)`：前者基于 `syncManifestMetadataFromMcp` 直接跑官方 API/MCP 批处理 loop，后者则先跑 MCP，再把 `Official MCP metadata returned no tags ...` 这一类空 tags 项按 `itemIds` 精确交给 browser fallback。该文件同时新增 plain Node CLI 入口，当前支持 `--transport mcp`，并已有 npm script `streamline:metadata-session:mcp`。
- 为了让 hybrid 补位成为正式能力，`scripts/streamline-export/lib/streamline-metadata-manifest.mjs`、`scripts/streamline-export/extract-streamline-detail-metadata.mjs`、`scripts/streamline-export/sync-streamline-metadata-from-mcp.mjs`、`scripts/streamline-export/lib/streamline-metadata-session.mjs` 都已接入 `itemIds` 精确选择能力；后续 API 空洞项可以被正式精准补跑，而不必再粗粒度重跑全部 failed。
- 测试面已同步扩大到这套新执行面：`tests/streamline-export/metadata-runner.test.mjs` 已覆盖 MCP loop 与 hybrid fallback loop，`tests/streamline-export/extract-streamline-detail-metadata.test.mjs` 已覆盖 browser extraction 的 `itemIds` 精确选择，`tests/streamline-export/sync-streamline-metadata-from-mcp.test.mjs` 已覆盖 MCP sync 的 `itemIds` 精确选择；完整 `npm run test:streamline-export` 当前结果记录为 `105/105 pass`。
- 真实外部验证进一步澄清了 API/MCP 的价值边界：`get_icon_by_hash` 的确真实可用，但对当前剩余大量 `pending + hash` 的 micro-solid 项，MCP 返回的 `tags` 经常为空。抽样 `flip-right`、`help-support-lifebuoy`、`money-bag`、`folder`、`virtual-reality` 等均出现 `tagCount = 0`，说明 API/MCP 在这批剩余空洞上更像“快速判空面”，而不是完整 tags 覆盖面。
- 真实 browser fallback 现已通过正式函数把 API 空洞吃回：`runStreamlineMetadataExtractionFromNodeRepl(... itemIds:['flip-right'])` 已成功写回 `flip-right`；`runStreamlineMetadataHybridLoop(... itemIds:['flip-down'], retryFailed:true)` 也已真实完成“先 MCP -> 空 tags -> browser fallback -> 写回 success”的闭环。这说明 `itemIds` 精确选择是 hybrid 补位链路成立的必要条件，而不只是附加优化。
- 当前 micro-solid manifest 的权威计数已更新为 `total 1904 / withTags 650 / success 650 / failed 35 / pending 1219 / pollutedCount 0`。真实条目 spot check 显示，`flip-right` 已带有 `turn, direction, move, dash, edit, battery, charge, charging, electricity, technology, indicator, cell` 等 tags，`flip-down` 已带有 `archive, storage, files, organize, folder, box, database, repository, container` 等 tags；重生 registry 后，`archive storage files -> flip-down`、`turn direction move -> flip-right`、`dash edit battery -> flip-right` 均可命中。
- 因此，正式执行策略应进一步明确为“API/MCP 主跑 + browser fallback 补 API 空 tags 洞”。API/MCP 的价值不只在于直接拿到成功 tags，也在于先把剩余空洞快速筛出，再交给低频浏览器补位；browser 页面链路不再是默认主执行面，而是 hybrid 流程里的精确补洞面。
- 批次 17 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 650 / success 650 / failed 35 / pending 1219 / pollutedCount 0`，后续批次推进仍必须以这份 manifest 作为唯一真相源。
- 本轮候选策略不再泛跑新的 pending，而是优先处理 manifest 顶部这组历史 failed 项，用来验证 hybrid runner 是否能吃回旧失败。当前这组 failed 的典型错误为 `Error: Streamline detail metadata payload not found`，因此比普通 pending 更适合作为“API/MCP 主跑 + browser fallback”是否真实修复旧失败的验证样本。
- 当前优先样本范围已明确为：`ai-technology-spark`、`airplane`、`airplane-disabled`、`airplane-mode`、`airport-arrival-time`、`airport-plane`、`airport-plane-transit`、`airport-security`、`alarm-add-bell-notification`、`alarm-bell-1`、`alarm-bell-2`、`alarm-bell-off`。
- 这也说明，本轮应把注意力集中在执行链可靠性而不是清洗回归：`pollutedCount` 继续为 `0`，因此后续 closeout 重点应放在“旧 failed 是否能被 hybrid 链路正式吃回”，而不是重复验证 tags 清洗是否再次回归。
- 批次 17 / 执行与验证已对这组历史 failed 样本中的 `ai-technology-spark`、`airplane`、`airplane-disabled`、`airplane-mode` 做了真实 hybrid 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 本轮执行通过正式 `runStreamlineMetadataHybridLoop(...)` 入口，以 `itemIds` 精确锁定上述 4 项并开启 `retryFailed: true`，按“API/MCP 主跑 + browser fallback”闭环执行；browser fallback 继续沿低频 human-mode 节奏，参数为 `waitMs 2500 / postLoadJitterMs 1200 / preNavigationDelayMs 3000 / preNavigationJitterMs 2200 / postItemDelayMs 4000 / postItemJitterMs 3000`。
- 真实结果显示，这轮 hybrid telemetry 为 `requested 4 / success 4 / failed 0`；权威 manifest 也从 `withTags 650 / success 650 / failed 35 / pending 1219` 推进到 `withTags 654 / success 654 / failed 31 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明 hybrid runner 不只是能吃回 API 空 tags 项，也能实打实吃回历史 `payload not found` failed。
- 本轮新增成功样例包括：`ai-technology-spark`，其 tags 含 `ai, technology, spark, innovation, intelligence, creativity, digital, inspiration, lightbulb, idea`；`airplane`，其 tags 含 `airplane, plane, aeroplane, jet, aircraft, jetliner, flying, aviation, travel, transport, flight`；`airplane-disabled`，其 tags 含 `plane, airplane, disabled, off, mode, nofly, prohibited, ban, restricted, aviation, network`；`airplane-mode`，其 tags 含 `airplane mode, disabled, off, prohibited, forbidden, silent, network, internet, airport, flight`。
- 重生 registry 后，运行时消费也已闭环验证：`jetliner flying aviation -> airplane`、`prohibited ban restricted -> airplane-disabled`、`forbidden silent network -> airplane-mode`、`spark innovation intelligence -> ai-technology-spark` 均可命中。
- 因此，`itemIds` 精确选择已经被证明足以支持 failed 清理按小批次定向推进，而不需要粗粒度重跑全部 failed；剩余 failed 也不应再被视为只能靠一次性手工修复，而是可以继续被 hybrid 链路系统性压降。
- 批次 18 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 654 / success 654 / failed 31 / pending 1219 / pollutedCount 0`，本轮推进仍必须以这份 manifest 作为唯一真相源。
- 本轮样本继续沿历史 `payload not found` failed 清理推进，优先锁定 `airport-arrival-time`、`airport-plane`、`airport-plane-transit`、`airport-security` 这 4 项。它们与上一轮机场/航空相关条目属于同一语义簇，因此更适合作为连续 failed 清理的下一组验证样本。
- 这也说明，批次 17 已证明 `itemIds + retryFailed: true` 的 hybrid 小批次模式有效后，后续 failed 清理可以继续沿同一模式小步推进，而不需要回退到泛跑新 pending 的粗粒度策略。
- 与上一轮相同，本轮 closeout 重点仍应放在执行链可靠性：manifest 依旧是唯一权威判据，`pollutedCount` 继续为 `0`，因此注意力应继续集中在“历史 failed 是否能被 hybrid 链路持续压降”，而不是重复回到清洗回归验证。
- 批次 18 / 执行与验证已对这组机场语义簇 failed 样本中的 `airport-arrival-time`、`airport-plane`、`airport-plane-transit`、`airport-security` 做了真实 hybrid 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 本轮执行继续通过正式 `runStreamlineMetadataHybridLoop(...)` 入口，以 `itemIds` 精确锁定上述 4 项并开启 `retryFailed: true`，按“API/MCP 主跑 + browser fallback”闭环执行；browser fallback 继续沿低频 human-mode 节奏，参数保持为 `waitMs 2500 / postLoadJitterMs 1200 / preNavigationDelayMs 3000 / preNavigationJitterMs 2200 / postItemDelayMs 4000 / postItemJitterMs 3000`。
- 真实结果显示，这轮 hybrid telemetry 为 `requested 4 / success 4 / failed 0`；权威 manifest 也从 `withTags 654 / success 654 / failed 31 / pending 1219` 推进到 `withTags 658 / success 658 / failed 27 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明 hybrid runner 已连续两轮证明可以系统性吃回历史 `payload not found` failed，而不是只对单个样例生效。
- 本轮新增成功样例包括：`airport-arrival-time`，其 tags 含 `arrival, airport, time, schedule, flight, clock, landing, travel, timetable, entrance`；`airport-plane`，其 tags 含 `airport, plane, aircraft, flight, aviation, jet, travel, departure, arrival, terminal`；`airport-plane-transit`，其 tags 含 `airport, plane, transit, update, refresh, reload, cycle, rotate, sync, loop, repeat, renew`；`airport-security`，其 tags 含 `airport, security, safety, shield, protection, guard, defense, checkpoints, baggage, scan`。
- 重生 registry 后，运行时消费也已闭环验证：`schedule flight clock -> airport-arrival-time`、`aircraft flight aviation -> airport-plane`、`cycle rotate sync loop -> airport-plane-transit`、`runway boarding baggage -> airport-plane-transit`、`safety shield protection -> airport-security` 均可命中。
- 因此，机场相关语义簇说明这类 failed 可以按主题连续小批次清理；当前剩余 failed 也仍可继续沿 `itemIds + retryFailed: true` 的 hybrid 模式系统压降，而不需要回退到粗粒度的全量 failed 重跑。
- 批次 19 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 658 / success 658 / failed 27 / pending 1219 / pollutedCount 0`，本轮推进仍必须以这份 manifest 作为唯一真相源。
- 本轮样本继续沿历史 `payload not found` failed 清理推进，优先锁定 `alarm-add-bell-notification`、`alarm-bell-1`、`alarm-bell-2`、`alarm-bell-off` 这 4 项。它们与前几轮航空/机场条目一样，属于同一语义簇，因此适合作为连续 failed 清理的下一组验证样本。
- 这也说明，批次 17-18 已经证明 `itemIds + retryFailed: true` 的 hybrid 小批次模式有效后，后续 failed 清理可以继续沿同一模式小步推进，而不需要回退到泛跑新 pending 的粗粒度策略。
- 与上一轮相同，本轮 closeout 重点仍应放在执行链可靠性：manifest 依旧是唯一权威判据，`pollutedCount` 继续为 `0`，因此注意力应继续集中在“历史 failed 是否能被 hybrid 链路持续压降”，而不是重复回到清洗回归验证。
- 批次 19 / 执行与验证已对这组 alarm 语义簇 failed 样本中的 `alarm-add-bell-notification`、`alarm-bell-1`、`alarm-bell-2`、`alarm-bell-off` 做了真实 hybrid 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 本轮执行继续通过正式 `runStreamlineMetadataHybridLoop(...)` 入口，以 `itemIds` 精确锁定上述 4 项并开启 `retryFailed: true`，按“API/MCP 主跑 + browser fallback”闭环执行；browser fallback 继续沿低频 human-mode 节奏，参数保持为 `waitMs 2500 / postLoadJitterMs 1200 / preNavigationDelayMs 3000 / preNavigationJitterMs 2200 / postItemDelayMs 4000 / postItemJitterMs 3000`。
- 真实结果显示，这轮 hybrid telemetry 为 `requested 4 / success 4 / failed 0`；权威 manifest 也从 `withTags 658 / success 658 / failed 27 / pending 1219` 推进到 `withTags 662 / success 662 / failed 23 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明 hybrid runner 已连续三轮证明可以系统性吃回历史 `payload not found` failed。
- 本轮新增成功样例包括：`alarm-add-bell-notification`，其 tags 含 `alarm, add, bell, notification, alert, reminder, signal, siren, alertness, sound`；`alarm-bell-1`，其 tags 含 `alarm, bell, alert, ring, notification, ringing, snooze, sound, vibrate, reminder, doorbell, chime`；`alarm-bell-2`，其 tags 含 `alarm, bell, alert, notification, warning, emergency, alertness, siren, sound, ring`；`alarm-bell-off`，其 tags 含 `alarm, off, bell, disable, mute, silent, cancel, forbidden, banned, snooze, no reminder`。
- 重生 registry 后，运行时消费也已闭环验证：`reminder signal siren -> alarm-add-bell-notification`、`ringing snooze sound vibrate -> alarm-bell-1`、`doorbell chime siren -> alarm-bell-1`、`warning emergency alertness -> alarm-bell-2`、`disable mute silent -> alarm-bell-off` 均可命中。
- 因此，失败项按语义簇连续小批次推进的模式已经稳定，不再只是临时试验；当前剩余 failed 仍可继续沿 `itemIds + retryFailed: true` 的 hybrid 模式系统压降。
- 批次 20 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 662 / success 662 / failed 23 / pending 1219 / pollutedCount 0`，本轮推进仍必须以这份 manifest 作为唯一真相源。
- 本轮样本继续沿历史 `payload not found` failed 清理推进，优先锁定 `align-back`、`align-bottom`、`align-front`、`align-front-selection` 这 4 项。它们与前几轮机场/alarm 条目一样，属于同一语义簇，因此适合作为连续 failed 清理的下一组验证样本。
- 这也说明，批次 17-19 已经证明 `itemIds + retryFailed: true` 的 hybrid 小批次模式有效后，后续 failed 清理可以继续沿同一模式小步推进，而不需要回退到泛跑新 pending 的粗粒度策略。
- 与上一轮相同，本轮 closeout 重点仍应放在执行链可靠性：manifest 依旧是唯一权威判据，`pollutedCount` 继续为 `0`，因此注意力应继续集中在“历史 failed 是否能被 hybrid 链路持续压降”，而不是重复回到清洗回归验证。
- 批次 20 / 执行与验证已对这组 align 语义簇 failed 样本中的 `align-back`、`align-bottom`、`align-front`、`align-front-selection` 做了真实 hybrid 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 本轮执行继续通过正式 `runStreamlineMetadataHybridLoop(...)` 入口，以 `itemIds` 精确锁定上述 4 项并开启 `retryFailed: true`，按“API/MCP 主跑 + browser fallback”闭环执行；browser fallback 继续沿低频 human-mode 节奏，参数保持为 `waitMs 2500 / postLoadJitterMs 1200 / preNavigationDelayMs 3000 / preNavigationJitterMs 2200 / postItemDelayMs 4000 / postItemJitterMs 3000`。
- 真实结果显示，这轮 hybrid telemetry 为 `requested 4 / success 4 / failed 0`；权威 manifest 也从 `withTags 662 / success 662 / failed 23 / pending 1219` 推进到 `withTags 666 / success 666 / failed 19 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明 hybrid runner 已连续四轮证明可以系统性吃回历史 `payload not found` failed。
- 本轮新增成功样例包括：`align-back`，其 tags 含 `align, back, layers, layer, stack, swap, exchange, replace, switch, change`；`align-bottom`，其 tags 含 `align, bottom, alignment, line, phone, smartphone, device, tech, cellphone, gadget`；`align-front`，其 tags 含 `align, front, layers, overlap, stack, pages, adjust, coordinate, balance, synchronize`；`align-front-selection`，其 tags 含 `align, front, selection, positioning, calibration, adjustment, synchronization, orientation, edit, image`。
- 重生 registry 后，运行时消费也已闭环验证：`layer stack swap exchange -> align-back`、`line phone smartphone device -> align-bottom`、`overlap stack pages adjust -> align-front`、`selection positioning calibration -> align-front-selection` 均可命中。
- 因此，失败项按语义簇连续小批次推进的模式继续稳定，不再只是临时试验；当前剩余 failed 仍可继续沿 `itemIds + retryFailed: true` 的 hybrid 模式系统压降。
- 当前 metadata 源里已观察到至少 2 条 tag 污染样例带有 Markdown fenced-code 前缀：manifest 中存在 `````plaintext\ncall`` 与 `````plaintext\nchat``，对应生成后的 `searchText` 也会连带带入该前缀。现阶段它们不阻断命中，但应作为后续 metadata 清洗问题单独跟踪，不应误当作正常 tag 词汇。
- 该类 fenced-code 污染在批次 8 已完成链路级修补与一次真实 manifest 回写清理：历史命中的 `call-alert`、`chat-bubble-disable-oval` 已被清洗，当前 `pollutedCount = 0`。后续如果再次出现同类字符串，应优先视为清洗链路回归，而不是新的正常 tags。
- 不应把列表页 HTML、首屏卡片 DOM 或首个分组 state 误当作官方 Tags 的长期契约来源。

## 验证标准

- `tests/streamline-export/manifest-store.test.mjs` 已覆盖新建 manifest 默认 metadata、历史 manifest 归一化、单条 metadata 更新、批量 metadata 更新与 summary 统计。
- `tests/streamline-export/extract-streamline-detail-metadata.test.mjs` 已覆盖详情页 metadata 提取、默认跳过 `metadataStatus === "failed"`、`retryFailed` 控制、以及并行 chunk 提取后批量持久化。
- `tests/streamline-export/streamline-metadata-session.test.mjs` 已覆盖 `concurrency > 1` 时切换到并行 extraction、`humanMode` 串行透传以及并行限制报错。
- `tests/streamline-export/metadata-runner.test.mjs` 已覆盖 loop runner 的批次推进、`concurrency` 透传、`reuseBrowser` 行为，以及 `humanMode` 自动套用推荐 pacing 默认值。
- `tests/streamline-export/import-streamline-official-metadata.test.mjs`、`tests/streamline-export/streamline-official-metadata-source.test.mjs` 已覆盖离线官方 metadata 的索引、`hash` 优先 / `slug` 兜底回填与批量导入行为。
- `tests/streamline-export/generate-shared-view-streamline-icons.test.mjs` 已覆盖 `tags` 进入 runtime metadata 与 `searchText` 的消费行为。
- 批次 8 对 tags 清洗链路新增/更新了定向测试：`tests/streamline-export/streamline-tag-normalization.test.mjs`、`tests/streamline-export/streamline-detail-metadata.test.mjs`、`tests/streamline-export/streamline-official-metadata-source.test.mjs`、`tests/streamline-export/manifest-store.test.mjs`、`tests/streamline-export/generate-shared-view-streamline-icons.test.mjs`；该组用例在完成报告中记录为 `27/27 pass`。
- 批次 8 又为 `tests/streamline-export/streamline-mcp-client.test.mjs` 补充了 fenced-code 污染样例，说明 MCP 入口现在也有显式回归覆盖，不再只依赖 detail / official / manifest / registry 侧的清洗测试。
- `npm run test:streamline-export` 在本次完成报告里记录为 `83/83 pass`；2026-06-24 在当前仓库快照复验结果为 `86/86 pass`，应以当前复验通过为准。

## 关键检索词

- `Streamline metadata runner`
- `updateManifestItemsMetadataBatch`
- `runManifestMetadataExtractionParallel`
- `DEFAULT_STREAMLINE_HUMAN_METADATA_PACING`
- `humanMode`
- `runStreamlineMetadataExtractionLoopFromNodeRepl`
- `retryFailed`
- `reuseBrowser`
- `concurrency`
- `import-streamline-official-metadata`
- `streamline-official-metadata-source`
- `micro-solid-full.manifest.json`
- `streamline-shared-view-icons`
- `searchText`
- `magnifyingglass`
- `logistics`
- `compress`
- `paperclip`
- `woodworking`
- `formula`
- `thunder`
- `cryptocurrency`
- `hemoglobin`
- `banknotes`
- `peppermint`
- `teepee`
- `geotag`
- `bonfire`
- `bubbly`
- `berries`
- `culinary`
- `recheck`
- `caution`
- `healthcare`
- `portable`
- `skyrocketing`
- `formatting`
- `mute`
- `eyedrop`
- `swatch`
- `generosity`
- `espresso`
- `inspection`
- `software`
- `blocked`
- `attribution`
- `duplicate`
- `privacy`
- `gamepad`
- `login`
- `backup`
- `forbidden`
- `inspect`
- `apps`
- `widgets`
- `certified`
- `bright`
- `banner`
- `aspect ratio`
- `solidarity`
- `astronomy`
- `programming`
- `internet`
- `navigation`
- `signin`
- `buddhism`
- `sidebyside`
- `equator`
- `otology`
- `earbuds`
- `quadcopter`
- `pupil`
- `spectacles`
- `maximize`
- `economy`
- `ascend`
- `stationery`
- `women`
- `dial-pad-1`
- `desktop-code`
- `desktop-search`
- `desktop-unlock`
- `diagonal-scroll-1`
- `dhammajak`
- ````plaintext
- `streamline-tag-normalization`
- `normalizeStreamlineTags`
- `call-alert`
- `chat-bubble-disable-oval`
- `pollutedCount = 0`
- `stale session`
- `Tab not found`
- `not part of browser session`
- `4 x 10`
- `zigzag`
- `skyward`
- `crossover`
- `decline`
- `300 seconds`
- `tool timeout`
- `uninstall`
- `toolbar`
- `403 Forbidden`
- `Server: Vercel`

## 批次 21 增量事实

- 批次 21 / 任务 1 的基线确认同时收敛了新的真实站点约束：虽然官网页面当前可以访问，但已不能再像之前那样大批量使用脚本访问，只能低频率、拟人化地模拟真实用户访问。因此页面侧不应再被表述成可持续的大窗口批处理面，而应明确收敛为 `humanMode + concurrency = 1` 的微批次真实访问面。
- 在这条新约束下，当前 micro-solid manifest 的权威计数更新为 `total 1904 / withTags 668 / success 668 / failed 17 / pending 1219 / pollutedCount 0`；这份 counts 继续作为本轮和后续页面侧回填的唯一真相源。
- 批次 21 / 执行与验证已对这组 align 语义簇 failed 样本中的 `align-horizontal-center`、`align-horizontal-center-2` 做了真实 low-frequency human-mode 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 真实结果显示，这轮 low-frequency human-mode telemetry 为 `requested 2 / success 2 / failed 0`；权威 manifest 也从 `withTags 666 / success 666 / failed 19 / pending 1219` 推进到 `withTags 668 / success 668 / failed 17 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明在页面侧批量脚本访问已不可行的前提下，低频拟人化微批次仍然可以持续吃回历史 `payload not found` failed。
- 本轮新增成功样例包括：`align-horizontal-center`，其 tags 含 `align, horizontal, center, equidistant, midpoint, flowchart, diagram, process, structure, map, chart, workflow, schema, outline, block`；`align-horizontal-center-2`，其 tags 含 `align, horizontal, center, symmetry, centralize, balance, equilibrium, midpoint, process, flowchart, diagram, rectangle, connection, outline, shape, symbol, schematic, graphic`。
- 重生 registry 后，运行时消费也已闭环验证：`equidistant workflow block -> align-horizontal-center`、`symmetry balance midpoint -> align-horizontal-center-2` 均可命中。这说明新的页面侧执行边界不会破坏 generator 到 icon picker 搜索消费的链路正确性。
- 批次 22 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 668 / success 668 / failed 17 / pending 1219 / pollutedCount 0`，本轮推进仍必须以这份 manifest 作为唯一真相源。
- 本轮样本继续沿 align 语义簇 failed 清理推进，优先锁定 `align-text-bottom`、`align-text-center`、`align-text-top` 这 3 项。它们与前两轮 `align-horizontal-*` 样本一样，属于同一语义簇，因此适合作为低频拟人化微批次的连续验证样本。
- 批次 22 / 执行与验证已对这组 align-text 语义簇 failed 样本中的 `align-text-bottom`、`align-text-center`、`align-text-top` 做了真实 low-frequency human-mode 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 真实结果显示，这轮 low-frequency human-mode telemetry 为 `requested 3 / success 3 / failed 0`；权威 manifest 也从 `withTags 668 / success 668 / failed 17 / pending 1219` 推进到 `withTags 671 / success 671 / failed 14 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明在页面批量脚本访问已不可行的前提下，低频拟人化微批次仍然可以连续多轮吃回历史 `payload not found` failed。
- 本轮新增成功样例包括：`align-text-bottom`，其 tags 含 `align, text, bottom, lines, formatting, layout, interface, ui, ux, bars, menu, navigation, hamburger, button, square`；`align-text-center`，其 tags 含 `align, centered, center, text, justification, formatting, typography, lines, ui, interface, web, app, navigation, menu, hamburger, symbol, button`；`align-text-top`，其 tags 含 `align, top, text, interface, ui, button, menu, tools, design, app, web, move, up, arrow, square, hamburger, navigation`。
- 重生 registry 后，运行时消费也已闭环验证：`formatting navigation square -> align-text-bottom`、`typography menu centered -> align-text-center`、`tools move arrow -> align-text-top` 均可命中。这里还额外确认，若用同进程直接重复导入 `src/generated/streamline-shared-view-icons.mjs`，可能会读到旧模块缓存；因此运行时验证应优先重新加载模块或直接检查生成文件内容，再判定是否真的发生 generator 回归。
- 批次 23 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 671 / success 671 / failed 14 / pending 1219 / pollutedCount 0`，本轮推进仍必须以这份 manifest 作为唯一真相源。
- 本轮样本进一步从单一语义簇扩展到 mixed batch，优先锁定 `alert-shield-privacy-info`、`align-horizontal-left`、`allergens-gluten`、`alt` 这 4 项头部 failed，用来验证低频拟人化微批次在非单一语义簇下仍可稳定推进。
- 批次 23 / 执行与验证已对这组 mixed failed 样本中的 `alert-shield-privacy-info`、`align-horizontal-left`、`allergens-gluten`、`alt` 做了真实 low-frequency human-mode 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 真实结果显示，这轮 low-frequency human-mode telemetry 为 `requested 4 / success 4 / failed 0`；权威 manifest 也从 `withTags 671 / success 671 / failed 14 / pending 1219` 推进到 `withTags 675 / success 675 / failed 10 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明低频拟人化微批次不仅能在单一 `align-*` 语义簇内稳定吃回 failed，也能在小规模 mixed batch 中继续稳定推进。
- 本轮新增成功样例包括：`alert-shield-privacy-info`，其 tags 含 `alert, shield, privacy, warning, security, protection, caution, attention, exclamation, notice`；`align-horizontal-left`，其 tags 含 `align, left, horizontal, position, adjustment, orientation, formatting, buttons, layout, ui, interface, web, menu, navigation, sidebar, justification, app, hamburger`；`allergens-gluten`，其 tags 含 `gluten, allergy, allergens, wheat, food, produce, bread, celiac, dough, grain`；`alt`，其 tags 含 `alt, keys, keyboard, keycap, shortcut, hotkey, backspace, spacebar, tab, function, symbol, ui, computer, input, tech`。
- 重生 registry 后，生成文件内容与 query 语义均已闭环验证：`privacy warning shield -> alert-shield-privacy-info`、`sidebar justification hamburger -> align-horizontal-left`、`celiac bread grain -> allergens-gluten`、`keyboard hotkey input -> alt` 都已进入 `searchText`。本轮还再次确认，如果运行时对象抽样与生成文件看起来矛盾，应优先把它归因到导入缓存边界，而不是直接判定 generator 回归。
- 批次 24 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 675 / success 675 / failed 10 / pending 1219 / pollutedCount 0`，本轮推进仍必须以这份 manifest 作为唯一真相源。
- 本轮继续优先处理页面侧 `payload not found` failed，并显式把它们与 MCP 空 tags 类 `flip-*` failed 分开看待。当前样本锁定为 `ambulance`、`ampersand`、`anchor`、`android-logo`，用于继续压降页面侧 failed。
- 批次 24 / 执行与验证已对这组页面侧 failed 样本中的 `ambulance`、`ampersand`、`anchor`、`android-logo` 做了真实 low-frequency human-mode 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 真实结果显示，这轮 low-frequency human-mode telemetry 为 `requested 4 / success 4 / failed 0`；权威 manifest 也从 `withTags 675 / success 675 / failed 10 / pending 1219` 推进到 `withTags 679 / success 679 / failed 6 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明在低频拟人化微批次下，页面侧 `payload not found` failed 仍然可以继续稳定压降。
- 本轮新增成功样例包括：`ambulance`，其 tags 含 `ambulance, emergency, medical, rescue, healthcare, health, paramedic, hospital, firstaid, vehicle, transport, car`；`ampersand`，其 tags 含 `ampersand, glyph, symbol, typography, curves, typeface, design, graphic, bold, italic, underline, art, paragraph, alignment, logogram`；`anchor`，其 tags 含 `anchor, nautical, symbol, maritime, ocean, sea, sailing, boating, navy, harbor, port, ship, dock, boat, vessel, marina`；`android-logo`，其 tags 含 `android, logo, robot, green, symbol, brand, smartphone, design, lineart, minimalist, outline, chair, seating, furniture, armrest, interior, house`。
- 重生 registry 后，生成文件内容与 query 语义均已闭环验证：`paramedic hospital vehicle -> ambulance`、`glyph typeface logogram -> ampersand`、`maritime harbor vessel -> anchor`、`robot smartphone minimalist -> android-logo` 都已进入 `searchText`。本轮再次确认，即使运行时对象抽样因导入缓存看起来仍是旧值，只要生成文件内容和语义 query 已成立，就不应把它误判为 generator 回归。
- 批次 25 / 任务 1 的基线确认进一步表明，当前剩余 failed 已经清晰分成两类：页面侧 `payload not found`（announcement-megaphone、apple、apple-logo）与 MCP 空 tags（flip-horizontal-1、flip-horizontal-2、flip-left）。本轮目标是清空最后一组页面侧 failed，让剩余结构完全收敛到 MCP 空 tags 补洞。
- 批次 25 / 执行与验证已对 `announcement-megaphone`、`apple`、`apple-logo` 做了真实 low-frequency human-mode 回填。它们在批次开始前都处于 `metadataStatus = failed`，且错误均为 `Error: Streamline detail metadata payload not found`。
- 真实结果显示，这轮 low-frequency human-mode telemetry 为 `requested 3 / success 3 / failed 0`；权威 manifest 也从 `withTags 679 / success 679 / failed 6 / pending 1219` 推进到 `withTags 682 / success 682 / failed 3 / pending 1219`，且 `pollutedCount` 继续保持 `0`。这说明页面侧 `payload not found` failed 已全部清零，当前剩余 failed 结构只剩 MCP 空 tags。
- 本轮新增成功样例包括：`announcement-megaphone`，其 tags 含 `announcement, megaphone, broadcast, publicity, promotion, advertisement, speaker, communication, voice, sound, alert, loud, notice, public`；`apple`，其 tags 含 `apple, fruit, outline, simple, drawing, abstract, plant, vector, healthy, organic, pie, sweet, juice, cider, orchard, leafless`；`apple-logo`，其 tags 含 `logo, apple, tech, brand, icon, design, technology, bitten, symbol, branding, byte, identity, fruit`。
- 重生 registry 后，生成文件内容与 query 语义均已闭环验证：`broadcast promotion public -> announcement-megaphone`、`organic orchard cider -> apple`、`branding technology bitten -> apple-logo` 都已进入 `searchText`。至此，页面侧 failed 清理阶段可视为完成。
- 批次 26 / 任务 1 的基线确认显示，当前仅剩 3 个 failed，且全部属于 `Official MCP metadata returned no tags`：`flip-horizontal-1`、`flip-horizontal-2`、`flip-left`。这说明历史 failed 已经完全收敛成单一根因，可以专门沿精确 `itemIds` 的浏览器 fallback 路线补洞。
- 批次 26 / 执行与验证已对 `flip-horizontal-1`、`flip-horizontal-2`、`flip-left` 做了真实精确补洞。真实结果显示，这轮 low-frequency fallback telemetry 为 `requested 3 / success 3 / failed 0`；权威 manifest 也从 `withTags 682 / success 682 / failed 3 / pending 1219` 推进到 `withTags 685 / success 685 / failed 0 / pending 1219`，且 `pollutedCount` 继续保持 `0`。
- 本轮新增成功样例包括：`flip-horizontal-1`，其 tags 含 `flip, horizontal, mirror, reflection, invert, arrows, direction, iconography, control, interface, rotate, symbol, reposition, forward, video, play, pause`；`flip-horizontal-2`，其 tags 含 `flip, horizontal, mirror, reverse, reflection, rotate, invert, arrow, road, lanes, traffic, highway, path, direction, streets, driving, journey, route`；`flip-left`，其 tags 含 `flip, left, arrow, direction, move, turn, edit, capture, frame, camera, viewfinder, shutter, picture, focus, square, dash, photography, shoot`。
- 重生 registry 后，生成文件内容与 query 语义均已闭环验证：`traffic journey route -> flip-horizontal-2`、`camera photography shoot -> flip-left` 均已进入 `searchText`；`flip-horizontal-1` 的生成文件也已明确包含 `mirror / video / pause`。至此，micro-solid manifest 当前 `metadataStatus = failed` 的历史失败项已全部清零，剩余工作只在 `pending` 阶段。
- 批次 27 / 任务 1 的基线确认进一步固定了新阶段的起跑线：当前 micro-solid manifest 计数为 `total 1904 / withTags 685 / success 685 / failed 0 / pending 1219 / pollutedCount 0`。这说明历史 failed 清理阶段已经结束，后续真正的主线变成 `pending` 推进。
- 本轮选择了一组连续 `pending` 样本：`flip-up`、`flip-vertical-1`、`flip-vertical-2`、`flll-color-bucket`、`flower`、`focus-center`、`focus-points`、`fog-cloud`。首先通过 MCP 并行批处理跑了一个 `batch-size 8 / concurrency 4` 窗口。
- 这轮 MCP 并行批处理的第一跳没有直接产出 success，而是把 `pending 1219 -> 1211` 同时把这 8 项标记成新的 `Official MCP metadata returned no tags` failed。也就是说，MCP 并行窗口对这组样本的价值更像“批量判空并筛出浏览器补洞清单”，而不是直接拿到最终 tags。
- 随后对这 8 个被 MCP 判空的样本按精确 `itemIds + retryFailed: true` 走浏览器 fallback，`flip-up`、`flip-vertical-1`、`flip-vertical-2`、`flll-color-bucket`、`flower`、`focus-center`、`focus-points`、`fog-cloud` 全部被真实吃回为 success。
- 权威 manifest 也因此从 `withTags 685 / success 685 / failed 0 / pending 1219` 推进到 `withTags 693 / success 693 / failed 0 / pending 1211`，且 `pollutedCount` 继续保持 `0`。这说明“并行 MCP 主跑 -> 批量判空 -> 浏览器 fallback 补洞”的正式链路不仅能清理 failed，也能继续把 `pending` 真正推进成落盘的 success。
- 本轮新增成功样例包括：`flip-up`，其 tags 含 `calendar, organizer, reminder` 等日程语义；`focus-center`，其 tags 含 `crosshair, camera, photography`；`fog-cloud`，其 tags 含 `weather, mist, atmosphere`。重生 registry 后，生成文件内容也已闭环验证：`calendar organizer reminder -> flip-up`、`crosshair camera photography -> focus-center`、`weather mist atmosphere -> fog-cloud` 都已进入 `searchText`。
- 批次 28 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 693 / success 693 / failed 0 / pending 1211 / pollutedCount 0`，本轮推进继续只认这份 manifest。
- 本轮选择的连续 `pending` 样本为 `folder`、`font-size`、`football`、`fork-knife`、`fork-plate`、`fork-spoon`、`format-list-numbered`、`forwarding-call`。执行方式仍是先跑 `batch-size 8 / concurrency 4` 的 MCP 并行窗口，再把被 MCP 判空的样本用浏览器 fallback 精确补洞。
- 这轮 MCP 并行批处理同样没有直接产出 success，而是把 `pending 1211 -> 1203`，并把这 8 项统一标记为新的 `Official MCP metadata returned no tags` failed；随后按精确 `itemIds + retryFailed: true` 走浏览器 fallback，这 8 项全部被真实吃回为 success。
- 权威 manifest 也因此从 `withTags 693 / success 693 / failed 0 / pending 1211` 推进到 `withTags 701 / success 701 / failed 0 / pending 1203`，且 `pollutedCount` 继续保持 `0`。这说明 pending 推进链路在进入 `folder / fork / forwarding` 这一段后仍保持稳定。
- 本轮新增成功样例包括：`folder`，其 tags 含 `archive, paperwork, computer`；`format-list-numbered`，其 tags 含 `sequence, structure, steps`；`forwarding-call`，其 tags 含 `redirect, phone, voice`。这些样例都已在生成产物或条目级片段中拿到 family-aware evidence。
- 批次 29 / 任务 1 的基线确认继续沿用同一权威判据：当前 micro-solid manifest 计数为 `total 1904 / withTags 701 / success 701 / failed 0 / pending 1203 / pollutedCount 0`，本轮推进继续只认这份 manifest。
- 本轮选择的连续 `pending` 样本为 `french-fries`、`fried-egg-breakfast`、`full-moon`、`galaxy-1`、`galaxy-2`、`gameboy`、`gas-canister`、`gas-station-fuel-petroleum`。执行方式仍是先跑 `batch-size 8 / concurrency 4` 的 MCP 并行窗口，再把被 MCP 判空的样本用浏览器 fallback 精确补洞。
- 这轮 MCP 并行批处理同样没有直接产出 success，而是把 `pending 1203 -> 1195`，并把这 8 项统一标记为新的 `Official MCP metadata returned no tags` failed；随后按精确 `itemIds + retryFailed: true` 走浏览器 fallback，这 8 项全部被真实吃回为 success。
- 权威 manifest 也因此从 `withTags 701 / success 701 / failed 0 / pending 1203` 推进到 `withTags 709 / success 709 / failed 0 / pending 1195`，且 `pollutedCount` 继续保持 `0`。这说明 pending 推进链路在进入 `french / full-moon / gas-*` 这一段后仍保持稳定。
- 本轮新增成功样例包括：`french-fries`，其 tags 含 `fries, french, potato, snack, fastfood, crispy, salty, side, diner, crunchy`；`full-moon`，其 tags 含 `full, moon, lunar, night, brightness, illumination, craters`；`gas-canister`，其 tags 含 `gas, canister, fuel, container, petrol, safety, danger, flammable, storage, transport`。
- 本轮还暴露出一个真实链路缺口：虽然 metadata session 已把 tags 正确写回 manifest，但如果不额外重生 `src/generated/streamline-shared-view-icons.mjs`，搜索消费仍会继续读到旧的 `searchText`。修补后重新生成 shared-view registry，已在 `micro-solid` family 维度确认：`french-fries` 的 `searchText` 含 `potato snack fastfood`，`full-moon` 含 `lunar night brightness illumination craters`，`gas-canister` 含 `flammable storage transport`。
## update 2026-06-24 batch-30

### decision delta

47. `Streamline-micro-solid-tags-pending并行推进批次-30 / task 2` 和 `task 3` 继续沿当前默认两段式 pending 推进：先用 MCP 首跳批量判空，再由 browser fallback 精确补洞；对 `gauge-dashboard-1`、`gauge-dashboard-2`、`ghost`、`gibbous-moon-1`、`gibbous-moon-2`、`gift-card`、`gift-present-1`、`gift-present-2` 这一组样本，MCP 判空应视为筛选补洞清单，而不是最终失败结论。
48. 当 metadata session 已经把新增 tags 持久化回 manifest 后，不需要再人工额外执行 `npm run streamline:generate-registry`；`src/generated/streamline-shared-view-icons.mjs` 会在该流程内自动包含新增 `searchText`，因此搜索消费收口应直接看生成文件内容或其对应 query 命中。
49. 生成产物验收必须按 `family + itemId` 维度进行，避免与 `micro-line` 同名 slug 混淆；单看 slug 或单看 family 片段都不足以构成最终消费证据。

### consequence delta

- 本轮 MCP 主跑结果为 `success 0 / failed 8`，八个样本都被暂时判成 `Official MCP metadata returned no tags`；权威 manifest 从 `withTags 709 / success 709 / failed 0 / pending 1195` 变为 `withTags 709 / success 709 / failed 8 / pending 1187`。
- 随后同一组 `itemIds` 走浏览器 fallback，且保持 low-frequency human-mode 参数 `retryFailed: true`、`humanMode: true`、`waitMs 2500`、`postLoadJitterMs 1200`、`preNavigationDelayMs 3000`、`preNavigationJitterMs 2200`、`postItemDelayMs 4000`、`postItemJitterMs 3000` 后，八项全部被真实吃回为 `success 8 / failed 0`。
- 最终权威 manifest 更新为 `total 1904 / withTags 717 / success 717 / failed 0 / pending 1187 / pollutedCount 0`，说明这组 pending 已经完成真实落盘。
- `gauge-dashboard-1`、`ghost`、`gift-present-2` 的 tags 证据分别进入稳定语料，例如 `gauge, dashboard, speedometer, meter, indicator, measure...`、`ghost, spooky, halloween, spectral, cute, phantom...`、`gift, present, wrapped, box, bow, ribbon...`。
- `src/generated/streamline-shared-view-icons.mjs` 的生成条目已经能直接承载 family-aware `searchText`，例如 `micro-solid gauge-dashboard-1 ... 26567 gauge dashboard speedometer meter indicator measure progress sensor ...`、`micro-solid ghost ... 26658 ghost spooky halloween spectral cute phantom cartoon arcade retro spirit`、`micro-solid gift-present-2 ... 26593 gift present wrapped box bow ribbon package surprise celebration holiday bonus offering donation parcel today`。
- 基于动态导入 `streamlineSharedViewIcons` 的真实消费验证也已命中：`speedometer + indicator + sensor -> gauge-dashboard-1`、`spooky + phantom + arcade -> ghost`、`wrapped + bow + parcel -> gift-present-2`。这把证据层级从“生成文件内容包含 tags”提升到了“运行时消费面可命中”。
- 这条 `MCP` 判空 -> browser fallback 吃回 -> manifest 落盘 -> registry 自动同步的闭环，可以作为后续 pending 批次的默认执行模板，也说明 metadata runner 自动同步 registry 后，搜索消费不再依赖人工补跑 generator。

## update 2026-06-24 batch-31

### decision delta

50. `Streamline-micro-solid-tags-pending并行推进批次-31 / task 2` 继续沿当前默认两段式 pending 推进：先用 MCP 首跳批量判空，再由 browser fallback 精确补洞；对 `give-star`、`globe`、`globe-public-access-off`、`gold`、`google-logo`、`graduation-cap`、`grape`、`graph` 这一组样本，MCP 判空应视为筛选补洞清单，而不是最终失败结论。
51. 当 metadata runner 在浏览器 fallback 完成后自动重生 shared-view registry 时，后续验收不应再要求人工额外执行 `npm run streamline:generate-registry`；生成产物与真实消费面命中已经足以证明 registry 同步完成。

### consequence delta

- 本轮 MCP 主跑结果为 `success 0 / failed 8`，八个样本都被暂时判成 `Official MCP metadata returned no tags`；权威 manifest 从 `withTags 717 / success 717 / failed 0 / pending 1187` 变为 `withTags 717 / success 717 / failed 8 / pending 1179`。
- 随后同一组 `itemIds` 走浏览器 fallback，并沿用 low-frequency human-mode 参数后，八项全部被真实吃回为 success。
- 最终权威 manifest 更新为 `total 1904 / withTags 725 / success 725 / failed 0 / pending 1179 / pollutedCount 0`，说明这组 pending 已完成真实落盘。
- `give-star`、`globe-public-access-off`、`graph` 的 tags 证据分别进入稳定语料，例如 `star, give, hand, like, reward, favorite, success, recognition, rating, achievement...`、`globe, access, public, off, restricted, internet, blocked, network, disconnected, closed`、`graph, linechart, chart, diagram, trends, data, statistics, analysis, metrics, analytics...`。
- `src/generated/streamline-shared-view-icons.mjs` 已自动承载新增 family-aware `searchText`，并且真实消费面验证已经命中：`speedometer + indicator + sensor -> gauge-dashboard-1`、`spooky + phantom + arcade -> ghost`、`wrapped + bow + parcel -> gift-present-2`。
- 这轮进一步确认，metadata runner 完成闭环后，registry 自动同步已经是正式行为；后续 pending 推进的验收只需核对 manifest 前进与运行时消费命中，不应再把人工补跑 registry generator 当成必需步骤。

### task 3 delta

52. 本轮没有人工单独执行 `npm run streamline:generate-registry`，registry 更新仍完全依赖 metadata runner 的自动同步。
53. 动态导入 `src/generated/streamline-shared-view-icons.mjs` 的 `streamlineSharedViewIcons` 后，运行时消费面再次命中：`reward + rating + recognition -> give-star`、`restricted + internet + blocked -> globe-public-access-off`、`statistics + analytics + arrow -> graph`。
54. 这说明 batch-30 已经证明过一次的自动同步闭环，在 batch-31 的真实 pending 推进上再次成立，而不是单批偶发成功。
55. 权威 manifest 也继续前进到 `total 1904 / withTags 725 / success 725 / failed 0 / pending 1179 / pollutedCount 0`，说明闭环在继续压降 pending 的同时没有破坏搜索消费正确性。

## batch-31 closeout

- 批次 31 的完成证明继续沿用同一条默认闭环：`MCP` 首跳批量判空后，由浏览器 fallback 精确补洞，目标样本为 `give-star`、`globe`、`globe-public-access-off`、`gold`、`google-logo`、`graduation-cap`、`grape`、`graph`。
- 这轮最终把权威 manifest 从 `withTags 717 / success 717 / failed 0 / pending 1187` 推进到 `withTags 725 / success 725 / failed 0 / pending 1179 / pollutedCount 0`，说明 pending 继续稳定压降且没有引入新的 failed。
- batch-31 的关键新增事实是：batch-30 已经证明过一次的自动 registry 同步闭环，在这轮真实 pending 推进中再次成立，因此它应被视为可复用策略，而不是单批偶发现象。
- 运行时消费面继续命中 `reward + rating + recognition -> give-star`、`restricted + internet + blocked -> globe-public-access-off`、`statistics + analytics + arrow -> graph`，说明连续两轮真实 pending 推进都没有破坏搜索消费正确性。
- 后续 pending 推进的正式验收继续只需要核对 manifest 前进与运行时消费命中，不应再把人工补跑 `npm run streamline:generate-registry` 当成必需步骤。

## update 2026-06-24 batch-32

### decision delta

56. `Streamline-micro-solid-tags-pending并行推进批次-32 / task 2` 继续沿当前默认两段式 pending 推进：先用 MCP 首跳批量判空，再由 browser fallback 精确补洞；对 `graph-arrow-decrease`、`graph-arrow-increase`、`graph-bar`、`graph-bar-decrease`、`graph-bar-decrease-square`、`graph-bar-horizontal`、`graph-bar-increase`、`graph-bar-increase-square` 这一组样本，MCP 判空应视为筛选补洞清单，而不是最终失败结论。
57. 当 metadata runner 在浏览器 fallback 完成后自动重生 shared-view registry 时，后续验收仍应以生成产物与真实消费面命中为准，不需要再人工额外执行 `npm run streamline:generate-registry`。

### consequence delta

- 本轮 MCP 主跑结果为 `success 0 / failed 8`，八个样本都被暂时判成 `Official MCP metadata returned no tags`；权威 manifest 从 `withTags 725 / success 725 / failed 0 / pending 1179` 变为 `withTags 725 / success 725 / failed 8 / pending 1171`。
- 随后同一组 `itemIds` 走浏览器 fallback，并沿用 low-frequency human-mode 参数后，八项全部被真实吃回为 success。
- 最终权威 manifest 更新为 `total 1904 / withTags 733 / success 733 / failed 0 / pending 1171 / pollutedCount 0`，说明这组 pending 已完成真实落盘。
- `graph-arrow-decrease`、`graph-bar-horizontal`、`graph-bar-increase-square` 的 tags 证据分别进入稳定语料，例如 `graph, arrow, decrease, down, trend, finance, recession, decline, fall, economy...`、`graph, barchart, horizontal, bars, chart, analysis, analytics, ranking, statistics, segments...`、`graph, bars, increase, chart, data, visualization, analytics, metrics, up, performance...`。
- `src/generated/streamline-shared-view-icons.mjs` 已自动承载新增 family-aware `searchText`，且运行时消费面继续能通过动态导入命中对应 query。
- 这轮再次确认，metadata runner 完成闭环后 registry 自动同步仍然是正式行为；后续 pending 推进的验收继续只需核对 manifest 前进与运行时消费命中，不应再把人工补跑 registry generator 当成必需步骤。

## update 2026-06-24 batch-46

### task 2 delta

142. `Streamline-micro-solid-tags-pending并行推进批次-46` 继续只推进 `micro-solid`，不处理 `micro-line`；本轮推进与验收都只以 `artifacts/streamline-export/micro-solid-full.manifest.json` 和 generated registry 中的 micro-solid 条目为准。
143. MCP 小批量试探后仍由系统 Chrome + Playwright shim 分段 fallback 接手，`pending` 补洞策略没有变化。
144. 本轮 M​CP 结果仍是 `success 0 / failed 8 / pendingBefore 1067 / pendingAfter 1059`，这 8 个样本继续被判空，作为浏览器补洞清单使用。
145. 浏览器 fallback 改用系统 Chrome + Playwright shim，按 `3 + 3 + 2` 低频真人化访问；过程中发现 shim 需要兼容 `tab.playwright.waitForLoadState({ state, timeoutMs })` 对象签名，补齐后稳定。
146. 三段 fallback 全部成功，`failed` 被清回 `0`。

### task 3 delta

147. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
148. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `id-finger-print`、`id-iris-scan-check`、`id-voice-2` 等条目对应语料已进入生成产物。
149. family-aware 搜索命中证据再次成立：`fingerprint -> id-finger-print / id-finger-print-scan / id-thumb-mark`、`ocular -> id-iris-scan-check`、`electrocardiogram -> id-voice-2`、`biometrics -> id-thumb-mark`。
150. 运行时真实消费逻辑仍在 `src/components/ViewTabs.tsx` 的 `resolveSearchIconIds`，核心条件仍是 `sharedViewGeneratedIconSearchText[iconId]?.includes(normalizedQuery)`。
151. 自动 registry 同步闭环在纯 `micro-solid` 连续批次中继续成立，searchText 的生成产物与运行时消费保持一致。

## batch-46 closeout

- 批次 46 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由系统 Chrome Playwright shim 分段 fallback 精确补洞，目标样本为 `id-finger-print`、`id-finger-print-scan`、`id-iris-scan-alternate`、`id-iris-scan-check`、`id-thumb-mark`、`id-user`、`id-voice-1`、`id-voice-2`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 837 / success 837 / failed 8 / pending 1059`；随后按精确 `itemIds` 用 `3 + 3 + 2` 小批次全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 845 / success 845 / failed 0 / pending 1059`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- 本轮任务边界重新确认：只推进 `micro-solid`，不处理 `micro-line`；generated shared-view registry 虽然同时包含两家族条目，但本轮实际推进的权威 manifest 仍然只认 `micro-solid`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `fingerprint -> id-finger-print / id-finger-print-scan / id-thumb-mark`、`ocular -> id-iris-scan-check`、`electrocardiogram -> id-voice-2`、`biometrics -> id-thumb-mark`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”为准；这条分段 fallback 已经成为纯 `micro-solid` 连续批次上的稳定执行路径。

## update 2026-06-24 batch-46

### decision delta

140. `Streamline-micro-solid-tags-pending并行推进批次-46 / task 1` 继续沿用已经验证稳定的执行边界：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。
141. 当前处理 family 仍然是 `micro-solid`，不是 `micro-line`；虽然 generated shared-view registry 会同时包含两家族条目，但本轮推进的权威 manifest 仍然只认 `artifacts/streamline-export/micro-solid-full.manifest.json`。

### consequence delta

- 本轮开始前 summary 为 `total 1904 / withTags 837 / success 837 / failed 0 / pending 1067`。
- 当前 pending head 为 `id-finger-print`、`id-finger-print-scan`、`id-iris-scan-alternate`、`id-iris-scan-check`、`id-thumb-mark`、`id-user`、`id-voice-1`、`id-voice-2`。
- registry 搜索验收继续只看 metadata runner 自动同步后的 generated `searchText` 与 `ViewTabs.tsx` 的 query 消费逻辑，不单独补跑 generator。
- 这轮 task 1 的价值在于重新确认：生成的 shared-view registry 可以同时包含 `micro-line` 和 `micro-solid`，但实际推进的 manifest 仍然只有 `micro-solid`。
- 后续执行仍应沿用“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”的可持续策略。

## update 2026-06-24 batch-45

### decision delta

138. `Streamline-micro-solid-tags-pending并行推进批次-45 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。
139. 当 Playwright shim 需要兼容 `tab.playwright.waitForLoadState({ state, timeoutMs })` 的对象签名时，应补齐该兼容层再继续分段 fallback，而不是把它当作站点封锁。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 829 / success 829 / failed 0 / pending 1075`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `humidity-none`、`hurricane`、`hydro-energy`、`ice-cream`、`ice-cream-2`、`ice-cream-3`、`id-face-scan-1`、`id-face-scan-2`。
- MCP 返回 `success 0 / failed 8 / pendingAfter 1067`，说明当前站点/API 低频下仍可访问，但这批样本经 MCP 读取为空，需要浏览器 fallback。
- 首次 Browser fallback 的失败根因是 shim 兼容层错误，而不是站点封锁，报错为 `Error: state: expected one of (load|domcontentloaded|networkidle|commit)`。
- 修正 shim 后，`humidity-none` / `hurricane` / `hydro-energy`、`ice-cream` 系列与 `id-face-scan` 系列都成功回填。
- 最终 manifest 复核为 `total 1904 / withTags 837 / success 837 / failed 0 / pending 1067`，`next head` 推进为 `id-finger-print`、`id-finger-print-scan`、`id-iris-scan-alternate`、`id-iris-scan-check`、`id-thumb-mark`、`id-user`、`id-voice-1`、`id-voice-2`。
- 搜索消费证据继续成立：`cyclone -> streamlineMicroSolidHurricane`、`nomoisture -> streamlineMicroSolidHumidityNone`、`popsicle -> streamlineMicroSolidIceCream / IceCream2`、`biometrics -> streamlineMicroSolidIdFaceScan1`。
- `src/components/ViewTabs.tsx` 的 `resolveSearchIconIds` 继续通过 `sharedViewGeneratedIconSearchText[iconId]?.includes(normalizedQuery)` 消费生成产物，说明搜索消费面和生成产物保持一致。
- 这说明在站点限频条件下，小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 继续是当前可持续方案；shim 需兼容对象签名的 waitForLoadState，且分段 fallback 已经是稳定执行路径。

## batch-44 closeout

- 批次 44 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由系统 Chrome Playwright shim 分段 fallback 精确补洞，目标样本为 `hotel-bed-2`、`hotel-bed-bunk`、`hotel-five-star`、`hotel-four-star`、`hotel-laundry-machine`、`hotel-one-star`、`hotel-three-star`、`hotel-two-star`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 821 / success 821 / failed 8 / pending 1075`；随后按精确 `itemIds` 用 `3 + 3 + 2` 小批次全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 829 / success 829 / failed 0 / pending 1075`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `bedrooms dream relaxation slumber -> hotel-bed-bunk`、`detergent linens towels cycle -> hotel-laundry-machine`、`ranking review grade facility -> hotel-three-star`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”为准；这条分段 fallback 已经成为 `hotel-*` 连续批次上的稳定执行路径。

### task 3 delta

133. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
134. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `hotel-bed-bunk`、`hotel-laundry-machine`、`hotel-three-star` 的 family-aware 语料已进入生成产物。
135. family-aware 搜索命中证据再次成立：`bedrooms dream relaxation slumber -> hotel-bed-bunk`、`detergent linens towels cycle -> hotel-laundry-machine`、`ranking review grade facility -> hotel-three-star`。
136. 继续证明系统 Chrome Playwright shim 分段 fallback 在整段 `hotel-*` 连续批次上依然与自动 registry 同步和真实搜索消费保持一致。
137. 自动 registry 同步闭环在纯 `hotel-*` 连续批次中继续成立，分段 Playwright shim fallback 既适用于 mixed batch，也适用于同家族连续批次。

## update 2026-06-24 batch-44

### decision delta

131. `Streamline-micro-solid-tags-pending并行推进批次-44 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
132. 把 fallback 主动切成 `3 + 3 + 2` 小批次后，吞吐与稳定性比单次长窗口更可控。

### consequence delta

- 本轮样本为 `hotel-bed-2`、`hotel-bed-bunk`、`hotel-five-star`、`hotel-four-star`、`hotel-laundry-machine`、`hotel-one-star`、`hotel-three-star`、`hotel-two-star`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 821 / success 821 / failed 8 / pending 1075`。
- 随后直接使用系统 Chrome Playwright shim 按 `3 + 3 + 2` 小批次执行 fallback，三轮全部成功。
- 最终 manifest 复核为 `total 1904 / withTags 829 / success 829 / failed 0 / pending 1075`。
- 本轮新增标签例如 `hotel-bed-bunk`、`hotel-laundry-machine`、`hotel-three-star` 的 tags 证据已进入稳定语料。
- 这说明在站点限频条件下，小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 继续稳定有效，`hotel-*` 连续样本也验证了当前执行路径在同家族连续批次上同样稳定。

## update 2026-06-24 batch-44

### decision delta

130. `Streamline-micro-solid-tags-pending并行推进批次-44 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 821 / success 821 / failed 0 / pending 1083`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `hotel-bed-2`、`hotel-bed-bunk`、`hotel-five-star`、`hotel-four-star`、`hotel-laundry-machine`、`hotel-one-star`、`hotel-three-star`、`hotel-two-star`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-43 closeout

- 批次 43 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由系统 Chrome Playwright shim 分段 fallback 精确补洞，目标样本为 `horizontal-scroll`、`horizontal-toggle-button-single-left`、`horizontal-toggle-button-single-right`、`hospital-sign-circle`、`hospital-sign-square`、`hot-spring`、`hotel-air-conditioner`、`hotel-bed-1`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 813 / success 813 / failed 8 / pending 1083`；随后按精确 `itemIds` 用 `3 + 3 + 2` 小批次全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 821 / success 821 / failed 0 / pending 1083`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `rhombus geometry diamond negative -> horizontal-scroll`、`facility wayfinding letter public -> hospital-sign-circle`、`mattress pillow comforter floppy -> hotel-bed-1`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”为准；这条分段 fallback 已经成为稳定执行路径。

### task 3 delta

125. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
126. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `horizontal-scroll`、`hospital-sign-circle`、`hotel-bed-1` 的 family-aware 语料已进入生成产物。
127. family-aware 搜索命中证据再次成立：`rhombus geometry diamond negative -> horizontal-scroll`、`facility wayfinding letter public -> hospital-sign-circle`、`mattress pillow comforter floppy -> hotel-bed-1`。
128. 继续证明系统 Chrome Playwright shim 分段 fallback 跑完后，自动 registry 同步与真实搜索消费保持一致。
129. 自动 registry 同步闭环在 `scroll / hospital / hotel` mixed batch 中继续成立，分段 Playwright shim fallback 仍然是当前最稳定的执行路径。

## update 2026-06-24 batch-43

### decision delta

123. `Streamline-micro-solid-tags-pending并行推进批次-43 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
124. 把 fallback 主动切成 `3 + 3 + 2` 小批次后，吞吐与稳定性比单次长窗口更可控。

### consequence delta

- 本轮样本为 `horizontal-scroll`、`horizontal-toggle-button-single-left`、`horizontal-toggle-button-single-right`、`hospital-sign-circle`、`hospital-sign-square`、`hot-spring`、`hotel-air-conditioner`、`hotel-bed-1`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 813 / success 813 / failed 8 / pending 1083`。
- 随后直接使用系统 Chrome Playwright shim 按 `3 + 3 + 2` 小批次执行 fallback，三轮全部成功。
- 最终 manifest 复核为 `total 1904 / withTags 821 / success 821 / failed 0 / pending 1083`。
- 本轮新增标签例如 `horizontal-scroll`、`hospital-sign-circle`、`hotel-bed-1` 的 tags 证据已进入稳定语料。
- 这说明在站点限频条件下，小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 继续稳定有效，跨 `scroll / hospital / hotel` 混合语义簇后，稳定性与 throughput 都维持住了。

## update 2026-06-24 batch-43

### decision delta

122. `Streamline-micro-solid-tags-pending并行推进批次-43 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 813 / success 813 / failed 0 / pending 1091`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `horizontal-scroll`、`horizontal-toggle-button-single-left`、`horizontal-toggle-button-single-right`、`hospital-sign-circle`、`hospital-sign-square`、`hot-spring`、`hotel-air-conditioner`、`hotel-bed-1`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-42 closeout

- 批次 42 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由系统 Chrome Playwright shim 分段 fallback 精确补洞，目标样本为 `highlighter`、`home-1`、`home-2`、`home-3`、`home-door`、`horizonal-scroll`、`horizontal-menu-circle-navigation`、`horizontal-menu-square`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 805 / success 805 / failed 8 / pending 1091`；随后按精确 `itemIds` 用 `3 + 3 + 2` 小批次全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 813 / success 813 / failed 0 / pending 1091`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `fluorescent underline sketch stationery -> highlighter`、`doorknob keyhole threshold hinge -> home-door`、`ellipsis settings layout configuration -> horizontal-menu-square`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”为准；这条分段 fallback 已经不只是恢复手段，而是稳定执行路径。

### task 3 delta

117. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
118. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `highlighter`、`home-door`、`horizontal-menu-square` 的 family-aware 语料已进入生成产物。
119. family-aware 搜索命中证据再次成立：`fluorescent underline sketch stationery -> highlighter`、`doorknob keyhole threshold hinge -> home-door`、`ellipsis settings layout configuration -> horizontal-menu-square`。
120. 继续证明系统 Chrome Playwright shim 分段 fallback 跑完后，自动 registry 同步与真实搜索消费保持一致。
121. 自动 registry 同步闭环在 `stationery / home / menu` mixed batch 中继续成立，分段 Playwright shim fallback 已经从恢复路径变成稳定执行路径。

## update 2026-06-24 batch-42

### decision delta

115. `Streamline-micro-solid-tags-pending并行推进批次-42 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做分段 Playwright shim fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
116. 把 fallback 主动切成 `3 + 3 + 2` 小批次后，吞吐与稳定性比单次长窗口更可控。

### consequence delta

- 本轮样本为 `highlighter`、`home-1`、`home-2`、`home-3`、`home-door`、`horizonal-scroll`、`horizontal-menu-circle-navigation`、`horizontal-menu-square`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 805 / success 805 / failed 8 / pending 1091`。
- 随后直接使用系统 Chrome Playwright shim 按 `3 + 3 + 2` 小批次执行 fallback，三轮全部成功。
- 最终 manifest 复核为 `total 1904 / withTags 813 / success 813 / failed 0 / pending 1091`。
- 本轮新增标签例如 `highlighter`、`home-door`、`horizontal-menu-square` 的 tags 证据已进入稳定语料。
- 这说明在站点限频条件下，小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 继续稳定有效。

## update 2026-06-24 batch-42

### decision delta

114. `Streamline-micro-solid-tags-pending并行推进批次-42 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 805 / success 805 / failed 0 / pending 1099`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `highlighter`、`home-1`、`home-2`、`home-3`、`home-door`、`horizonal-scroll`、`horizontal-menu-circle-navigation`、`horizontal-menu-square`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-41 closeout

- 批次 41 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由浏览器 fallback 精确补洞，目标样本为 `hierachy-organise-7`、`hierachy-organise-8`、`hierachy-organise-9`、`hierarchy-line-1`、`hierarchy-line-2`、`hierarchy-line-3`、`hierarchy-line-4`、`high-speed-train-side`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 797 / success 797 / failed 8 / pending 1099`；随后按精确 `itemIds` 在低频真人化节奏下全部吃回 success。
- 首次 Browser 插件 fallback 因 `300s` tool timeout 只成功落盘 2 项；Browser 句柄随后丢失，改用系统 Chrome + Playwright shim 把剩余 6 项拆成两个 3 项小批次补跑并全部成功。
- 最终权威 manifest 复核为 `total 1904 / withTags 805 / success 805 / failed 0 / pending 1099`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `branch network connection system 1 -> hierarchy-line-1`、`tree diagram organize divide 4 -> hierarchy-line-4`、`railway locomotive platform sleeper -> high-speed-train-side`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 仅对判空样本做低频真人化 browser fallback”为准；当 Browser 插件句柄丢失或单次 fallback 被 `300s` 工具上限截断时，系统 Chrome + Playwright shim 可以作为恢复路径，且不会破坏自动 registry 同步和搜索消费验收。

### task 3 delta

109. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
110. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `hierarchy-line-1`、`hierarchy-line-4`、`high-speed-train-side` 的 family-aware 语料已进入生成产物。
111. family-aware 搜索命中证据再次成立：`branch network connection system 1 -> hierarchy-line-1`、`tree diagram organize divide 4 -> hierarchy-line-4`、`railway locomotive platform sleeper -> high-speed-train-side`。
112. 额外证明了当 Browser 插件句柄丢失后，切到系统 Chrome + Playwright shim 继续跑同一 metadata runner，生成产物和搜索消费依然一致。
113. 自动 registry 同步闭环在 `hierarchy-line / train` mixed batch 中继续成立，Browser 插件句柄不是这条验收链路的单点依赖。

## update 2026-06-24 batch-41

### decision delta

107. `Streamline-micro-solid-tags-pending并行推进批次-41 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
108. 当 Browser 插件句柄丢失或单次 fallback 被 `300s` tool 上限截断时，后续可以把剩余 failed 项缩成更小批次，并改用系统 Chrome + Playwright shim 继续复用同一套 metadata runner。

### consequence delta

- 本轮样本为 `hierachy-organise-7`、`hierachy-organise-8`、`hierachy-organise-9`、`hierarchy-line-1`、`hierarchy-line-2`、`hierarchy-line-3`、`hierarchy-line-4`、`high-speed-train-side`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 797 / success 797 / failed 8 / pending 1099`。
- 首次 Browser 插件 fallback 因 `300s` tool timeout 只成功落盘 2 项；Browser 句柄随后丢失，无法继续复用原会话。
- 随后改用系统 Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe` + Playwright shim 作为 browser 适配层，把剩余 6 项拆成两个 3 项小批次补跑，全部成功。
- 最终 manifest 复核为 `total 1904 / withTags 805 / success 805 / failed 0 / pending 1099`。
- 这说明并行执行链路、自动 registry 同步和低频真人化访问并不强依赖单一 Browser 插件句柄；当 fallback 被工具层截断时，缩小批次并切换系统 Chrome 仍可继续吃回 failed。

## update 2026-06-24 batch-41

### decision delta

106. `Streamline-micro-solid-tags-pending并行推进批次-41 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 797 / success 797 / failed 0 / pending 1107`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `hierachy-organise-7`、`hierachy-organise-8`、`hierachy-organise-9`、`hierarchy-line-1`、`hierarchy-line-2`、`hierarchy-line-3`、`hierarchy-line-4`、`high-speed-train-side`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 低频真人化 browser fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-40 closeout

- 批次 40 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由浏览器 fallback 精确补洞，目标样本为 `hierachy-organise-10`、`hierachy-organise-11`、`hierachy-organise-12`、`hierachy-organise-2`、`hierachy-organise-3`、`hierachy-organise-4`、`hierachy-organise-5`、`hierachy-organise-6`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 789 / success 789 / failed 8 / pending 1107`；随后按精确 `itemIds` 在低频真人化节奏下全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 797 / success 797 / failed 0 / pending 1107`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `scheme network links workflow -> hierachy-organise-10`、`branching leadership authority mapping -> hierachy-organise-11`、`connected steps nodes links -> hierachy-organise-6`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 仅对判空样本做低频真人化 browser fallback”为准，验收继续只看 manifest 前进与运行时消费命中，不需要人工补跑 `npm run streamline:generate-registry`。

### task 3 delta

102. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
103. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `hierachy-organise-10`、`hierachy-organise-11`、`hierachy-organise-6` 的 family-aware 语料已进入生成产物。
104. family-aware 搜索命中证据再次成立：`scheme network links workflow -> hierachy-organise-10`、`branching leadership authority mapping -> hierachy-organise-11`、`connected steps nodes links -> hierachy-organise-6`。
105. 自动 registry 同步闭环在纯 `hierachy-organise` 连续批次中继续成立，搜索消费验收可以直接依赖 generated shared-view 产物，不需要再补一个手工 generator 步骤。

## update 2026-06-24 batch-40

### decision delta

100. `Streamline-micro-solid-tags-pending并行推进批次-40 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
101. 在这条节奏下，吞吐下降是可接受代价，关键验收标准保持不变：`failed` 必须稳定回到 `0`，且 `pending` 继续下降。

### consequence delta

- 本轮样本为 `hierachy-organise-10`、`hierachy-organise-11`、`hierachy-organise-12`、`hierachy-organise-2`、`hierachy-organise-3`、`hierachy-organise-4`、`hierachy-organise-5`、`hierachy-organise-6`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 789 / success 789 / failed 8 / pending 1107`。
- 随后只对这 8 个精确样本执行低频真人化浏览器 fallback，参数节奏为 `humanMode=true`、`preNavigationDelayMs 4000`、`preNavigationJitterMs 2500`、`postItemDelayMs 5000`、`postItemJitterMs 3500`。
- 浏览器 fallback 最终 `8/8` 成功，回填标签例如 `hierachy-organise-10`、`hierachy-organise-11`、`hierachy-organise-6` 的 tags 证据已进入稳定语料。
- 最终 manifest 复核为 `total 1904 / withTags 797 / success 797 / failed 0 / pending 1107`。
- 这说明在站点限频条件下，小规模 MCP 试探 + 仅对判空样本做低频真人化 fallback 继续稳定有效，纯 `hierachy-organise` 连续语义簇也没有破坏自动同步闭环。

## update 2026-06-24 batch-40

### decision delta

99. `Streamline-micro-solid-tags-pending并行推进批次-40 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 789 / success 789 / failed 0 / pending 1115`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `hierachy-organise-10`、`hierachy-organise-11`、`hierachy-organise-12`、`hierachy-organise-2`、`hierachy-organise-3`、`hierachy-organise-4`、`hierachy-organise-5`、`hierachy-organise-6`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 低频真人化 browser fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-39 closeout

- 批次 39 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由浏览器 fallback 精确补洞，目标样本为 `help-question-circle`、`help-question-message`、`help-question-square`、`help-shield-privacy-question`、`help-support-lifebuoy`、`hexagram`、`hide-object`、`hierachy-organise-1`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 781 / success 781 / failed 8 / pending 1115`；随后按精确 `itemIds` 在低频真人化节奏下全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 789 / success 789 / failed 0 / pending 1115`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `support query mystery information -> help-question-circle`、`judaism sacred triangle geometric -> hexagram`、`structure flowchart connections organization -> hierachy-organise-1`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 仅对判空样本做低频真人化 browser fallback”为准，验收继续只看 manifest 前进与运行时消费命中，不需要人工补跑 `npm run streamline:generate-registry`。

### task 3 delta

95. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
96. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `help-question-circle`、`hexagram`、`hierachy-organise-1` 的 family-aware 语料已进入生成产物。
97. family-aware 搜索命中证据再次成立：`support query mystery information -> help-question-circle`、`judaism sacred triangle geometric -> hexagram`、`structure flowchart connections organization -> hierachy-organise-1`。
98. 自动 registry 同步闭环在 `help / symbol / hierarchy` mixed batch 中继续成立，搜索消费验收可以直接依赖 generated shared-view 产物，不需要再补一个手工 generator 步骤。

## update 2026-06-24 batch-39

### decision delta

93. `Streamline-micro-solid-tags-pending并行推进批次-39 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
94. 在这条节奏下，吞吐下降是可接受代价，关键验收标准保持不变：`failed` 必须稳定回到 `0`，且 `pending` 继续下降。

### consequence delta

- 本轮样本为 `help-question-circle`、`help-question-message`、`help-question-square`、`help-shield-privacy-question`、`help-support-lifebuoy`、`hexagram`、`hide-object`、`hierachy-organise-1`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 781 / success 781 / failed 8 / pending 1115`。
- 随后只对这 8 个精确样本执行低频真人化浏览器 fallback，参数节奏为 `humanMode=true`、`preNavigationDelayMs 4000`、`preNavigationJitterMs 2500`、`postItemDelayMs 5000`、`postItemJitterMs 3500`。
- 浏览器 fallback 最终 `8/8` 成功，回填标签例如 `help-question-circle`、`hexagram`、`hierachy-organise-1` 的 tags 证据已进入稳定语料。
- 最终 manifest 复核为 `total 1904 / withTags 789 / success 789 / failed 0 / pending 1115`。
- 这说明在站点限频条件下，小规模 MCP 试探 + 仅对判空样本做低频真人化 fallback 继续稳定有效，跨 `help / symbol / hierarchy` 混合语义簇后，`failed` 仍然能回到 `0`。

## update 2026-06-24 batch-39

### decision delta

92. `Streamline-micro-solid-tags-pending并行推进批次-39 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 781 / success 781 / failed 0 / pending 1123`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `help-question-circle`、`help-question-message`、`help-question-square`、`help-shield-privacy-question`、`help-support-lifebuoy`、`hexagram`、`hide-object`、`hierachy-organise-1`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 低频真人化 browser fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-38 closeout

- 批次 38 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由浏览器 fallback 精确补洞，目标样本为 `heart-rate-clipboard`、`heart-rate-monitor`、`heart-rate-search`、`heart-square`、`hearts-symbol`、`heat-off`、`heater`、`help-chat`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 773 / success 773 / failed 8 / pending 1123`；随后按精确 `itemIds` 在低频真人化节奏下全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 781 / success 781 / failed 0 / pending 1123`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `clipboard tracking diagnosis cardio -> heart-rate-clipboard`、`statistics visualization desktop report -> heart-rate-monitor`、`help chat help-chat -> help-chat`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 仅对判空样本做低频真人化 browser fallback”为准，验收继续只看 manifest 前进与运行时消费命中，不需要人工补跑 `npm run streamline:generate-registry`。

### task 3 delta

88. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
89. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `heart-rate-clipboard`、`heart-rate-monitor`、`help-chat` 的 family-aware 语料已进入生成产物。
90. family-aware 搜索命中证据再次成立：`clipboard tracking diagnosis cardio -> heart-rate-clipboard`、`statistics visualization desktop report -> heart-rate-monitor`、`help chat help-chat -> help-chat`。
91. 自动 registry 同步闭环在 `heart rate / heat / help` mixed batch 中继续成立，搜索消费验收可以直接依赖 generated shared-view 产物，不需要再补一个手工 generator 步骤。

## update 2026-06-24 batch-38

### decision delta

86. `Streamline-micro-solid-tags-pending并行推进批次-38 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
87. 在这条节奏下，吞吐下降是可接受代价，关键验收标准保持不变：`failed` 必须稳定回到 `0`，且 `pending` 继续下降。

### consequence delta

- 本轮样本为 `heart-rate-clipboard`、`heart-rate-monitor`、`heart-rate-search`、`heart-square`、`hearts-symbol`、`heat-off`、`heater`、`help-chat`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 773 / success 773 / failed 8 / pending 1123`。
- 随后只对这 8 个精确样本执行低频真人化浏览器 fallback，参数节奏为 `humanMode=true`、`preNavigationDelayMs 4000`、`preNavigationJitterMs 2500`、`postItemDelayMs 5000`、`postItemJitterMs 3500`。
- 浏览器 fallback 最终 `8/8` 成功，回填标签例如 `heart-rate-clipboard`、`heart-rate-monitor`、`help-chat` 的 tags 证据已进入稳定语料。
- 最终 manifest 复核为 `total 1904 / withTags 781 / success 781 / failed 0 / pending 1123`。
- 这说明在站点限频条件下，小规模 MCP 试探 + 仅对判空样本做低频真人化 fallback 继续稳定有效，跨 `heart rate / heat / help` 混合语义簇后，`failed` 仍然能回到 `0`。

## update 2026-06-24 batch-38

### decision delta

85. `Streamline-micro-solid-tags-pending并行推进批次-38 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 773 / success 773 / failed 0 / pending 1131`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `heart-rate-clipboard`、`heart-rate-monitor`、`heart-rate-search`、`heart-square`、`hearts-symbol`、`heat-off`、`heater`、`help-chat`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 低频真人化 browser fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-37 closeout

- 批次 37 的完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由浏览器 fallback 精确补洞，目标样本为 `headphone-customer-support-3`、`headphone-customer-support-4`、`health-care-2`、`hearing-deaf`、`heart-check`、`heart-circle`、`heart-cross`、`heart-rate`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 765 / success 765 / failed 8 / pending 1131`；随后按精确 `itemIds` 在低频真人化节奏下全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 773 / success 773 / failed 0 / pending 1131`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `consultation troubleshooting guidance headset -> headphone-customer-support-4`、`signlanguage lipreading audiology noaudio -> hearing-deaf`、`heartbeat pulse monitor lifeline -> heart-rate`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 仅对判空样本做低频真人化 browser fallback”为准，验收继续只看 manifest 前进与运行时消费命中，不需要人工补跑 `npm run streamline:generate-registry`。

### task 3 delta

81. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
82. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `headphone-customer-support-4`、`hearing-deaf`、`heart-rate` 的 family-aware 语料已进入生成产物。
83. family-aware 搜索命中证据再次成立：`consultation troubleshooting guidance headset -> headphone-customer-support-4`、`signlanguage lipreading audiology noaudio -> hearing-deaf`、`heartbeat pulse monitor lifeline -> heart-rate`。
84. 自动 registry 同步闭环在 `support / hearing / heart` mixed batch 中继续成立，搜索消费验收可以直接依赖 generated shared-view 产物，不需要再补一个手工 generator 步骤。

## update 2026-06-24 batch-37

### decision delta

79. `Streamline-micro-solid-tags-pending并行推进批次-37 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
80. 在这条节奏下，吞吐下降是可接受代价，关键验收标准保持不变：`failed` 必须稳定回到 `0`，且 `pending` 继续下降。

### consequence delta

- 本轮样本为 `headphone-customer-support-3`、`headphone-customer-support-4`、`health-care-2`、`hearing-deaf`、`heart-check`、`heart-circle`、`heart-cross`、`heart-rate`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 765 / success 765 / failed 8 / pending 1131`。
- 随后只对这 8 个精确样本执行低频真人化浏览器 fallback，参数节奏为 `humanMode=true`、`preNavigationDelayMs 4000`、`preNavigationJitterMs 2500`、`postItemDelayMs 5000`、`postItemJitterMs 3500`。
- 浏览器 fallback 最终 `8/8` 成功，回填标签例如 `headphone-customer-support-4`、`hearing-deaf`、`heart-rate` 的 tags 证据已进入稳定语料。
- 最终 manifest 复核为 `total 1904 / withTags 773 / success 773 / failed 0 / pending 1131`。
- 这说明在站点限频条件下，小规模 MCP 试探 + 仅对判空样本做低频真人化 fallback 继续稳定有效，跨 `support / hearing / heart` 混合语义簇后，`failed` 仍然能回到 `0`。

## update 2026-06-24 batch-37

### decision delta

78. `Streamline-micro-solid-tags-pending并行推进批次-37 / task 1` 的执行策略继续收敛为：小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这仍然是本轮可持续推进 pending 的正式节奏。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 765 / success 765 / failed 0 / pending 1139`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `headphone-customer-support-3`、`headphone-customer-support-4`、`health-care-2`、`hearing-deaf`、`heart-check`、`heart-circle`、`heart-cross`、`heart-rate`。
- 这轮目标仍然是在站点限频条件下继续推进 pending，同时保持 `failed` 回到 `0` 并持续验证自动 registry 同步闭环。
- 小规模 MCP 试探 + 低频真人化 browser fallback 仍然是当前默认执行策略，不回到高吞吐窗口。

## batch-36 closeout

- 批次 36 的完成证明继续沿用同一条默认闭环：先小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback，目标样本为 `hashtag-sign`、`hashtag-tag-channel-phone-number`、`heading-styles-1`、`heading-styles-2`、`heading-styles-3`、`heading-styles-4`、`heading-styles-5`、`heading-styles-6`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 757 / success 757 / failed 8 / pending 1139`；随后按精确 `itemIds` 在低频真人化节奏下全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 765 / success 765 / failed 0 / pending 1139`，说明在站点限频条件下，这条节奏仍然可持续，且 `failed` 能稳定回到 `0`。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `hashtag tag trend network -> hashtag-sign`、`hydrogen periodic science h2 -> heading-styles-2`、`html css typography header -> heading-styles-5`。
- 生成 shared-view 产物里的 micro-solid `searchText` 已直接包含新增 tags，说明搜索消费面已自动更新。
- 后续 pending 推进仍然以“小规模 MCP 试探 + 仅对判空样本做低频真人化 browser fallback”为准，验收继续只看 manifest 前进与运行时消费命中，不需要人工补跑 `npm run streamline:generate-registry`。

### task 3 delta

74. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
75. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `hashtag-sign`、`heading-styles-2`、`heading-styles-5` 的 family-aware 语料已进入生成产物。
76. family-aware 搜索命中证据再次成立：`hashtag tag trend network -> hashtag-sign`、`hydrogen periodic science h2 -> heading-styles-2`、`html css typography header -> heading-styles-5`。
77. 自动 registry 同步闭环在 `hashtag / heading styles` mixed batch 中继续成立，搜索消费验收可以直接依赖 generated shared-view 产物，不需要再补一个手工 generator 步骤。

## update 2026-06-24 batch-36

### decision delta

72. `Streamline-micro-solid-tags-pending并行推进批次-36 / task 2` 继续沿当前默认两段式 pending 推进：先用小规模 MCP 试探，再仅对判空样本做低频真人化浏览器 fallback；在站点限频条件下，这条节奏仍然是当前可持续推进方案。
73. 在这条节奏下，`throughput` 下降是可接受代价，关键验收标准保持不变：`failed` 必须稳定回到 `0`，且 `pending` 继续下降。

### consequence delta

- 本轮样本为 `hashtag-sign`、`hashtag-tag-channel-phone-number`、`heading-styles-1`、`heading-styles-2`、`heading-styles-3`、`heading-styles-4`、`heading-styles-5`、`heading-styles-6`。
- MCP 试探结果仍是 `8/8` 被判空 tags，manifest 临时变为 `withTags 757 / success 757 / failed 8 / pending 1139`。
- 随后只对这 8 个精确样本执行低频真人化浏览器 fallback，参数节奏为 `humanMode=true`、`preNavigationDelayMs 4000`、`preNavigationJitterMs 2500`、`postItemDelayMs 5000`、`postItemJitterMs 3500`。
- 浏览器 fallback 最终 `8/8` 成功，回填标签例如 `hashtag-sign`、`heading-styles-2`、`heading-styles-5` 的 tags 证据已进入稳定语料。
- 最终 manifest 复核为 `total 1904 / withTags 765 / success 765 / failed 0 / pending 1139`。
- 这说明在站点限频条件下，小规模 MCP 试探 + 仅对判空样本做低频真人化 fallback 仍然可持续，且 `failed` 能稳定回到 `0`。

## update 2026-06-24 batch-36

### decision delta

71. `Streamline-micro-solid-tags-pending并行推进批次-36 / task 1` 的默认执行策略继续收敛为：小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；当前目标不是追求吞吐量，而是在站点限频条件下验证 pending 推进仍可持续，并保持 `failed = 0`。

### consequence delta

- 当前 micro-solid manifest 基线为 `total 1904 / withTags 757 / success 757 / failed 0 / pending 1147`，继续作为本轮唯一真相源。
- 本轮连续 pending 样本为 `hashtag-sign`、`hashtag-tag-channel-phone-number`、`heading-styles-1`、`heading-styles-2`、`heading-styles-3`、`heading-styles-4`、`heading-styles-5`、`heading-styles-6`。
- 这轮的执行边界已经明确收敛为“小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback”，而不是追求更高吞吐。
- 目标重点是验证在站点限频条件下，`pending` 仍然可以持续推进，并把 `failed` 保持为 `0`。

## batch-35 closeout

- 批次 35 的完成证明继续沿用同一条默认闭环：`MCP` 首跳批量判空后，由浏览器 fallback 精确补洞，目标样本为 `hand-held-tablet-writing`、`hang-up-1`、`hang-up-2`、`hanger`、`happy-face-smiley-1`、`happy-face-smiley-2`、`hard-drive-download`、`hard-drive-upload`。
- 这轮先把 8 项全部判成新的 `Official MCP metadata returned no tags` failed，使 manifest 临时变为 `withTags 749 / success 749 / failed 8 / pending 1147`；随后按精确 `itemIds + retryFailed: true` 走浏览器 fallback，在低频真人化节奏下全部吃回 success。
- 最终权威 manifest 复核为 `total 1904 / withTags 757 / success 757 / failed 0 / pending 1147`，说明 pending 继续稳定压降且没有引入新的 failed。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 运行时搜索消费证据继续命中 `notepad + journal + compose -> hand-held-tablet-writing`、`cheerful + joy + message -> happy-face-smiley-1`、`backup + iconography + disk -> hard-drive-upload`。
- 生成产物层面也已确认 `micro-solid searchText` 已含 `hand-held-tablet-writing`、`happy-face-smiley-1`、`hard-drive-upload` 对应的 family-aware 语料，说明搜索消费验收不依赖单一语义簇。
- 后续 pending 推进仍然以“小规模 MCP 并行窗口 + 必要时 browser fallback”的节奏为准，验收继续只看 manifest 前进与运行时消费命中，不需要人工补跑 `npm run streamline:generate-registry`。

### task 3 delta

68. 本轮没有人工单独执行 `npm run streamline:generate-registry`，registry 更新仍完全依赖 metadata runner 的自动同步。
69. 动态导入 `src/generated/streamline-shared-view-icons.mjs` 的 `streamlineSharedViewIcons` 后，运行时消费面再次命中：`notepad + journal + compose -> hand-held-tablet-writing`、`cheerful + joy + message -> happy-face-smiley-1`、`backup + iconography + disk -> hard-drive-upload`。
70. 这说明自动 registry 同步闭环在 `tablet / smiley / hard-drive` 这一组 mixed batch 里继续成立，搜索消费正确性仍然没有被破坏。

## update 2026-06-24 batch-35

### decision delta

66. `Streamline-micro-solid-tags-pending并行推进批次-35 / task 2` 继续沿当前默认两段式 pending 推进：先用 MCP 首跳批量判空，再由 browser fallback 精确补洞；对 `hand-held-tablet-writing`、`hang-up-1`、`hang-up-2`、`hanger`、`happy-face-smiley-1`、`happy-face-smiley-2`、`hard-drive-download`、`hard-drive-upload` 这一组样本，MCP 判空应视为筛选补洞清单，而不是最终失败结论。
67. 当 metadata runner 在浏览器 fallback 完成后自动重生 shared-view registry 时，后续验收继续以生成产物与真实消费面命中为准，不需要再人工额外执行 `npm run streamline:generate-registry`。

### consequence delta

- 本轮 MCP 主跑结果为 `success 0 / failed 8`，八个样本都被暂时判成 `Official MCP metadata returned no tags`；权威 manifest 从 `withTags 749 / success 749 / failed 0 / pending 1155` 变为 `withTags 749 / success 749 / failed 8 / pending 1147`。
- 随后同一组 `itemIds` 走浏览器 fallback，并沿用 low-frequency human-mode 参数后，八项全部被真实吃回为 success。
- 最终权威 manifest 更新为 `total 1904 / withTags 757 / success 757 / failed 0 / pending 1147 / pollutedCount 0`，说明这组 pending 已完成真实落盘。
- `hand-held-tablet-writing`、`happy-face-smiley-1`、`hard-drive-upload` 的 tags 证据分别进入稳定语料，例如 `tablet, hand, held, writing, device, edit, note, pen, notepad, journal...`、`smiley, happy, face, smile, cheerful, joy, emoji, expression, emotion, circle...`、`upload, drive, hard, storage, backup, data, save, iconography, external, disk`。
- `src/generated/streamline-shared-view-icons.mjs` 已自动承载新增 family-aware `searchText`，且运行时消费面继续能通过动态导入命中对应 query。
- 这轮再次确认，metadata runner 完成闭环后 registry 自动同步仍然是正式行为；后续 pending 推进的验收继续只需核对 manifest 前进与运行时消费命中，不应再把人工补跑 registry generator 当成必需步骤。

## batch-34 closeout

- 批次 34 的完成证明继续沿用同一条默认闭环：`MCP` 首跳批量判空后，由浏览器 fallback 精确补洞，目标样本为 `half-star`、`half-star-2`、`hamburger-menu-circle`、`hamburger-menu-square`、`hammer`、`hand-bag`、`hand-grab`、`hand-held`。
- 这轮最终把权威 manifest 从 `withTags 741 / success 741 / failed 0 / pending 1163` 推进到 `withTags 749 / success 749 / failed 0 / pending 1155 / pollutedCount 0`，说明 pending 继续稳定压降且没有引入新的 failed。
- 自动 registry 同步闭环在 `half / hamburger / hand` mixed batch 里继续成立，说明这条验收链路仍然不依赖单一语义簇。
- 运行时消费面命中 `geometry + social + like -> half-star`、`navicon + sidebar + overlay -> hamburger-menu-circle`、`smartphone + powerdown + control -> hand-held`，继续证明搜索消费正确性没有被破坏。
- 后续 pending 推进的正式验收继续只需要核对 manifest 前进与运行时消费命中，不应再把人工补跑 `npm run streamline:generate-registry` 当成必需步骤。

### task 3 delta

66. 本轮没有人工单独执行 `npm run streamline:generate-registry`，registry 更新仍完全依赖 metadata runner 的自动同步。
67. 动态导入 `src/generated/streamline-shared-view-icons.mjs` 的 `streamlineSharedViewIcons` 后，运行时消费面再次命中：`geometry + social + like -> half-star`、`navicon + sidebar + overlay -> hamburger-menu-circle`、`smartphone + powerdown + control -> hand-held`。
68. 这说明自动 registry 同步闭环在 `half / hamburger / hand` 这一组 mixed batch 里继续成立，搜索消费正确性仍然没有被破坏。

## update 2026-06-24 batch-34

### decision delta

64. `Streamline-micro-solid-tags-pending并行推进批次-34 / task 2` 继续沿当前默认两段式 pending 推进：先用 MCP 首跳批量判空，再由 browser fallback 精确补洞；对 `half-star`、`half-star-2`、`hamburger-menu-circle`、`hamburger-menu-square`、`hammer`、`hand-bag`、`hand-grab`、`hand-held` 这一组样本，MCP 判空应视为筛选补洞清单，而不是最终失败结论。
65. 当 metadata runner 在浏览器 fallback 完成后自动重生 shared-view registry 时，后续验收继续以生成产物与真实消费面命中为准，不需要再人工额外执行 `npm run streamline:generate-registry`。

### consequence delta

- 本轮 MCP 主跑结果为 `success 0 / failed 8`，八个样本都被暂时判成 `Official MCP metadata returned no tags`；权威 manifest 从 `withTags 741 / success 741 / failed 0 / pending 1163` 变为 `withTags 741 / success 741 / failed 8 / pending 1155`。
- 随后同一组 `itemIds` 走浏览器 fallback，并沿用 low-frequency human-mode 参数后，八项全部被真实吃回为 success。
- 最终权威 manifest 更新为 `total 1904 / withTags 749 / success 749 / failed 0 / pending 1155 / pollutedCount 0`，说明这组 pending 已完成真实落盘。
- `half-star`、`hamburger-menu-circle`、`hand-held` 的 tags 证据分别进入稳定语料，例如 `half, star, rating, outline, abstract, symbol, shape, design, drawing, lineart...`、`hamburger, menu, circle, navicon, sidebar, navigation, button, dropdown, interface, overlay...`、`hand, held, device, mobile, smartphone, phone, power, button, switch, on...`。
- `src/generated/streamline-shared-view-icons.mjs` 已自动承载新增 family-aware `searchText`，且运行时消费面继续能通过动态导入命中对应 query。
- 这轮再次确认，metadata runner 完成闭环后 registry 自动同步仍然是正式行为；后续 pending 推进的验收继续只需核对 manifest 前进与运行时消费命中，不应再把人工补跑 registry generator 当成必需步骤。

## batch-33 closeout

- 批次 33 的完成证明继续沿用同一条默认闭环：`MCP` 首跳批量判空后，由浏览器 fallback 精确补洞，目标样本为 `graph-decrease`、`graph-dot`、`graph-increase`、`graph-pie-chart`、`greater-than-sign`、`grid`、`grid-off`、`half-heart`。
- 这轮最终把权威 manifest 从 `withTags 733 / success 733 / failed 0 / pending 1171` 推进到 `withTags 741 / success 741 / failed 0 / pending 1163 / pollutedCount 0`，说明 pending 继续稳定压降且没有引入新的 failed。
- 自动 registry 同步闭环在 mixed `graph / grid / heart` 样本里继续成立，说明它不依赖单一语义簇。
- 运行时消费面命中 `percentage + segment + slice -> graph-pie-chart`、`deactivate + customize + squares -> grid-off`、`heartache + romance + favorite -> half-heart`，继续证明搜索消费正确性没有被破坏。
- 后续 pending 推进的正式验收继续只需要核对 manifest 前进与运行时消费命中，不应再把人工补跑 `npm run streamline:generate-registry` 当成必需步骤。

### task 3 delta

64. 本轮没有人工单独执行 `npm run streamline:generate-registry`，registry 更新仍完全依赖 metadata runner 的自动同步。
65. 动态导入 `src/generated/streamline-shared-view-icons.mjs` 的 `streamlineSharedViewIcons` 后，运行时消费面再次命中：`percentage + segment + slice -> graph-pie-chart`、`deactivate + customize + squares -> grid-off`、`heartache + romance + favorite -> half-heart`。
66. 这说明自动 registry 同步闭环已经从 `graph-*` 延伸到 `grid` / `heart` 这一组 mixed batch，继续保持成立，没有破坏搜索消费正确性。

### task 3 delta

58. 本轮没有人工单独执行 `npm run streamline:generate-registry`，registry 更新仍完全依赖 metadata runner 的自动同步。
59. 动态导入 `src/generated/streamline-shared-view-icons.mjs` 的 `streamlineSharedViewIcons` 后，运行时消费面再次命中：`recession + decline + economy -> graph-arrow-decrease`、`ranking + segments + business -> graph-bar-horizontal`、`visualization + infographic + product + arrow -> graph-bar-increase-square`。
60. 本轮再次确认，同 family 内部也会存在语义邻近项，例如 `graph-bar-increase-square` 与 `browser-graph` 会在宽泛 query 上发生歧义，因此验收必须继续坚持条目级、family-aware query，而不是只看粗粒度关键词存在。
61. 这说明自动 registry 同步闭环在进入 `graph-*` 这一整个语义段后仍然成立，同时也进一步强化了“query 需要收窄到条目级证据”的长期验收规则。

## batch-32 closeout

- 批次 32 的完成证明继续沿用同一条默认闭环：`MCP` 首跳批量判空后，由浏览器 fallback 精确补洞，目标样本为 `graph-arrow-decrease`、`graph-arrow-increase`、`graph-bar`、`graph-bar-decrease`、`graph-bar-decrease-square`、`graph-bar-horizontal`、`graph-bar-increase`、`graph-bar-increase-square`。
- 这轮最终把权威 manifest 从 `withTags 725 / success 725 / failed 0 / pending 1179` 推进到 `withTags 733 / success 733 / failed 0 / pending 1171 / pollutedCount 0`，说明 pending 继续稳定压降且没有引入新的 failed。
- 自动 registry 同步闭环在 `graph-*` 语义段依旧成立，说明它不仅跨批次可复用，也跨连续语义簇可复用。
- 新增的长期规则是：同 family 内部的近义项会让宽泛 query 误命中，例如 `graph-bar-increase-square` 与 `browser-graph`；因此搜索消费验收必须坚持 family-aware、条目级 query，而不是只看粗粒度关键词存在。
- 后续 pending 推进的正式验收继续只需要核对 manifest 前进与运行时消费命中，不应再把人工补跑 `npm run streamline:generate-registry` 当成必需步骤。

## update 2026-06-24 batch-33

### decision delta

62. `Streamline-micro-solid-tags-pending并行推进批次-33 / task 2` 继续沿当前默认两段式 pending 推进：先用 MCP 首跳批量判空，再由 browser fallback 精确补洞；对 `graph-decrease`、`graph-dot`、`graph-increase`、`graph-pie-chart`、`greater-than-sign`、`grid`、`grid-off`、`half-heart` 这一组样本，MCP 判空应视为筛选补洞清单，而不是最终失败结论。
63. 当 metadata runner 在浏览器 fallback 完成后自动重生 shared-view registry 时，后续验收继续以生成产物与真实消费面命中为准，不需要再人工额外执行 `npm run streamline:generate-registry`。

### consequence delta

- 本轮 MCP 主跑结果为 `success 0 / failed 8`，八个样本都被暂时判成 `Official MCP metadata returned no tags`；权威 manifest 从 `withTags 733 / success 733 / failed 0 / pending 1171` 变为 `withTags 733 / success 733 / failed 8 / pending 1163`。
- 随后同一组 `itemIds` 走浏览器 fallback，并沿用 low-frequency human-mode 参数后，八项全部被真实吃回为 success。
- 最终权威 manifest 更新为 `total 1904 / withTags 741 / success 741 / failed 0 / pending 1163 / pollutedCount 0`，说明这组 pending 已完成真实落盘。
- `graph-pie-chart`、`grid-off`、`half-heart` 的 tags 证据分别进入稳定语料，例如 `graph, piechart, chart, circle, data, stats, analysis, analytics, percentage, visualization...`、`grid, off, disable, deactivate, disengage, layout, switch, section, block, divide...`、`half, broken, split, heart, heartache, emotion, sadness, relationship, love, valentine...`。
- `src/generated/streamline-shared-view-icons.mjs` 已自动承载新增 family-aware `searchText`，且运行时消费面继续能通过动态导入命中对应 query。
- 这轮再次确认，metadata runner 完成闭环后 registry 自动同步仍然是正式行为；后续 pending 推进的验收继续只需核对 manifest 前进与运行时消费命中，不应再把人工补跑 registry generator 当成必需步骤。
## batch-46 round closeout

- 批次 46 的 round-level 完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由系统 Chrome Playwright shim 分段 fallback 精确补洞，目标样本为 `id-finger-print`、`id-finger-print-scan`、`id-iris-scan-alternate`、`id-iris-scan-check`、`id-thumb-mark`、`id-user`、`id-voice-1`、`id-voice-2`。
- 这轮从开始时的 `withTags 837 / success 837 / failed 0 / pending 1067` 推进到结束时的 `withTags 845 / success 845 / failed 0 / pending 1059`；MCP 先把 8 项判空并作为浏览器补洞清单，随后 Chrome Playwright shim 按 `3 + 3 + 2` 分段全部吃回 success。
- 这轮进一步确认了 durable scope 决策：后续只推进 `micro-solid`，不处理 `micro-line`；shared-view 生成产物仍可作为搜索验收面，但证据只取 micro-solid 条目。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 搜索消费的 durable 证据继续成立，但应明确是 `micro-solid` 子集上的命中：`fingerprint`、`ocular`、`electrocardiogram` 对应条目命中明确成立，不应混入 `micro-line` 的泛化结论。
- `src/components/ViewTabs.tsx` 的 `resolveSearchIconIds` 仍通过 `sharedViewGeneratedIconSearchText[iconId]?.includes(normalizedQuery)` 消费生成产物，因此 generator 自动同步与 runtime 搜索保持一致。
- 下一批 pending head 已推进到 `image-bottom`、`image-brightness`、`image-highlights`、`image-in-circle`、`image-left`、`image-picture-flower`、`image-picture-gallery`、`image-picture-landscape-1`，说明 `micro-solid` pending 继续前进而非停在身份识别簇。
- 后续 pending 推进仍应维持“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”的稳定执行路径。

## update 2026-06-24 batch-47

### decision delta

152. `Streamline-micro-solid-tags-pending并行推进批次-47 / task 1` 继续沿用已经验证稳定的执行边界：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。
153. 当前处理范围继续严格限定为 `micro-solid`，不处理 `micro-line`；虽然 generated shared-view registry 会同时包含两家族条目，但本轮推进的权威 manifest 仍然只认 `artifacts/streamline-export/micro-solid-full.manifest.json`。

### consequence delta

- 本轮开始前 summary 为 `total 1904 / withTags 845 / success 845 / failed 0 / pending 1059`。
- 当前 pending head 为 `image-bottom`、`image-brightness`、`image-highlights`、`image-in-circle`、`image-left`、`image-picture-flower`、`image-picture-gallery`、`image-picture-landscape-1`。
- 搜索验收继续只取 generated registry 中的 micro-solid 条目，不混入 `micro-line` 命中结果。
- 当前 head 已从上一轮的 `id-*` 语义簇推进到 `image-*` 语义簇，说明 `micro-solid` pending 正按簇向前推进。
- 后续执行仍应沿用“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”的可持续策略。

### task 2 delta

154. `Streamline-micro-solid-tags-pending并行推进批次-47` 继续只推进 `micro-solid`，不处理 `micro-line`；本轮推进与验收都只以 `artifacts/streamline-export/micro-solid-full.manifest.json` 和 generated registry 中的 micro-solid 条目为准。
155. MCP 试探结果仍是 `success 0 / failed 8 / pendingBefore 1059 / pendingAfter 1051`，说明这 8 个样本继续被 MCP 判空，作为浏览器补洞清单使用。
156. 随后用系统 Chrome + Playwright shim 按 `3 + 3 + 2` 低频真人化 fallback；三段 fallback 全部成功，failed 被清回 `0`。

### task 3 delta

157. 未再人工单独补跑 generator，registry 更新仍完全依赖 metadata runner 的自动同步。
158. `src/generated/streamline-shared-view-icons.mjs` 中，micro-solid `searchText` 已自动带上新增 tags，例如 `image-picture-flower`、`image-picture-landscape-1`、`image-brightness`、`image-left` 等条目对应语料已进入生成产物。
159. family-aware 搜索命中证据再次成立：`floral -> image-picture-flower`、`polarity -> image-brightness`、`correspondence -> image-left`；`horizon` 也已进入 `image-picture-landscape-1` 的 micro-solid 命中集合。
160. 运行时真实消费逻辑仍在 `src/components/ViewTabs.tsx` 的 `resolveSearchIconIds`，核心条件仍是 `sharedViewGeneratedIconSearchText[iconId]?.includes(normalizedQuery)`。
161. 自动 registry 同步闭环在 `image-*` mixed batch 中继续成立，且本轮从验收到事实边界都已正式收窄为只推进 micro-solid。

## batch-47 closeout

- 批次 47 的 round-level 完成证明继续沿用同一条默认闭环：小规模 MCP 试探后，由系统 Chrome Playwright shim 分段 fallback 精确补洞，目标样本为 `image-bottom`、`image-brightness`、`image-highlights`、`image-in-circle`、`image-left`、`image-picture-flower`、`image-picture-gallery`、`image-picture-landscape-1`。
- 这轮从开始时的 `withTags 845 / success 845 / failed 0 / pending 1059` 推进到结束时的 `withTags 853 / success 853 / failed 0 / pending 1051`；MCP 先把 8 项判空并作为浏览器补洞清单，随后 Chrome Playwright shim 按 `3 + 3 + 2` 分段全部吃回 success。
- 这轮进一步确认了 durable scope 决策：后续只推进 `micro-solid`，不处理 `micro-line`；shared-view 生成产物仍可作为搜索验收面，但证据只取 micro-solid 条目。
- metadata runner 自动 registry 同步闭环继续成立，未再人工补跑 generator。
- 搜索消费的 durable 证据继续成立，但应明确是 `micro-solid` 子集上的命中：`floral`、`polarity`、`correspondence`、`horizon` 对应条目命中明确成立，不应混入 `micro-line` 的泛化结论。
- `src/components/ViewTabs.tsx` 的 `resolveSearchIconIds` 仍通过 `sharedViewGeneratedIconSearchText[iconId]?.includes(normalizedQuery)` 消费生成产物，因此 generator 自动同步与 runtime 搜索保持一致。
- 下一批 pending head 已推进到 `image-picture-landscape-2`、`image-right`、`image-saturation`、`image-top`、`image-wallpaper-scan`、`in-love-face-smiley`、`inbox`、`inbox-open`，说明 `micro-solid` pending 继续按簇前进。
- 后续 pending 推进仍应维持“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”的稳定执行路径。

## update 2026-06-24 batch-48

### decision delta

162. `Streamline-micro-solid-tags-pending并行推进批次-48 / task 1` 继续沿用已经验证稳定的执行边界：小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；在站点限频条件下，这仍然是当前可持续推进 pending 的正式节奏。
163. 当前处理范围继续严格限定为 `micro-solid`，不处理 `micro-line`；虽然 generated shared-view registry 会同时包含两家族条目，但本轮推进的权威 manifest 仍然只认 `artifacts/streamline-export/micro-solid-full.manifest.json`。

### consequence delta

- 本轮开始前 summary 为 `total 1904 / withTags 853 / success 853 / failed 0 / pending 1051`。
- 当前 pending head 为 `image-picture-landscape-2`、`image-right`、`image-saturation`、`image-top`、`image-wallpaper-scan`、`in-love-face-smiley`、`inbox`、`inbox-open`。
- 搜索验收继续只取 generated registry 中的 micro-solid 条目，不混入 `micro-line` 命中结果。
- 当前 head 已从纯 `image` 子簇过渡到 `image / smiley / inbox` 邻近混合段，说明 `micro-solid` pending 继续按 head 顺序向前推进。
- 后续执行仍应沿用“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”的可持续策略。

## update 2026-06-24 auto-complete-input

### decision delta

164. `Streamline-micro-solid-tags-自动补全策略与复用指南 / task 1` 继续严格限定范围为 `micro-solid`，不处理 `micro-line`；这条范围收窄应作为后续自动补全与验收的默认前提。
165. 当前瓶颈不在缺样本，而在主路线仍然把官网访问当吞吐瓶颈；从输入面证据上，已经具备切换到离线自动补全主路线的条件。

### consequence delta

- 当前权威 manifest 统计为 `total 1904 / labeled 859 / unlabeled 1045`。
- 已标注样本中的唯一 tags 数量为 `3276`，平均每个已标注样本约 `14.22` 个 tags。
- 当前未标注 head，例如 `inbox`、`inbox-open`、`incognito-mode`、`indent-increase-*`，都已有本地 SVG 文件，说明自动补全不缺输入面。
- 以上输入面证据表明，当前缺口不是样本供给，而是主路线的站点限频与访问吞吐；因此从输入面上，已具备切换到离线自动补全主路线的条件。

## update 2026-06-24 auto-complete-strategy

### decision delta

166. `Streamline-micro-solid-tags-自动补全策略与复用指南 / task 2` 的主路线应从官网详情页抓取，转为 `已标注官方样本库 + 名称近邻 + SVG 图像近邻 + 受控词表 + 置信度门禁`。
167. 官网详情页抓取保留为小规模真值补样和争议复核路径，不再作为剩余 1000+ 空缺 tags 的主生产路线。
168. 自动补全必须双路：名称路负责语义边界，图像路负责同名变体和近义图形的 disambiguation。
169. 候选 tags 不应自由生成，而应默认从当前 manifest 已有官方 tags 词表中选择；当前词表规模为 `3276` 个唯一 tags。
170. 建议执行顺序是：先做 holdout 评估，再生成建议文件，再只把高置信度结果写回 manifest，最后沿现有 registry/searchText 闭环验收。

### consequence delta

- 这条新主路线将离线自动补全放在生产主路径上，而把官网详情页抓取收敛为补样与复核。
- 双路补全设计确保名称边界与图像近邻的歧义消解分工清晰，避免单一路径误配。
- 受控词表与置信度门禁确保补全结果不从自由生成开始，而是从已有官方 tags 词表约束出发。
- holdout -> 建议文件 -> 高置信写回 -> registry/searchText 验收，形成了可复用的离线补全闭环。

## auto-complete round closeout

- 本轮方案任务正式完成了对主路线的收窄：官网详情页抓取不再是主生产路线，只保留为小规模真值补样和争议复核路径。
- 已确认当前 `micro-solid` manifest 具备切主路线的基础：`859` 个官方已标注样本、`3276` 个唯一 tags、平均 `14.22` tags/样本、未标注项均有本地 SVG。
- 新主路线正式定义为：`已标注官方样本库 + 名称近邻 + SVG 图像近邻 + 受控词表 + 置信度门禁`。
- 已交付可复用文档：`docs/plans/2026-06-24-Streamline标签自动补全策略指南.md`。
- 下一步实现方向应优先从离线可批处理基础能力开始：知识库构建、候选建议生成、holdout 评估，而不是继续把官网访问当主生产链路。
- 这轮的输入面与策略结论共同表明，后续自动补全可以沿离线主路线推进，而无需再把官网抓取作为吞吐瓶颈来设计。
