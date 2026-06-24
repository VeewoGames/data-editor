# Streamline 图标 Tags 的真值源、同步链路与低频回填验证边界

status: accepted

## context

`Streamline` 官方 `tags` 的稳定真值源已经确认是详情页内嵌的 `script[type="application/json"]`，其中 `props.pageProps.initialState.streamlineApi.queries.getIconDetailsBySlugAndSubcategoryId(...)` 返回的详情数据包含官方 `tags`。外层列表页直抓 HTML 会命中 Vercel Security Checkpoint，首屏卡片与首个分组 state 也只稳定提供 `slug`、`name`、`url`，不能作为正式真值源。

真实批量访问 `https://www.streamlinehq.com/` 时会反复命中 `403 Forbidden` / `Server: Vercel` 风控，因此在线回填的正式姿势必须收敛为 `human-mode` 串行小批次推进，而不是高频脚本并发跑满。单轮验收也不以把 `1904` 项一次性全量在线跑完为前提，而是以真实 `manifest` 持久化进展与 registry 搜索消费证据证明链路成立。

本轮 `Streamline-micro-solid-tags-持续回填批次-2` 继续沿同一条持续推进路线，只把“再推进一批可持久化结果”当作目标，不把 runner 的瞬时返回值当成完成证明。对这类持续回填轮次来说，能落进真实 `manifest` 的 `success/pending/failed` 变化，以及重生 registry 后的 `searchText` 命中样例，才是可以沉淀成长期决策的证据。

随后 `Streamline-micro-solid-tags-持续回填批次-3` 进一步验证了连续 3 个 `10-item` human-mode 窗口仍可稳定推进，且未引入新的 `failed` 模式。这把“窗口化连续累积”从可行执行方式推进成了后续默认策略，也说明真实 `manifest` 变化与 registry 命中比 runner 返回值更适合作为可复用工程证据。

`Streamline-micro-solid-tags-持续回填批次-4` 把 human-mode 窗口扩大到 `20-item batch` 后，`node_repl` surface 的约 `300` 秒等待上限开始不足以覆盖完整工具调用。该轮形成的长期结论是：`tool timeout` 只能视为执行边界信号，不能直接等价为批次失败；只要真实 `manifest` 复核显示 `success` 继续增长、`failed` 没有新增，且 registry 命中仍成立，就应把这类超时解释为“批次尚未在工具层返回”，而不是“回填失败”。

`Streamline-micro-solid-tags-持续回填批次-5` 进一步把窗口收敛到更贴近上限的 `4x10` 连续分片后，确认这比 `20-item batch` 更适合作为当前 surface 的标准推进策略。该轮还把 `stale browser session/tab` 导致的 `metadata failed` 区分为可重排再处理的暂时性会话失败，而不是和官网风控或 payload 缺失混为一类不可恢复错误。

`Streamline-micro-solid-tags-持续回填批次-6` 继续沿同一 `4x10` 窗口稳定推进后，`4x10` 已经不再只是“更合适”的方案，而是当前 surface 的默认在线回填策略。到这个阶段，优化重点应转向 cadence 和吞吐控制，例如批次衔接、单轮节奏与总推进效率，而不是继续探索新的窗口形态。

`Streamline-micro-solid-tags-持续回填批次-7` 继续沿相同 `4x10` human-mode 标准窗口推进后，确认该策略仍可稳定压降 `pending`，因此默认在线回填策略保持不变。该轮同时再次验证：registry 搜索消费必须以 `searchText` 的真实 `query` 命中为准，只有 `tags` 字段存在不能证明 picker 搜索行为正确；另外，官方 metadata 源里已经观测到少量 fenced-code 前缀污染标签，后续必须在 metadata 导入或生成前完成清洗，不能只依赖 UI 端兜底。

`Streamline-micro-solid-tags-持续回填批次-8` 进一步把这项清洗修补前置为统一的 metadata 归一化链路：detail、official、MCP、manifest load 四个入口共用同一套 tags 清洗规则，污染不再依赖最终搜索端兜底过滤。修补完成后，真实 micro-solid manifest 的污染记录被回写清理，registry 的 `searchText` 也同步保持干净，同时 `4x10` human-mode 连续窗口继续稳定推进，说明清洗修补没有改变当前默认在线回填节奏。

`Streamline-micro-solid-tags-持续回填批次-9` 继续沿清洗稳定后的 `4x10` 标准窗口推进后，再次确认默认在线回填策略不变。该轮推进到 `code / coffee / coin / color` 这类新段落时，也没有改变验证标准：仍然以真实 `manifest` counts 的变化和 registry `searchText` 的 `query` 命中作为权威证据，而不是凭肉眼判断 tags 语义是否“看起来正确”。

`Streamline-micro-solid-tags-持续回填批次-10` 继续沿同一 `4x10` 标准窗口推进后，再次确认 tags 清洗修补稳定后默认在线回填策略不变。该轮推进到 `controller / cookie / copy / copyright / credit-card` 这类新段落时，验证标准仍然不变：只认真实 `manifest` counts 的变化和 registry `searchText` 的 `query` 命中，不因词段变化而放松门槛。

`Streamline-micro-solid-tags-持续回填批次-11` 继续沿同一 `4x10` 标准窗口推进后，再次确认 tags 清洗修补稳定后默认在线回填策略不变。该轮 surface 上的 `tool-call` 在约 `300s` 处虽然超时，但真实 `manifest` counts 仍明显前进，因此该轮应被视为已经实际推进，最终判据仍然是 `manifest` 复核而不是 tool 返回完整性。推进到 `dashboard / data / database` 这类新段时，验证标准仍然不变：只认真实 `manifest` counts 的变化和 registry `searchText` 的 `query` 命中。

`Streamline-micro-solid-tags-持续回填批次-12` 进一步确认：当同一 `slug` 同时存在 `micro-line` 与 `micro-solid` 条目时，搜索消费抽样必须显式标注 `family`，否则仅凭 `slug` 或 `query` 命中容易误判到另一家族。该轮继续沿清洗稳定后的 `4x10` 标准窗口推进，说明 family 维度的抽样约束不会改变当前默认在线回填节奏。

`Streamline-micro-solid-tags-持续回填批次-13` 继续沿稳定的 `4x10` human-mode 标准窗口推进后，再次确认 tags 清洗修补并不会改变当前默认在线回填节奏。该轮还进一步把搜索消费验证收敛到条目级 evidence：全文件粗粒度字符串匹配容易因为 family 混杂或上下文截取产生 false negative，不能直接作为回归结论；同时，surface 上的 `tool-call` 在约 `300s` 处再次超时但 `manifest` counts 继续前进，因此该轮依然应按实际推进处理，最终判据仍是 `manifest` 复核，而不是 tool 返回是否完整。

`Streamline-micro-solid-tags-持续回填批次-14` 进一步补齐了回归判定边界：当落盘产物片段看起来与 `manifest` 产生矛盾时，应先用 `loadManifest` 与 `generateSharedViewStreamlineIcons` 的内存结果做二次确认，再判断是否真的出现了 generator 回归。该轮仍然沿同一 `4x10` human-mode 标准窗口推进，说明这种二次确认不会改变当前默认在线回填节奏。

`Streamline-micro-solid-tags-持续回填批次-15` 进一步确认了运行时 registry 消费的主判据：优先直接导入 `src/generated/streamline-shared-view-icons.mjs` 读取对象，文本切片只适合作为辅助。该轮沿同一 `4x10` human-mode 标准窗口继续稳定推进，也再次说明这种验证方式不会改变当前默认在线回填节奏。

`Streamline-micro-solid-tags-持续回填批次-16` 重新校准了权威来源与执行载体：旧的 shell 4x10 human-mode runner 在当前 Streamline 风控下不再可靠，详情页官方 `tags` 的权威来源应定义为 `#__NEXT_DATA__` 中的 `streamlineApi.getIconDetailsBySlugAndSubcategoryId(...).data.tags`，而在线回填执行策略应切换为 Chrome 插件驱动的低频串行微批次。

`Streamline-metadata-runner-执行链路重构` 进一步把 metadata runner 的正式默认执行面切换为 API key 驱动的 MCP/API 批处理链路。对当前仍存在空 tags 的剩余洞位，正式策略不应只把 API 当成页面替代，而应定义为 `API/MCP 主跑 + browser fallback 补 API 空 tags 洞`；要让 hybrid fallback 成立，`itemIds` 的精确选择是必要条件，而不是可选优化。

`Streamline-hybrid-metadata-持续推进批次-17` 和后续 batch 进一步验证了 hybrid runner 不只是能处理单个样例，而是可以按语义簇连续小批次清理历史 `payload not found` failed。对当前 micro-solid 清理阶段，`itemIds + retryFailed: true` 已经成为连续清理旧 failed 的默认工作模式，而不是临时修补参数。

`Streamline-hybrid-metadata-持续推进批次-19` 再次把这件事推进到更强的复用证据：hybrid runner 已连续三轮稳定吃回历史 `payload not found` failed，说明“按语义簇分批推进剩余 failed”已经不是一次性的单样例修复，而是当前默认执行模式。

`Streamline-hybrid-metadata-持续推进批次-20` 继续沿同一条路径推进后，hybrid runner 已连续四轮稳定吃回历史 `payload not found` failed，说明“按语义簇分批推进剩余 failed”的策略继续成立，且当前默认执行模式没有退化。

当前 `manifest` 的读写入口集中在 `scripts/streamline-export/lib/manifest-store.mjs`，其中批量安全写回与汇总统计边界已经成为正式元数据层的一部分。历史 `manifest` 可能缺少新的元数据字段，因此兼容策略必须落在运行时读取路径上，而不是额外补一个一次性迁移脚本。与此同时，现有 SVG 提取状态字段 `status`、`attempts`、`error`、`extractedAt` 已经承载提取流程语义，不能被 `tags` 元数据复用或改写。

## decision

1. `Streamline` 官方 `tags` 的稳定真值源固定为 `#__NEXT_DATA__` 中的 `streamlineApi.getIconDetailsBySlugAndSubcategoryId(...).data.tags`；外层列表 DOM、裸 HTTP 抓取与非权威片段不再作为正式来源。
2. `manifest` 继续作为 SVG 提取状态与 metadata 状态的统一汇合点，其中 `status`、`attempts`、`error`、`extractedAt` 继续只表示 SVG 提取语义，`metadataStatus`、`metadataError`、`metadataUpdatedAt` 只表示 `tags` metadata 语义，二者分离。
3. `manifest item` 的稳定 metadata 字段仍以 `tags`、`metadataStatus`、`metadataError`、`metadataUpdatedAt` 为准；`loadManifest` 负责在读取侧归一化这些字段，避免为历史数据引入一次性迁移脚本。
4. 在线回填在官网风控约束下收敛为 API key 驱动的 MCP/API 批处理链路主跑；旧的 shell 4x10 human-mode runner 已不再可靠，Chrome 插件低频串行微批次退为 browser fallback，仅用于补 API 空 tags 洞。
5. 本轮完成证明不要求单轮内把 `1904` 项官方 `tags` 全量在线跑完；验收证据以真实 `manifest` 的可持久化推进结果、回归测试以及 registry 搜索消费命中为准。
6. `manifest` 的批量写回必须通过单点安全收敛，避免并行 worker 各自整文件读写同一个 `manifest`。
7. 共享视图 icon 搜索继续消费 generator 产物 `searchText`，新增 `tags` 通过生成阶段并入 `searchText`，不改变现有 icon picker 的搜索动作和交互模型。
8. 在 API/MCP 主跑仍稳定推进、且未新增 `failed` 的前提下，后续执行策略默认采用连续批处理累积，不再把每轮都压缩成最小样本；browser fallback 只用于补 API 空 tags 洞。这类持续性证据优先于 runner 返回值，作为判定链路可复用性的主要依据。
9. 当 human-mode 窗口扩大到 `20-item batch` 并触发 `tool timeout` 时，后续必须以 `manifest` 复核结果判断真实推进，不把工具超时直接当成批次失败；只要 `success` 继续增长、`failed` 未新增且 registry 命中成立，就把该轮视为真实推进成功。
10. 在当前 surface 上，API key 驱动的 MCP/API 批处理链路优先于旧 shell 4x10 runner 作为标准推进策略；后续优化重点应转向 API/MCP 吞吐、批处理 cadence 与 browser fallback 补洞能力，而不是继续依赖 shell runner。
11. `stale browser session/tab` 引起的 `metadata failed` 归为暂时性会话失败，处理方式是重排回 `pending` 后重新执行；只有官网风控持续命中、payload 缺失或 `manifest` 复核确认无进展时，才视为更高等级的不可恢复失败。
12. 当 API/MCP 主跑已连续多轮稳定推进后，它可以直接作为当前 surface 的默认在线回填策略；browser fallback 只作为补洞机制保留，后续优化重点应转向 API/MCP cadence 与吞吐，而不是继续探索旧 shell runner 形态。
13. registry 搜索消费验证必须以 `searchText` 的真实 `query` 命中为准；仅有 `tags` 字段存在不足以证明搜索消费链路正确。
14. 当官方 metadata 源里观测到 fenced-code 前缀污染标签时，后续必须在导入或生成前清洗污染值，不能把这类脏数据交给 UI 搜索端兜底。
15. tags 清洗应前置到统一 metadata 归一化链路，detail、official、MCP、manifest load 四个入口必须共享同一套清洗规则，避免在最终搜索端做分散兜底。
16. 在 tags 清洗修补加入后，API/MCP 主跑仍保持稳定推进，因此清洗修补不应改变当前默认在线回填节奏。
17. 在 tags 清洗链路稳定后，API/MCP 主跑继续作为默认在线回填策略不变；browser fallback 仅用于补 API 空 tags 洞，后续新段落推进仍以真实 `manifest` counts 和 registry `searchText` query 命中作为权威验证。
18. 当批次推进到 `controller / cookie / copy / copyright / credit-card` 这类新段落时，权威验证标准保持不变，仍由真实 `manifest` counts 和 registry `searchText` query 命中裁决。
19. 当 `tool-call` 在约 `300s` 处超时但 `manifest` counts 明显前进时，应把该轮视为已实际推进，并以 `manifest` 复核而不是 tool 返回完整性作为最终判据。
20. 当批次推进到 `dashboard / data / database` 这类新段落时，权威验证标准保持不变，仍由真实 `manifest` counts 和 registry `searchText` query 命中裁决。
21. 当同一 `slug` 同时存在 `micro-line` 与 `micro-solid` 条目时，搜索消费抽样必须显式标注 `family`，避免把同一个 `slug` 的命中误判到另一家族。
22. 搜索消费验证应优先采用条目级 evidence；全文件粗粒度字符串匹配可能因 family 混杂或上下文截取产生 false negative，不能直接作为回归结论。
23. 当 `tool-call` 在约 `300s` 处再次超时但 `manifest` counts 继续前进时，仍应按实际推进处理，并以 `manifest` 复核而不是 tool 返回完整性作为最终判据。
24. 当落盘产物片段看起来与 `manifest` 矛盾时，应先用 `loadManifest` 与 `generateSharedViewStreamlineIcons` 的内存结果做二次确认，再判断是否真的发生 generator 回归。
25. 验证运行时 registry 消费时，优先直接导入 `src/generated/streamline-shared-view-icons.mjs` 读取对象；文本切片只适合作为辅助，不应作为主判据。
26. `itemIds` 精确选择是 `API/MCP 主跑 + browser fallback` hybrid 方案成立的必要条件，不能依赖粗粒度 slug 重跑或全量回填兜底。
27. hybrid runner 可以按语义簇连续小批次清理历史 `payload not found` failed；在当前 micro-solid 清理阶段，`itemIds + retryFailed: true` 是默认工作模式，不再只是临时修补参数。
28. 连续清理旧 failed 的 hybrid 工作模式应优先保持 `itemIds` 精确选择，不应回退到粗粒度 slug 或全量重跑。
29. `Streamline-hybrid-metadata-持续推进批次-19` 的连续三轮稳定推进表明，按语义簇分批处理剩余 `payload not found` failed 已经成为当前默认执行模式，而非仅对个别样例有效的临时策略。
30. `Streamline-hybrid-metadata-持续推进批次-20` 把这一证据进一步推进到连续四轮稳定成功，因此按语义簇分批推进剩余 failed 的策略继续成立，并保持当前默认执行模式不变。

## alternatives considered

- 为历史 `manifest` 增加一次性迁移脚本：这会把兼容成本转移到离线流程，且旧文件在迁移前后的行为分叉更大，不利于保持单一路径真值。
- 把外层列表页 HTML 作为官方 `tags` 真值源：该路径会碰到 Vercel Security Checkpoint，且列表 state 不提供完整 `tags` 信息，无法形成稳定契约。
- 继续把在线详情页高频并发批量回填作为正式生产方案：真实站点批量访问会稳定触发风控，正式链路无法保持可持续运行。
- 把单轮验收绑定到 `1904` 项一次性全量在线完成：这会把风控、会话恢复和节奏控制耦死在一轮里，不符合当前可持续推进边界。
- 新增独立 HTTP 爬取通道：这会把采集逻辑拆出既有浏览器会话能力，增加认证、恢复与异常处理的维护成本，也会让真实运行路径分叉。

## related code

- `scripts/streamline-export/lib/manifest-store.mjs`
  - `loadManifest`
  - `createManifest`
  - `updateManifestItemMetadata`
  - `updateManifestItemsMetadataBatch`
  - `summarizeManifestMetadata`
  - `loadManifestMetadataSummary`
- `scripts/streamline-export/lib/streamline-detail-metadata.mjs`
- `scripts/streamline-export/extract-streamline-detail-metadata.mjs`
- `scripts/streamline-export/lib/streamline-metadata-session.mjs`
- `scripts/streamline-export/run-streamline-metadata-session.mjs`
- `scripts/streamline-export/run-streamline-svg-export-session.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch5.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch6.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch7.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch8.mjs`
- `scripts/streamline-export/promote-streamline-stable-clusters.mjs`
- `scripts/streamline-export/stable-cluster-profiles.mjs`
- `scripts/streamline-export/generate-shared-view-streamline-icons.mjs`
- `src/components/icons.ts`
- `src/generated/streamline-shared-view-icons.mjs`
- `src/components/ViewTabs.tsx`
- `tests/streamline-export/manifest-store.test.mjs`
- `tests/streamline-export/streamline-detail-metadata.test.mjs`
- `tests/streamline-export/extract-streamline-detail-metadata.test.mjs`
- `tests/streamline-export/streamline-metadata-session.test.mjs`
- `tests/streamline-export/metadata-runner.test.mjs`
- `tests/streamline-export/generate-shared-view-streamline-icons.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch5.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch6.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch7.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch8.test.mjs`
- `tests/streamline-export/promote-streamline-stable-clusters.test.mjs`
- `tests/data-editor.spec.ts`

## consequences

- 官方 `tags` 的稳定输入点被锁定在详情页 JSON state，后续如果外层列表页结构变化，不会直接冲击同步链路。
- 在线回填的正式姿势收敛为 API key 驱动的 MCP/API 批处理链路，因此真实大批量推进必须靠持续执行和节奏控制，而不是恢复高频脚本并发或旧 shell runner。
- 单轮完成证明改为观察真实 `manifest` 的持久化进展和 registry 搜索消费命中，不再把 `1904` 项全量一次性跑完当作前置条件。
- runner 返回值只适合作为执行过程中的遥测，不足以单独证明 tags 已经持久化写回或搜索消费已更新。
- 连续 `3x10` 窗口的稳定性把“无新增 failed 且 registry 命中继续成立”提升为更强的复用证据，后续排期和验收可以直接依赖这一类实证。
- 对于扩到 `20-item` 的 batch，`tool timeout` 只说明工具层未及时返回，不构成失败判定；`manifest` 复核与 registry 命中是更高优先级的工程证据。
- 对于当前 surface，MCP/API 主跑比旧 shell 4x10 runner 更适合作为标准推进，因为它把批处理边界和可复核结果更好地对齐；browser fallback 只负责补 API 空 tags 洞。
- `stale session/tab failed` 不应直接污染长期失败统计，重排回 `pending` 后再执行能保留这类会话噪声的可恢复性。
- 当 API/MCP 主跑已成为默认策略后，排期与实现优化应优先服务于 cadence、吞吐和批次衔接，以及 browser fallback 的补洞能力，而非继续试探旧 shell runner 形态。
- hybrid runner 对旧 failed 的清理已经证明可按语义簇连续推进，因此后续剩余 failed 的默认处理应继续沿 `itemIds + retryFailed: true` 维持精确补洞。
- `Streamline-hybrid-metadata-持续推进批次-19` 把这件事进一步抬升为连续三轮稳定证据，说明语义簇分批推进剩余 failed 已经具备可复用性和默认化条件。
- `Streamline-hybrid-metadata-持续推进批次-20` 进一步把这件事推进到连续四轮稳定证据，说明语义簇分批推进剩余 failed 的默认化条件仍然成立且未退化。
- registry 命中必须由 `searchText` query 证明，而不是依赖字段存在、导入完成或肉眼检查。
- fenced-code 前缀污染属于数据清洗问题，应该在 metadata 导入/生成链路中截断，而不是留给消费者修正。
- detail、official、MCP、manifest load 共享同一套 tags 清洗规则后，清洗语义就有了单一真相源，后续新增入口也应接入这条归一化链路。
- tags 清洗修补不会改变当前 API/MCP 主跑默认策略，只影响输入质量，不影响推进节奏。
- 进入 `code / coffee / coin / color` 这类新段落时，验证标准保持不变，仍由 `manifest` 复核和 registry query 命中裁决，不因标签语义变化而放松门槛。
- 进入 `controller / cookie / copy / copyright / credit-card` 这类新段落时，验证标准同样保持不变，仍由 `manifest` 复核和 registry query 命中裁决。
- 进入 `dashboard / data / database` 这类新段落时，验证标准同样保持不变，仍由 `manifest` 复核和 registry query 命中裁决。
- 当同一 `slug` 存在多个 family 条目时，抽样和验收都必须带上 `family` 维度，否则 `slug` 级别的命中不具备唯一性。
- 搜索回归若只看全文件粗粒度字符串，可能把 family 混杂或上下文截断误判成未命中，因此必须回到条目级 evidence。
- tool-call timeout 只是在当前 surface 的执行边界再次被碰到，不改变“counts 前进即真实推进”的判据。
- 当落盘片段与 `manifest` 不一致时，先看内存里的 `loadManifest` 和 `generateSharedViewStreamlineIcons` 结果，可以把文件残留、片段截断和真实 generator 回归区分开。
- 运行时 registry 验证里，模块级导入对象比文本切片更接近真实消费路径，也更不容易受截断和排版差异影响。
- `manifest` 的 SVG 提取状态与 metadata 状态边界更清晰，后续扩展不必重做状态模型。
- 共享视图搜索仍然只认 `searchText`，`tags` 变化通过生成阶段吸收，不需要改 icon picker 搜索动作本身。
- 兼容逻辑继续集中在 `loadManifest`，因此相关测试仍需覆盖历史缺字段、默认值补齐以及 `metadataStatus` 三态约束。

## update 2026-06-24 batch-21

### decision delta

31. 在官网页面仍可访问但已不再允许大批量脚本抓取的前提下，页面侧正式执行面进一步收缩为 `humanMode + concurrency = 1` 的低频拟人化微批次；页面访问不再被表述成可持续的大窗口批处理面。
32. 在上述约束下，页面侧回填的默认批次规模应优先控制在 `1 x 1` 到 `1 x 4` 的小语义簇范围，重点优先保证节奏和可持续性，而不是单轮吞吐。
33. 即使页面侧正式执行面收缩，验收标准仍不变化：真实推进只认 `manifest` counts 与样本 tags 落盘，搜索消费只认 registry `searchText` query 命中。

### consequence delta

- 页面侧链路的职责从“持续放量推进”进一步明确为“在严格风控约束下做可持续补洞”，因此后续 round 设计要围绕小簇 failed 清理和节奏控制，而不是再尝试恢复大窗口批处理。
- `align-horizontal-center` 与 `align-horizontal-center-2` 的真实吃回证明，在页面批量脚本访问失效后，低频拟人化微批次仍能继续压降历史 `payload not found` failed，不需要把页面链路整体判定为不可用。
- `equidistant workflow block -> align-horizontal-center` 与 `symmetry balance midpoint -> align-horizontal-center-2` 的命中证据说明，页面侧执行面收缩不会改变 generator 到运行时搜索消费的正确性要求，也没有破坏该消费链路。

## update 2026-06-24 batch-22

### decision delta

34. 当页面侧正式执行面已经收缩为低频拟人化微批次后，后续剩余 failed 应继续按小语义簇连续推进；`align-text-*` 这类同簇样本适合作为默认连续验证面，而不是回退到跨语义的大窗口拼盘。
35. 运行时搜索消费验证若使用同一 Node 进程重复导入生成模块，可能读到旧模块缓存；因此消费验收应优先采用重新加载模块或直接检查生成文件内容的方式，避免把缓存误判为 generator 回归。

### consequence delta

- `align-text-bottom`、`align-text-center`、`align-text-top` 的连续吃回把页面侧低频拟人化微批次的可复用证据从 2 项扩展到 3 项同簇样本，说明这一策略仍在稳定压降历史 `payload not found` failed。
- `formatting navigation square -> align-text-bottom`、`typography menu centered -> align-text-center`、`tools move arrow -> align-text-top` 的命中证据说明，页面侧微批次继续不会破坏 generator 到运行时搜索消费的正确性。
- 新增的模块缓存判据意味着，后续若再次出现“manifest 已有 tags 但运行时对象看起来为空 tags”的现象，应先排查导入缓存，而不是立即把问题归因为 generator 或 manifest 回写回归。

## update 2026-06-24 batch-23

### decision delta

36. 低频拟人化微批次的默认推进面已经不再局限于单一语义簇；在保持小窗口的前提下，可以用头部 failed 的 mixed batch 继续压降剩余 `payload not found` failed。
37. 当生成文件内容已明确包含新增 tags 和 searchText 命中词时，即使同进程运行时抽样仍显示旧对象，也应优先判定为导入缓存边界，而不是 generator 回归；生成文件内容本身可以作为更接近落盘产物的验收证据。

### consequence delta

- `alert-shield-privacy-info`、`align-horizontal-left`、`allergens-gluten`、`alt` 的连续吃回把页面侧低频拟人化微批次的可复用证据从同簇样本扩展到 mixed batch，说明当前策略在小窗口 mixed failed 上也保持稳定。
- `privacy warning shield -> alert-shield-privacy-info`、`sidebar justification hamburger -> align-horizontal-left`、`celiac bread grain -> allergens-gluten`、`keyboard hotkey input -> alt` 的命中证据说明，mixed batch 同样不会破坏 generator 到运行时搜索消费的正确性。
- 由于缓存边界已经连续两轮出现，后续运行时验收默认应把“重新加载模块或直接检查生成文件内容”视作标准动作，避免重复把缓存误报当成 generator 回归。

## update 2026-06-24 batch-24

### decision delta

38. 当剩余 failed 已经同时包含页面侧 `payload not found` 与 MCP 空 tags 两类根因时，后续轮次应显式分流：页面侧 failed 继续由 low-frequency human-mode 微批次清理，MCP 空 tags 类 failed 留给单独 hybrid 补洞轮次处理。
39. 在页面侧 failed 清理轮次中，只要生成文件内容已证明 query 语义进入 `searchText`，就足以判定搜索消费链路正确；运行时对象抽样若再次落到旧值，不应覆盖生成文件这一更直接的落盘证据。

### consequence delta

- `ambulance`、`ampersand`、`anchor`、`android-logo` 的连续吃回说明，页面侧 `payload not found` failed 仍然可以在当前 low-frequency 微批次模型下继续稳定压降。
- `paramedic hospital vehicle -> ambulance`、`glyph typeface logogram -> ampersand`、`maritime harbor vessel -> anchor`、`robot smartphone minimalist -> android-logo` 的命中证据说明，页面侧 failed 清理轮次继续不会破坏 generator 到搜索消费的正确性。
- 当前剩余 failed 已显著收缩到 `6`，而其中 `flip-*` 明确属于 MCP 空 tags 类根因，因此下一轮执行策略更适合切到分流处理，而不是继续把两类 failed 混在同一轮里。 

## update 2026-06-24 batch-25-and-26

### decision delta

40. 当页面侧 `payload not found` failed 已缩减到最后一组时，应优先先把页面侧 failed 清零，再把剩余问题收敛成单一的 MCP 空 tags 补洞问题；这样后续执行面更简单、更可验证。
41. 当剩余 failed 已收敛成单一的 MCP 空 tags 根因时，允许直接使用精确 `itemIds` 的浏览器 fallback 补洞来完成最后一组 failed 清零，而不必为了形式保持再额外重跑一遍 MCP 主调用。

### consequence delta

- `announcement-megaphone`、`apple`、`apple-logo` 的吃回意味着页面侧 `payload not found` failed 已全部清零，页面侧微批次清理阶段已经完成其阶段性使命。
- `flip-horizontal-1`、`flip-horizontal-2`、`flip-left` 的吃回意味着 micro-solid manifest 当前 `metadataStatus = failed` 的历史失败项已全部清零；当前剩余工作不再是 failed 修复，而是如何继续推进 `pending`。
- 既然 `failed = 0` 已达成，后续执行策略应从“failed 清理”切换到“pending 推进节奏设计”，包括是否优先恢复 API/MCP 批处理、是否按语义簇或 hash 窗口继续推进、以及如何在当前站点约束下证明全量回填仍可接受地完成。 

## update 2026-06-24 batch-27

### decision delta

42. 在 `failed = 0` 之后，正式主线切换为 `pending` 推进；对这类 pending，不应要求 MCP 主跑必须直接产出 success，允许它先充当“批量判空与筛选浏览器补洞清单”的第一跳。
43. 对 pending 批次的正式判据应定义为两段式：先看 MCP 并行窗口是否把目标 pending 批量筛出，再看浏览器 fallback 是否把该批样本真实吃回为 success；最终仍只认 manifest 的落盘结果。

### consequence delta

- `flip-up`、`flip-vertical-1`、`flip-vertical-2`、`flll-color-bucket`、`flower`、`focus-center`、`focus-points`、`fog-cloud` 的推进证明，现有“并行 MCP 主跑 + 浏览器 fallback 补洞”链路不仅能清理 failed，也能继续把 pending 真正推进成 success。
- 这轮从 `pending 1219 / success 685 / failed 0` 推进到 `pending 1211 / success 693 / failed 0`，说明当前链路虽然不一定在 MCP 第一跳直接拿到 tags，但整体上仍然能以可复核的方式持续压降 pending。
- 后续 pending 推进应继续围绕小规模并行 MCP 窗口与浏览器 fallback 的组合节奏设计，而不是回到只做 failed 修复或只做单面浏览器串行回填。 

## update 2026-06-24 batch-28-and-29

### decision delta

44. 当 pending 批次已经稳定表现为“MCP 首跳批量判空 + 浏览器 fallback 精确补洞”时，这条两段式闭环应被视为默认成功路径，而不是异常补救路径；对 pending 的验收应继续只认最终 manifest 落盘结果。
45. metadata session 结束后必须自动同步 shared-view registry；否则 manifest 中的新 tags 虽然已存在，但 `src/generated/streamline-shared-view-icons.mjs` 的 `searchText` 仍会停留在旧状态，导致搜索消费滞后于 manifest 真相源。
46. 对存在 cross-family 同名 slug 的样本，搜索消费验收必须上升到 `family + itemId` 维度；仅按 slug 抽样会误命中错误 family，不能作为有效证据。

### consequence delta

- `folder / font-size / football / fork-* / forwarding-call` 与 `french-fries / full-moon / gas-*` 这两轮连续 pending 推进，把当前主链路的可复用证据从单批扩展到连续三批，说明“并行 MCP 主跑 + 浏览器 fallback 补洞”已能稳定压降 pending，而不是偶发成功。
- `withTags / success / pending` 连续从 `693 / 693 / 1211` 推进到 `701 / 701 / 1203`，再推进到 `709 / 709 / 1195`，说明即使 MCP 首跳持续返回空 tags，这条两段式闭环仍能以可复核方式稳定前进。
- 自动 registry 同步补丁把“manifest 已更新但搜索索引未更新”的链路缺口收敛进 runner 正式执行面；后续只要 metadata 批次成功落盘，就不需要再依赖人工补跑 generator 才能让搜索消费跟上。

## update 2026-06-24 batch-30

### decision delta

47. metadata runner 自动同步 shared-view registry 的验收必须放到真实执行链路里做，不能只依赖单元测试结果，也不能只靠人工补跑 generator 来证明；只有真实批次执行把新增 tags 落到 manifest、并让搜索消费在同一条链路里跟上，才能算这条决策真正成立。批次 30 已经通过真实执行验证了这条链路。

### consequence delta

- 批次 30 继续沿 `MCP 首跳判空 + 浏览器 fallback 精确补洞` 的闭环推进，并在真实执行后直接观察到 shared-view registry 自动重生和搜索消费跟进，说明 registry 同步不再需要人工补跑 generator 作为验收前提。
- 这也把“自动同步 registry 是否生效”的判据进一步收紧为真实执行证据，而不是测试桩、局部函数调用或离线回放结果。

## update 2026-06-24 batch-31

### decision delta

48. metadata runner 自动同步 shared-view registry 的真实执行证据已经从 batch-30 扩展到 batch-31，说明这条验收链路具备连续可复用性，而不是单批偶发现象；后续对这条链路的验收仍应以真实批次执行后的 manifest 落盘、生成产物更新和 searchText / query 命中为联合证据。

### consequence delta

- batch-31 继续在真实执行链路里复现了 batch-30 的自动同步结果，说明 shared-view registry 自动重生与搜索消费跟进不是一次性巧合，而是当前 runner 正式链路的稳定行为。
- 这把验收标准进一步从“batch-30 已经做成”推进到“batch-30 到 batch-31 连续可复用”，后续不应再把这条链路当作需要额外人工兜底的特殊情况。

## update 2026-06-24 batch-32

### decision delta

49. 自动 registry 同步闭环在 `graph-*` 语义段仍然成立；同时，搜索消费验收必须继续坚持 `family-aware`、条目级 `query`，宽泛关键词即使在同 family 内部也会出现误命中，不能作为正式验收证据。批次 32 已经在真实执行链路里再次证明了这一点。

### consequence delta

- batch-32 在 `graph-arrow-decrease`、`graph-bar-horizontal`、`graph-bar-increase-square` 等样本上继续复现了自动同步与搜索消费跟进，说明这条闭环并不依赖特定语义段，进入 `graph-*` 以后仍可稳定工作。
- 这也把验收规则进一步固定为条目级证据优先：同 family 的泛化关键词只能作为辅助观察，不能替代精确 `query` 命中。

## update 2026-06-24 batch-33

### decision delta

50. 自动 registry 同步闭环在 mixed `graph / grid / heart` 样本里仍然成立，因此这条验收链路不依赖单一语义簇，可继续作为后续 pending 推进的默认验证面；只要进入真实执行链路，仍应以自动同步后的生成产物和 family-aware 条目级 `query` 命中作为联合证据。

### consequence delta

- batch-33 在 `graph-pie-chart`、`grid-off`、`half-heart` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，说明这条闭环已经跨过单一语义簇的边界，具备更强的可复用性。
- 这也确认了后续 pending 推进不需要按语义簇拆分验收方式，默认验证面仍然是同一条真实执行链路，只是 query 证据必须继续收窄到条目级。

## update 2026-06-24 batch-34

### decision delta

51. 自动 registry 同步闭环在 `half / hamburger / hand` mixed batch 里继续成立，因此这条验收链路仍不依赖单一语义簇，可继续作为后续 pending 推进的默认验证面；进入真实执行链路后，仍应以自动同步后的生成产物和 family-aware 条目级 `query` 命中作为联合证据。

### consequence delta

- batch-34 在 `half-star`、`hamburger-menu-circle`、`hand-held` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，说明这条闭环已经稳定覆盖不同语义簇的混合批次。
- 这进一步确认了后续 pending 推进不需要针对 `half / hamburger / hand` 单独切换验收模板，默认验证面保持不变，只是搜索证据仍必须收窄到条目级。

## update 2026-06-24 batch-35

### decision delta

52. 自动 registry 同步闭环在 `tablet / smiley / hard-drive` mixed batch 里继续成立，说明搜索消费验收不依赖单一语义簇；只要进入真实执行链路，仍应以自动同步后的生成产物与 family-aware 条目级 `query` 命中作为联合证据。
53. 当 Streamline 官方站点存在频率限制时，当前可行执行策略应收敛为“小规模 MCP 并行窗口 + 必要时低频真人化浏览器 fallback”；这条执行方式已经在本轮真实推进中被证明可用，后续 pending 推进可以继续沿用。

### consequence delta

- batch-35 在 `hand-held-tablet-writing`、`happy-face-smiley-1`、`hard-drive-upload` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，说明这条闭环仍然不依赖单一语义簇，也不要求同一语义族内必须使用相同的验收模板。
- 频率限制下的操作边界进一步明确为：优先用小规模并行窗口维持推进节奏，必要时再用低频真人化浏览器 fallback 补洞，而不是扩大并发或回退到高频脚本硬跑。

## update 2026-06-24 batch-36

### decision delta

54. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略应继续收敛为“小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback”；这是一条可持续执行边界，而不是临时救火手段。
55. metadata runner 自动 registry 同步闭环在 `hashtag / heading styles` mixed batch 里继续成立，说明搜索消费验收仍然不依赖人工补跑 generator；后续对这条链路的验收仍应以真实执行后的 manifest、自动同步产物和 family-aware 条目级 `query` 命中为准。

### consequence delta

- batch-36 在 `hashtag-sign`、`hashtag-tag-channel-phone-number`、`heading-styles-2`、`heading-styles-5` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，证明这条闭环依然跨语义簇稳定工作。
- 这轮同时把执行边界进一步压实为“先小规模试探，再只对判空样本做低频真人化 fallback”，从而在限频/封禁风险下仍保持可持续推进，而不需要恢复人工补跑 generator 作为验收前提。

## update 2026-06-24 batch-37

### decision delta

56. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；这条执行边界已经连续在多批次真实推进中成立，应继续作为默认策略。
57. metadata runner 自动 registry 同步闭环在 `support / hearing / heart` mixed batch 里继续成立，说明搜索消费验收仍然不依赖人工补跑 generator；后续验收仍应以真实执行后的 manifest、自动同步产物和 family-aware 条目级 `query` 命中为准。

### consequence delta

- batch-37 在 `headphone-customer-support-4`、`hearing-deaf`、`heart-rate` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，说明这条闭环继续跨语义簇稳定工作。
- 这也再次确认了限频/封禁风险下的可持续执行方式不需要扩大并发或回退到高频脚本，只要保持小规模试探并仅对判空样本做低频真人化 fallback 即可。

## update 2026-06-24 batch-38

### decision delta

58. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；这条执行边界已经连续在多个批次真实推进中成立，应继续作为默认策略。
59. metadata runner 自动 registry 同步闭环在 `heart rate / heat / help` mixed batch 里继续成立，说明搜索消费验收仍然不依赖人工补跑 generator；后续验收仍应以真实执行后的 manifest、自动同步产物和 family-aware 条目级 `query` 命中为准。

### consequence delta

- batch-38 在 `heart-rate-clipboard`、`heart-rate-monitor`、`heat-off`、`help-chat` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，说明这条闭环依然跨语义簇稳定工作。
- 这再次确认了限频/封禁风险下的可持续执行方式不需要扩大并发或回退到高频脚本，只要保持小规模试探并仅对判空样本做低频真人化 fallback 即可。

## update 2026-06-24 batch-39

### decision delta

60. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；这条执行边界已经持续在多个批次真实推进中成立，应继续作为默认策略。
61. metadata runner 自动 registry 同步闭环在 `help / symbol / hierarchy` mixed batch 里继续成立，说明搜索消费验收仍然不依赖人工补跑 generator；后续验收仍应以真实执行后的 manifest、自动同步产物和 family-aware 条目级 `query` 命中为准。

### consequence delta

- batch-39 在 `help-question-circle`、`help-shield-privacy-question`、`hexagram`、`hierachy-organise-1` 等 mixed 样本上继续复现了自动同步与搜索消费跟进，说明这条闭环依然跨语义簇稳定工作。
- 这再次确认了限频/封禁风险下的可持续执行方式不需要扩大并发或回退到高频脚本，只要保持小规模试探并仅对判空样本做低频真人化 fallback 即可。

## update 2026-06-24 batch-40

### decision delta

62. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；这条执行边界已经在连续批次真实推进中成立，应继续作为默认策略。
63. metadata runner 自动 registry 同步闭环在纯 `hierachy-organise` 连续批次里继续成立，说明搜索消费验收仍然不依赖人工补跑 generator；后续验收仍应以真实执行后的 manifest、自动同步产物和 family-aware 条目级 `query` 命中为准。

### consequence delta

- batch-40 在 `hierachy-organise-10`、`hierachy-organise-11`、`hierachy-organise-12`、`hierachy-organise-6` 等连续样本上继续复现了自动同步与搜索消费跟进，说明这条闭环即便在同一语义族的连续批次里也保持稳定。
- 这再次确认了限频/封禁风险下的可持续执行方式仍然是小规模试探加低频真人化 fallback，不需要扩大并发，也不需要回到人工补跑 generator 才能让搜索消费跟上。

## update 2026-06-24 batch-41

### decision delta

64. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 仅对判空样本做低频真人化浏览器 fallback；这条执行边界已经在连续批次真实推进中成立，应继续作为默认策略。
65. 当 Browser 插件句柄丢失或单次 fallback 被 300s 工具上限截断时，可以切到系统 Chrome + Playwright shim 继续复用同一 metadata runner，而自动 registry 同步与搜索消费验收仍然成立；这条恢复路径已经在本轮真实推进中被验证可用。

### consequence delta

- batch-41 在 `hierachy-organise-7`、`hierachy-organise-8`、`hierachy-organise-9`、`hierarchy-line-1`、`hierarchy-line-4`、`high-speed-train-side` 等样本上继续复现了自动同步与搜索消费跟进，说明这条闭环在限频场景下依然稳定。
- 这也确认了 fallback 的恢复面不局限于 Browser 插件句柄；当单次工具层截断或句柄丢失时，系统 Chrome + Playwright shim 可以直接承接同一条 metadata runner 链路，继续完成验收而无需改写校验标准。

## update 2026-06-24 batch-42

### decision delta

66. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；这条执行边界已经在连续批次真实推进中成立，应继续作为默认策略。
67. 当 Browser 插件不可用或单次 fallback 被 300s 工具上限截断时，分段 Playwright shim 已经从恢复手段演化为可稳定复用的正式执行路径，而自动 registry 同步与搜索消费验收仍然成立。

### consequence delta

- batch-42 在 `highlighter`、`home-1`、`home-door`、`horizontal-menu-square` 等样本上继续复现了自动同步与搜索消费跟进，说明这条闭环即便在分段 shim 路径下仍然稳定。
- 这也把系统 Chrome Playwright shim 从“备用恢复方案”进一步推进为正式执行路径的一部分，后续不需要因为 Browser 句柄波动而回退到人工补跑 generator 或改变验收标准。

## update 2026-06-24 batch-43

### decision delta

68. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；这条执行边界已经在连续批次真实推进中成立，应继续作为默认策略。
69. 自动 registry 同步闭环在 `scroll / hospital / hotel` mixed batch 里继续成立，说明分段 Playwright shim fallback 仍然可以作为稳定执行路径，且搜索消费验收依旧不依赖人工补跑 generator。

### consequence delta

- batch-43 在 `horizontal-scroll`、`hospital-sign-circle`、`hotel-bed-1`、`horizontal-menu-square` 等样本上继续复现了自动同步与搜索消费跟进，说明这条闭环在分段 shim 执行面下仍然保持稳定。
- 这再次确认了当前执行策略的主路径已经明确为“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”，不是临时救火流程，也不需要再回到人工补跑 generator 作为验收前提。

## update 2026-06-24 batch-44

### decision delta

70. 在 Streamline 官方站点存在限频或封禁风险时，当前可行执行策略仍然是小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback；这条执行边界已经在连续批次真实推进中成立，应继续作为默认策略。
71. 自动 registry 同步闭环在纯 `hotel-*` 连续批次里继续成立，说明分段 Playwright shim fallback 不仅适用于 mixed batch，也适用于同家族连续样本，因此这条路径已经是稳定可复用的执行路径。

### consequence delta

- batch-44 在 `hotel-bed-2`、`hotel-bed-bunk`、`hotel-one-star`、`hotel-three-star`、`hotel-two-star` 等连续样本上继续复现了自动同步与搜索消费跟进，说明这条闭环在同家族连续批次里依然稳定。
- 这进一步确认了系统 Chrome Playwright shim 分段 fallback 不只是应急恢复手段，而是可稳定复用的正式执行路径，后续不需要再将纯家族连续批次视作特殊场景。

## update 2026-06-24 batch-45

### decision delta

72. 在 streamlinehq 当前可访问但不适合高频脚本批量抓取的条件下，micro-solid tags 回填的稳定执行策略继续确认为“小规模 MCP 试探 + 系统 Chrome Playwright shim 分段 fallback”；这不是临时妥协，而是当前可持续推进的正式策略。
73. MCP 继续用于快速推进 pending 指针并识别空返回样本；对空返回样本采用低频真人化浏览器访问补齐，仍能在保持 failed 最终回到 0 的前提下推进 manifest。
74. Browser 插件句柄不可用时，系统 Chrome + Playwright shim 已证明可替代原 Browser 插件路径；但 shim 必须兼容 `tab.playwright.waitForLoadState({ state, timeoutMs })` 对象签名，不能直接透传字符串 `state`。
75. metadata runner 自动执行 registry 同步仍有效，批次后不需要人工单独补跑 shared-view generator；验收应直接以 `src/generated/streamline-shared-view-icons.mjs` 的 `tags/searchText` 与 `src/components/ViewTabs.tsx` 的 query 命中结果为准。

### consequence delta

- batch-45 在 `humidity-none`、`hurricane`、`hydro-energy`、`ice-cream`、`ice-cream-2`、`ice-cream-3`、`id-face-scan-1`、`id-face-scan-2` 等样本上继续复现了自动同步与搜索消费跟进，说明这条闭环在当前访问约束下仍然稳定。
- 这也把本轮的执行边界和验收边界进一步压实为：MCP 负责快速推进与筛空，shim 负责低频补洞，验收直接看生成产物与 `ViewTabs.tsx` 的 query 命中，不再回到人工补跑 generator。

## update 2026-06-24 batch-46

### decision delta

76. 当前回填目标正式收窄为只推进 micro-solid，不再把 micro-line 作为本轮或后续同类 pending 批次的处理对象。
77. shared-view generated registry 仍可作为统一搜索验收面，但 round-level 验收证据必须只取 micro-solid 条目，避免把 line 条目混入“当前正在处理 solid”的结论里。
78. 对 `id-finger-print`、`id-finger-print-scan`、`id-iris-scan-alternate`、`id-iris-scan-check`、`id-thumb-mark`、`id-user`、`id-voice-1`、`id-voice-2` 这一组样本，稳定执行路径仍是：MCP 试探只负责推进 pending 指针和识别空返回样本，随后系统 Chrome Playwright shim 按 `3 + 3 + 2` 低频真人化 fallback 补齐。
79. 本轮再次证明自动 registry 同步后，micro-solid `searchText` 可以直接支撑 `fingerprint`、`ocular`、`electrocardiogram` 这类条目级查询命中，不需要人工补跑 generator。

### consequence delta

- batch-46 只把 micro-solid 的 8 个 `id-*` pending 样本推进并验收，说明回填对象和 round-level 证据都已从此收窄到 solid，line 条目不再进入本轮结论范围。
- 这也再次确认了当前稳定执行路径没有变化：MCP 负责筛空和指针推进，系统 Chrome Playwright shim 负责按 `3 + 3 + 2` 补齐判空样本，而验收直接看 micro-solid 的生成产物与 query 命中，不需要人工补跑 generator。

## update 2026-06-24 batch-47

### decision delta

80. 当前回填目标继续只推进 micro-solid，不处理 micro-line。
81. 对 `image-bottom`、`image-brightness`、`image-highlights`、`image-in-circle`、`image-left`、`image-picture-flower`、`image-picture-gallery`、`image-picture-landscape-1` 这一组样本，稳定执行路径仍是：MCP 试探只负责推进 pending 指针和识别空返回样本，随后系统 Chrome Playwright shim 按 `3 + 3 + 2` 低频真人化 fallback 补齐。
82. image 语义簇下的搜索验收仍应坚持 micro-solid 子集和条目级 query 证据；例如 `floral -> image-picture-flower`、`polarity -> image-brightness`、`correspondence -> image-left`，而 `horizon` 这类宽词可能出现历史样本竞争，不适合作为唯一验收词。
83. 本轮再次证明自动 registry 同步后，micro-solid `searchText` 可以直接支撑 image 语义簇的条目级查询命中，不需要人工补跑 generator。

### consequence delta

- batch-47 在 `image-bottom`、`image-brightness`、`image-picture-flower`、`image-picture-gallery`、`image-picture-landscape-1` 等样本上继续复现了自动同步与搜索消费跟进，说明这条闭环在 image 语义簇下仍然稳定。
- 这也进一步确认了 image 语义簇验收必须收窄到 micro-solid 子集和条目级 query；宽泛关键词如果会引入历史样本竞争，就只能作为辅助观察，不能作为唯一验收词。

## update 2026-06-24 icon-picker-family-regression

### decision delta

84. shared view icon picker 的 family 标签显示完全依赖 `src/generated/streamline-shared-view-icons.*`；一旦 generated registry 退化为空，`micro-line`、`micro-solid`、`core-solid` 三个 family 分组会整体消失，即使 manifest 记录完整、`vendor/streamline-svg/*` 本地 SVG 资产也都存在。
85. 这类回归的正式防线应放在 generated registry 回归测试和 e2e family 分组断言上，优先证明生成产物仍然携带 family groups / labels，而不是把问题误判成导出资产缺失或只盯着 manifest success 数量。

### consequence delta

- 生成器测试需要继续覆盖 family label、group count、空 registry 回归和 `Core S` 命名稳定性，确保 `src/generated/streamline-shared-view-icons.*` 不会悄悄退化为空数组。
- e2e 侧需要显式断言 icon picker 顶部 family 标签仍然出现 `Line`、`Solid`、`Core S` 等分组，避免只验证单个图标条目而漏掉分组级回归。
- 对这类问题的排障路径应先查 generated registry，再查 picker 消费层，最后才考虑导出资产；`manifest` 和本地 SVG 完整并不能单独证明 family 分组还在。

## update 2026-06-24 stable-prefix-batch1

### decision delta

86. 批次 1 的正式处理范围只覆盖 micro-solid 的 `layout`、`mail`、`phone` 三个稳定前缀簇，不再把 `navigation`、`search`、`menu`、`watch` 纳入同轮回写。
87. 批次 1 采用显式 `profile` 规则生成 `suggestedTags`，规则骨架固定为“主体骨架 + 子动作词 + 黑名单”，并要求先出 dry-run 再做真实 apply；后续同类稳定前缀提升应沿用这一门路，而不是回退到网页抓取。
88. 批次 1 已真实回写 `56` 条 tags，使 `micro-solid` manifest 的 `success` 从 `937` 增至 `993`、`pending` 从 `967` 降至 `911`，并在 registry 重建后验证 `searchText` 已吸收新增 tags。

### consequence delta

- `layout`、`mail`、`phone` 这类高重复稳定前缀簇可以用显式 profile 批量收敛，批次内不需要扩大到其他 `review_required` 项。
- dry-run 作为 apply 前置门禁能够稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `layout-border-center`、`mail-search`、`phone-signal-low` 已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路已进入消费侧。
- 后续稳定前缀推进应继续拆批，不应将 `navigation`、`search`、`menu` 或需要子簇拆分的 `watch` 混入批次 1。

## update 2026-06-24 stable-prefix-batch2

### decision delta

89. 批次 2 的正式处理范围只覆盖 micro-solid 的 `navigation`、`search`、`menu` 三个稳定前缀簇，不再扩大到其他 `review_required` 项。
90. 批次 2 继续采用显式 `profile` 规则生成 `suggestedTags`，其中 `navigation` 走显式白名单，不再受原始 `0.77 confidence` 阻断；同轮回写仍然必须先完成 dry-run，再执行真实 apply。
91. 批次 2 已真实回写 `21` 条 tags，使 `micro-solid` manifest 的 `success` 从 `993` 增至 `1014`、`pending` 从 `911` 降至 `890`，并在 registry 重建后验证 `searchText` 已吸收新增 tags。

### consequence delta

- `navigation`、`search`、`menu` 这类稳定前缀簇继续证明可以用显式 profile 批量收敛，批次内不需要扩大到其他 `review_required` 项。
- dry-run 继续作为 apply 前置门禁，稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `navigation`、`search`、`menu` 对应的条目已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路继续进入消费侧。
- 后续稳定前缀推进仍应保持拆批，不应把需要子簇拆分的 `watch` 混入本轮结论。

## update 2026-06-24 stable-prefix-batch4

### decision delta

92. 批次 4 的正式处理范围只覆盖 micro-solid 的 `number` 稳定前缀簇，不再把其他 `review_required` 项混入同轮回写。
93. 批次 4 继续采用显式 `profile` 规则生成 `suggestedTags`，规则骨架固定为“数字本体 + 外形变体（plain、circle、square）+ `digit`/`symbol`”，并要求先出 dry-run 再做真实 apply；后续同类稳定前缀提升应沿用这一门路，而不是回退到网页抓取。
94. 批次 4 已真实回写 `30` 条 tags，使 `micro-solid` manifest 的 `success` 从 `1023` 增至 `1053`、`pending` 从 `881` 降至 `851`，并在 registry 重建后验证 `searchText` 已吸收新增 tags。

### consequence delta

- `number` 这类稳定前缀簇可以继续用显式 profile 批量收敛，批次内不需要扩大到其他 `review_required` 项。
- dry-run 继续作为 apply 前置门禁，稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `number-zero-circle`、`number-two-square`、`number-six-circle` 这类条目已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路已经进入消费侧。
- 后续稳定前缀推进仍应保持拆批，不应把需要额外形态拆分的其他簇混入本轮结论。

## update 2026-06-24 stable-prefix-batch5

### decision delta

95. 批次 5 的正式处理范围只覆盖 micro-solid 的 `warning` 稳定前缀簇，不再把其他 `review_required` 项混入同轮回写。
96. 批次 5 继续采用显式 `profile` 规则生成 `suggestedTags`，规则骨架固定为“告警本体 + 形状变体（circle、diamond、octagon、shield、square、triangle）+ `alert`/`notification`/`attention`/`caution`/`exclamation`/`bubble`”，并要求先出 dry-run 再做真实 apply；后续同类稳定前缀提升应沿用这一门路，而不是回退到网页抓取。
97. 批次 5 已真实回写 `6` 条 tags，使 `micro-solid` manifest 的 `success` 从 `1053` 增至 `1059`、`pending` 从 `851` 降至 `845`，并在 registry 重建后验证 `searchText` 已吸收新增 tags。

### consequence delta

- `warning` 这类稳定前缀簇可以继续用显式 profile 批量收敛，批次内不需要扩大到其他 `review_required` 项。
- dry-run 继续作为 apply 前置门禁，稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `warning-circle`、`warning-diamond`、`warning-octagon`、`warning-shield`、`warning-square`、`warning-triangle` 这类条目已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路已经进入消费侧。
- 后续稳定前缀推进仍应保持拆批，不应把需要额外形态拆分的其他簇混入本轮结论。

## update 2026-06-24 stable-prefix-batch6

### decision delta

98. 批次 6 的正式处理范围只覆盖 micro-solid 的 `share` 稳定前缀簇，不再把其他 `review_required` 项混入同轮回写。
99. 批次 6 继续采用显式 `profile` 规则生成 `suggestedTags`，规则骨架固定为“`share` 主体 + 子语义词 + 黑名单”，其中 `code`、`hand-lock`、`heart`、`link-approved`、`link-circle`、`link-lock`、`symbol`、`user` 八个子语义分别生成可回写 suggestions；同轮回写仍然必须先完成 dry-run，再执行真实 apply。
100. 批次 6 已真实回写 8 条 tags，使 `micro-solid` manifest 的 `success` 继续增长、`pending` 相应下降，并在 registry 重建后验证 `searchText` 已吸收新增 tags。

### consequence delta

- `share` 这类稳定前缀簇可以继续用显式 profile 批量收敛，批次内不需要扩大到其他 `review_required` 项。
- dry-run 继续作为 apply 前置门禁，稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `share-code`、`share-hand-lock`、`share-heart`、`share-link-approved`、`share-link-circle`、`share-link-lock`、`share-symbol`、`share-user` 这类条目已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路继续进入消费侧。
- 后续稳定前缀推进仍应保持拆批，不应把需要额外形态拆分的其他簇混入本轮结论。

## update 2026-06-24 stable-prefix-batch7

### decision delta

101. 批次 7 的正式处理范围只覆盖 micro-solid 的 `time` 稳定前缀簇，不再把其他 `review_required` 项混入同轮回写。
102. 批次 7 继续采用显式 `profile` 规则生成 `suggestedTags`，规则骨架固定为“`time` 主体 + 子语义词 + 黑名单”，其中 `alarm`、`clock-circle`、`clock-hand`、`clock-square`、`history-off`、`hour-glass`、`lapse`、`midnight`、`digits`、`reset`、`timer` 这组子语义分别生成可回写 suggestions；其中 `digits` 落到 `nine`、`six`、`three` 三个条目。同轮回写仍然必须先完成 dry-run，再执行真实 apply。
103. 批次 7 已真实回写 13 条 tags，使 `micro-solid` manifest 的 `success` 继续增长、`pending` 相应下降，并在 registry 重建后验证 `searchText` 已吸收新增 tags。

### consequence delta

- `time` 这类稳定前缀簇可以继续用显式 profile 按子语义拆批收敛，批次内不需要扩大到其他 `review_required` 项。
- dry-run 继续作为 apply 前置门禁，稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `time-alarm`、`time-clock-circle`、`time-clock-hand`、`time-clock-square`、`time-history-off`、`time-hour-glass`、`time-lapse`、`time-midnight`、`time-nine`、`time-reset`、`time-six`、`time-three`、`time-timer` 已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路继续进入消费侧。
- 后续稳定前缀推进仍应保持按前缀簇和子语义拆批，不应把需要额外形态拆分的其他簇混入本轮结论。

## update 2026-06-24 stable-prefix-batch8

### decision delta

104. 批次 8 的正式处理范围只覆盖 micro-solid 的 `user` 稳定前缀簇 `23` 条 `review_required` 项，不再把 wave2、wave3、wave4 或其他前缀簇混入同轮回写。
105. 批次 8 的 user 前缀簇正式采用显式 `profile` 规则生成 `suggestedTags`，并按 `add`、`block`、`check`、`circle`、`delete`、`edit`、`following`、`identifier-card`、`multiple`、`off`、`protection`、`question-query`、`refresh-sync`、`remove-subtract`、`search-magnifier`、`share`、`single`、`square`、`story`、`sync`、`team-community`、`warning` 等子语义收敛；同轮回写仍然必须先完成 dry-run，再执行真实 apply。
106. 从批次 8 开始，稳定前缀提升不再维护单批专用脚本骨架，而是接入 `promote-streamline-stable-clusters.mjs` 的通用 promotion engine 与 `stable-cluster-profiles.mjs` 的 profile 数据入口；本轮已真实回写 `23` 条 tags，并通过 registry / `searchText` 验证使 `micro-solid` labeled 从 `1080` 提升到 `1127`、unlabeled 从 `824` 降到 `777`。

### consequence delta

- `user` 这类稳定前缀簇可以继续用显式 profile 按子语义拆批收敛，批次内不需要扩大到 wave2 以后或其他 `review_required` 项。
- dry-run 继续作为 apply 前置门禁，稳定约束回写范围，避免把规则缺口直接写进 manifest。
- `user-add`、`user-search-magnifier`、`user-team-community`、`user-warning`、`user-refresh-sync` 这类条目已能在运行时 registry 中被新的 `searchText` 命中，说明这条规则链路继续进入消费侧。
- stable-prefix 的长期实现边界从批次 8 起正式迁移为“通用 promotion engine + profile 数据入口”，后续新批次应优先扩 profile，而不是回退到新的单批专用实现骨架。

## update 2026-06-24 stable-prefix-template-layer

### decision delta

107. `stable-cluster` 后续不再默认继续堆叠新的前缀专属 wrapper；新增稳定簇应优先走 `promote-streamline-stable-clusters.mjs` 的通用 `--cluster` 接口和 `stable-cluster-profiles.mjs` 的 profile 数据入口，只有模板层无法表达时才值得重新讨论新的专用实现形态。
108. `stable-cluster-profiles.mjs` 正式引入 `hasPart`、`hasAllParts`、`hasOrderedParts`、`tokenRule`、`allPartsRule`、`orderedRule`、`buildTagsFromTemplate` 作为模板层基础，把 object + action、object + state/shape、object + domain 等跨前缀组合沉淀为通用规则能力。
109. `user`、`shopping`、`laptop`、`list`、`location`、`wifi`、`music`、`pathfinder`、`play`、`print`、`screen`、`timer` 等现有多组 stable cluster 已正式迁移到模板规则层；这意味着后续维护重点从“继续追加前缀专属骨架”转为“扩充模板组合与 profile 数据”。
110. `zoom`、`light` 已通过通用 `--cluster` 接口直接接入模板层并完成 `11` 条真实回写，验证新增稳定簇不再需要新建专用 wrapper 文件；同时 `micro-solid` labeled 从 `1224` 提升到 `1235`、unlabeled 从 `680` 降到 `669`，并已通过 registry / `searchText` 抽样证明模板层输出可进入真实消费链路。

### consequence delta

- 稳定前缀提速的长期默认策略正式变为“模板 helper + profile 数据 + 通用 `--cluster` 接口”，而不是继续线性堆叠批次脚本或前缀 wrapper。
- 后续新增 stable cluster 的工程成本应主要落在 profile 编排与抽样验证，而不是复制一整套专用规则骨架；这也是判断是否需要新实现形态的默认基线。
- 现有 stable cluster 已完成模板层迁移后，模板 helper 的表达能力本身成为新的维护边界；若出现规则缺口，应先补模板原语，再决定是否需要额外例外机制。
- `zoom` / `light` 的 `11` 条真实回写与 registry / `searchText` 命中证明：模板层不仅适用于迁移存量簇，也足以承接新增簇接入，且能直接降低新增簇的实现与验证成本。

## update 2026-06-25 stable-cluster-next-round

### decision delta

111. 下一轮 stable-cluster 的默认自动回写范围固定为 `pathfinder`、`shopping`、`scroll`、`shield`、`sign` 五个语义稳定簇；`medical`、`sim`、`webcam`、`threat` 等高噪音簇继续暂缓，不进入自动回写。
112. 对已有 profile 但覆盖不足的稳定簇，正式补强路径是继续扩展 `stable-cluster-profiles.mjs`，并复用 `promote-streamline-stable-clusters.mjs` 的通用 `--cluster` 入口；新接入稳定簇同样优先走这条通路，不再新增批次专用 wrapper。
113. stable-cluster 每轮接入后的正式落盘合同保持为：先生成独立 suggestions / report，再顺序执行真实 apply、generated registry 重建和 `searchText` 抽样验证；这些步骤必须串行收口，避免旧数据覆盖新统计。
114. 本轮五簇真实回写 `22` 条 tags 后，`micro-solid` 统计从 `labeled=1259 / unlabeled=645 / reviewRequired=351` 收敛到 `labeled=1281 / unlabeled=623 / reviewRequired=328`；这确认“profile 扩展 + 通用 cluster 入口”可以继续作为下一轮稳定簇推进的默认增量模式。

### consequence delta

- 稳定簇的默认推进顺序已经从“先找可做前缀再写专用脚本”进一步收敛为“先筛稳定簇、暂缓高噪音簇、直接补 profile 并走通用 `--cluster` 接口”。
- `pathfinder`、`shopping`、`scroll`、`shield`、`sign` 这类簇可以继续按同一模板层合同滚动扩展，而 `medical`、`sim`、`webcam`、`threat` 等簇在语义边界未收敛前不应混入批量机自动回写结果。
- 顺序 apply、registry 重建和 `searchText` 抽样验证继续构成 stable-cluster 批量机的正式验收闭环；只更新 suggestions 而不完成这条闭环，不应视为可沉淀成果。

## update 2026-06-25 baseline-full-pass-switch

### decision delta

115. 大规模标签推进的默认主路线正式切换为 baseline 铺底模式：继续复用现有 `suggest/apply/generate-registry` 主链路，但建议生成改为以 `itemId` / `name` 的机械拆词和少量低风险同义补词为主，优先把 family 级可搜索 tags 全量铺满，而不是再把高精度小批回写当成默认主流程。
116. baseline 模式必须支持 `includeLabeled` 全量重写；当同义补词收窄、污染修补或 family 级语料策略调整时，应直接整包重刷目标 family，而不是新增清洗脚本、旁路迁移或手工逐条修正。
117. baseline 铺底继续沿现有 CLI 入口串行收口：先生成 suggestions，再执行真实 apply，随后重建 generated registry 并抽样验证 `searchText`；同一入口必须可直接复用于 `micro-solid` 收口和 `core-solid` 下一轮铺底，不再分叉出新旁路脚本。
118. 运行时 `searchText` 验证若涉及 `src/generated/streamline-shared-view-icons.mjs`，应优先重新加载 generated 模块或直接检查生成文件内容；同进程重复 `import()` 命中的旧模块缓存不能作为 generator 回归证据。

### consequence delta

- baseline 铺底模式成为默认主路线后，剩余 `unlabeled` 项的收敛速度不再依赖高频小批人工挑样，而是依赖统一建议链路的低风险全量覆盖能力。
- `includeLabeled` 全量重写把 family 级语料纠偏收敛为同一条正式链路；后续若要收窄同义词、修复污染或统一口径，默认动作应是整包重刷，而不是再补一次性清洗工具。
- `micro-solid` 与 `core-solid` 共用同一 CLI 入口后，后续 family 切换只应体现在输入范围与抽样验收上，不应复制新的建议/应用脚本骨架。
- 本轮完成后，baseline 全量重写已把 `micro-solid` `1904` 条与 `core-solid` `5603` 条都收敛到 `unlabeled=0`；后续验收仍以真实 `manifest` 结果和 generated `searchText` 命中为准，而不是以内存缓存中的旧导入结果裁决。

## search terms

`Streamline`、`manifest-store`、`loadManifest`、`updateManifestItemMetadata`、`metadataStatus`、`tags`、`status`、`attempts`、`extractedAt`、`streamlineApi`、`getIconDetailsBySlugAndSubcategoryId`、`searchText`、`sharedViewIconGroups`、`sharedViewIconRegistry`、`streamlineSharedViewIcons`、`Core S`、`icon picker`、`Chrome browser session runner`、`stable prefix`、`layout`、`mail`、`phone`、`navigation`、`search`、`menu`、`number`、`digit`、`circle`、`square`、`plain`、`warning`、`share`、`code`、`hand-lock`、`heart`、`link-approved`、`link-circle`、`link-lock`、`symbol`、`user`、`time`、`alarm`、`clock-circle`、`clock-hand`、`clock-square`、`history-off`、`hour-glass`、`lapse`、`midnight`、`nine`、`six`、`three`、`reset`、`timer`、`explicit profile`、`suggestedTags`、`dry-run apply`、`stable-cluster`、`promotion engine`、`profile data`、`promote-streamline-stable-clusters`、`stable-cluster-profiles`、`hasPart`、`hasAllParts`、`hasOrderedParts`、`tokenRule`、`allPartsRule`、`orderedRule`、`buildTagsFromTemplate`、`template layer`、`wrapper`、`--cluster`、`zoom`、`light`、`baseline`、`includeLabeled`、`full rewrite`、`full pass`、`micro-solid`、`core-solid`、`suggest-streamline-tags`、`promote-streamline-stable-prefix-batch1`、`promote-streamline-stable-prefix-batch2`、`promote-streamline-stable-prefix-batch3`、`promote-streamline-stable-prefix-batch4`、`promote-streamline-stable-prefix-batch5`、`promote-streamline-stable-prefix-batch6`、`promote-streamline-stable-prefix-batch7`、`promote-streamline-stable-prefix-batch8`
