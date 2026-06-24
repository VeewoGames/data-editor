# Streamline micro-solid tags 自动补全链路第一版实现

status: accepted

## context

`micro-solid` tags 自动补全第一版已经从官网大批量抓取切换为离线自动补全主路线。第一版的输入面固定为官方已标注样本、名称词汇和本地 SVG，目的是先把链路收敛成可批处理、可复核、可稳定输出的版本。

第一版只做受控候选，不做自由生成：候选标签只允许来自现有官方 tags 词表；名称词汇证据优先，SVG 结构特征只允许作为加分信号，不允许单独驱动建议。

## decision

1. `micro-solid` tags 自动补全第一版的主路线固定为离线链路，不再把官网大批量抓取作为正式生产路径。
2. 第一版候选词表只允许来自现有官方 tags 受控词表，不引入额外自由词汇。
3. 生成建议时，名称词汇证据优先，SVG 结构特征只做辅助加分，不允许单独形成推荐。
4. 自动接受门禁要求至少两个强词汇近邻共同支持；单一近邻或仅 SVG 相似度不足以进入自动接受。
5. 第一版只生成建议文件和证据文件，不直接回写 manifest。

## consequences

- 离线链路可以在本地批处理环境稳定运行，输出结构也更容易固定和回归测试。
- 受控词表和双强词汇门禁会让第一版更保守，自动接受率不会追求激进覆盖，但能降低误配风险。
- 由于第一版不直接回写 manifest，后续仍保留人工或二阶段审阅入口，建议文件将作为正式过渡产物。
- 实跑结果已验证这条门禁是可用的：`29 auto_accept / 647 review_required / 369 reject`。

## auto_accept 回写

1. `micro-solid` 的正式回写范围只包含 `decision=auto_accept` 且 `suggestedTags` 非空的建议，不处理 `review_required`、`reject` 或 `micro-line`。
2. 正式回写入口固定为 `scripts/streamline-export/apply-streamline-tag-suggestions.mjs`，用于把 auto_accept 结果批量落到 `micro-solid-full.manifest.json`。
3. dry-run 与正式 apply 的结果一致，均为 `appliedCount=29`、`skippedCount=1016`。
4. 正式回写后，manifest metadata summary 变为 `total=1904`、`pending=1014`、`success=888`、`failed=2`、`withTags=888`。
5. 这表示在原 `859` 个已标注项基础上，新增 `29` 个高置信标签回写。
6. 回写报告产物为 `artifacts/streamline-export/micro-solid-auto-accept-apply-report.json`。
7. 当前回写规则是：只把满足 `decision=auto_accept` 且 `suggestedTags` 非空的建议写回 manifest，`metadataStatus` 记为 `success`，`metadataUpdatedAt` 使用本次 apply 时间。

## registry 消费验证

1. 回写后 shared-view registry 已重建，`src/generated/streamline-shared-view-icons.mjs` 与对应 `.d.ts` 已更新。
2. 对 29 个已回写条目做生成产物校验后，`missingIconEntries=0`、`tagMismatchCount=0`、`searchMissCount=0`。
3. 代表性命中样本包括 `indifferent-face-smiley`、`laptop-favorite-heart`、`mail-favorite-heart`。
4. 最终验证结果为 `npm run test:streamline-export 116/116` 通过。

## review_required 二次门禁

1. `micro-solid` 的二次门禁范围只处理 `review_required`，不处理 `reject`、`micro-line`，也不回退已落地的 `auto_accept`。
2. 新增的二次门禁脚本是 `scripts/streamline-export/promote-streamline-review-required.mjs`，对应测试为 `tests/streamline-export/promote-streamline-review-required.test.mjs`。
3. 二次门禁输入规模为 `647` 条 `review_required`。
4. 二次门禁规则包含 `confidence >= 0.77`、`nameNeighbors >= 2`、`imageNeighbors >= 2`、`suggestedTags` 对 `itemId` 的语义 token 覆盖数 `>= 2`、primary semantic token 必须被 `suggestedTags` 覆盖。
5. `blocked drift tags` 会阻断提升，包含但不限于 `finance`、`payment`、`atm`、`catholicism`、`christianity`、`entertainment`、`gaming`、`favorite`、`flight`。
6. promotion 输出的 `suggestedTags` 会先做 `blocked drift` 清洗，再截断到前 `8` 个。
7. 二次门禁结果为 `647 -> 44 promoted / 603 rejected`。
8. 生成的产物包括 `artifacts/streamline-export/micro-solid-review-required-promotion-report.json`、`artifacts/streamline-export/micro-solid-review-required-promoted-suggestions.json`、`artifacts/streamline-export/micro-solid-review-required-apply-dry-run.json`。
9. 正式回写后，manifest metadata summary 变为 `total=1904`、`pending=970`、`success=932`、`failed=2`、`withTags=932`。
10. 这表示在上一轮 `888` 的基础上，再新增 `44` 条高置信回写。
11. 回写报告产物为 `artifacts/streamline-export/micro-solid-review-required-apply-report.json`。
12. 回写后 registry 已重建；对 `44` 条 promoted 候选做生成产物校验后，`tagMismatchCount=0`、`searchMissCount=0`。
13. 最终验证结果为 `npm run test:streamline-export 119/119` 通过。

## review_required 二次门禁

1. `review_required` 不再按单条人工逐一放行，而是通过显式二次门禁批量提升到下一批可回写候选。
2. 二次门禁的稳定规则是双近邻支持、双语义 token 覆盖、primary token 命中和 blocked drift tags 拦截，四者共同决定是否允许 promotion。
3. promotion 产物在回写前必须先清洗 blocked drift tags，并将候选 tags 截断到前 `8` 个，以降低 searchText 污染风险。
4. 只有通过二次门禁的 promotion 候选才允许进入 manifest 回写与 registry 重建；`review_required` 之外的 `reject` 仍不在本轮处理范围。
5. 本轮实际从 `647` 条 review_required 中提升出 `44` 条 promoted，说明这套二次门禁可以作为批量提升的稳定前置层。

## batch 48 offline cutover

1. 批次 `48` 已正式从旧的网页 / MCP 回填 + Chrome Playwright shim fallback 路线切换为《docs/plans/2026-06-24-Streamline标签自动补全策略指南.md》定义的离线自动补全路线。
2. `claw plan edit` 已同步更新本轮 `goal`、`requirements`、`tasks`、`references`、`rules`、`keyDecisions`，后续主路径不再继续执行真实网页访问、MCP 试探或 Chrome fallback。
3. 当前 `review_required` promotion 门禁仍会漏出 `religion`、`dangerous`、`rating` 一类语义漂移 tag，因此本轮只把 `auto_accept` 作为默认回写面，不直接信任 `promoted` 全量产物。
4. promotion 产物在回写前必须清洗 blocked drift tags，并截断到前 `8` 个，以降低 `searchText` 污染风险；这条规则在 batch `48` 继续成立。
5. 本轮仅回写最保守的 `5` 条 `auto_accept`，回写脚本为 `scripts/streamline-export/apply-streamline-tag-suggestions.mjs`；`review_required` 与 `reject` 保持未回写。
6. 旧网页路线中断时给 `inbox` / `inbox-open` 留下的本地 shim 兼容错误属于本地 fallback 适配问题，不是站点失败；本轮已通过 manifest API 把这两项恢复为 `pending`，避免旧路线脏状态污染新的离线批次。
7. `src/generated/streamline-shared-view-icons.mjs` 曾短暂被空数组覆盖，但同进程直接调用生成器仍返回 `icons=9535`、`groups=3`，说明更像外部覆盖或竞态，而不是生成器计算为空，后续需要排查覆盖源。
8. 本轮验证必须同时看 manifest 与运行时消费面：生成后的 shared-view registry 中 `tags` 和 `searchText` 都要命中新标签，且 `npm run test:streamline-export` 继续通过。
9. 当前 manifest 收敛到 `success=937`、`pending=967`、`failed=0`、`withTags=937`，说明离线切线后批次 48 仍能把真实成功项继续写回，并保持无新增 failed。
10. 批次 48 的新增成功为 `5` 条，运行时搜索命中与 `npm run test:streamline-export 119/119` 已验证，说明离线回写 + registry 重建 + search 消费闭环继续成立。

## pending 分层盘点

1. 当前 `micro-solid` manifest 真实状态为 `total=1904`、`pending=967`、`success=937`、`failed=0`、`withTags=937`。
2. 剩余 `pending` `967` 条已被当前 suggestions 全覆盖，没有“完全没有建议”的空白项，说明当前问题已经从“补建议生成”转为“分层消费已有建议”。
3. `pending` 的当前 decision 分布为 `review_required=621`、`reject=346`、`auto_accept=0`、`promotedPending=0`、`noSuggestion=0`。
4. 当前高数量 `review_required` 的置信带分布为 `>=0.77` `474` 条、`0.70-0.76` `53` 条、`0.63-0.69` `64` 条、`<0.63` `30` 条，说明高置信并不自动等于可直接回写。
5. 高数量 `review_required` 前缀中，`layout`、`mail`、`phone`、`watch`、`navigation`、`search`、`menu` 更适合继续做规则工程；`number`、`time`、`text`、`list`、`share`、`laptop`、`user` 虽然数量大且置信高，但更容易出现方向词、`button` / `hamburger`、`rating` / `favorite` 等误导标签，需要先加更严格门禁。
6. 当前最适合继续自动提升的稳定前缀簇是 `layout 27`、`mail 15`、`phone 14`、`watch 9`、`navigation 8`、`search 6`、`menu 6`，合计约 `85` 条，这些簇的候选 tags 在家族内高度重复，适合下一轮通过更细粒度规则做批量收敛。
7. 需人工规则复核的主体是剩余 `review_required` 中的其余约 `536` 条；这些条目 often 有中高置信候选，但容易出现语义漂移或跨家族泛化，例如 `incognito-mode` 被推到 `aircraft` / `astronomy` / `celestial`，`time-*` 混入 `flight` / `rating` / `favorite`，`text-*` 混入 `hamburger` / `button` / `navigation`，`share-*`、`laptop-*`、`user-*` 也经常带泛化词。
8. `reject` 层当前为 `346` 条，代表维持空缺更安全；典型项包括 `inbox` / `inbox-open` / `inbox-post` / `inbox-tray-*`、`indent-left` / `indent-right`、`ios-ipados`、`iphone`、`iron`、`investing-and-banking`，在缺少新规则或外部真值前不建议强补。
9. 下一轮不应扩大 `review_required` 全量放行，而应优先针对稳定前缀簇做规则工程收敛；`reject` 层在没有新增规则或外部真值前继续维持空缺。

## stable prefix execution list

1. 稳定前缀簇已经从抽象优先级落成了可执行清单，新增实施文档为 `docs/plans/2026-06-24-Streamline稳定前缀簇下一轮实施清单.md`。
2. 当前最稳定的一批前缀簇是 `layout 27`、`mail 15`、`phone 14`、`watch 9`、`navigation 8`、`search 6`、`menu 6`，合计约 `85` 条。
3. 下一轮规则工程应采用三段式规则：`主体骨架 + 子动作词 + 黑名单`，而不是只按前缀整体放行。
4. `layout` 的主体骨架应保留 `layout/dashboard/widgets/arrangement/frame/grid`，并过滤 `arrow`、`travel`、`flight`、`favorite`。
5. `mail` 的主体骨架应保留 `message/communication/email/envelope/mail/inbox`，动作词按 `add/check/lock/read` 子语义追加，过滤 `all`、`affection`、`bookmark`、`bubble`。
6. `phone` 的主体骨架应保留 `phone/call/contact/telephone/communication`，按 `off/ringing/book/mobile` 追加，过滤 `android`、`assistance`、`device`。
7. `watch` 不能整簇共用，必须拆成 `charging/download/upload/time/disable` 子簇，过滤 `flight`、`travel`、`abstract`、`design`、`bubble`、`chat`。
8. `navigation` 应压缩成 `direction/navigation/arrow` 主体，只按方位、分叉、禁用追加，过滤 `dashed`、`click`、`cursor`、`backward`、`point`。
9. `search` 应保留 `search/find/lookup` 主体，过滤 `app`、`apps`、`browser`、`programming`、`research`、`explore`。
10. `menu` 应保留 `menu/navigation/options/interface` 主体，按 `horizontal/vertical/line/alternate` 子语义追加，过滤 `button`、`app`、`dots`。
11. 推荐执行顺序为：批次 `1` 先做 `layout + mail + phone`，批次 `2` 再做 `navigation + search + menu`，批次 `3` 单独处理 `watch`。
12. 这个顺序的原因是先吃数量高且模式稳定的簇，再处理结构类轻门禁簇，最后处理必须拆子簇的 `watch`。

## stable prefix batching

1. 下一轮实施顺序已经固定为 `layout/mail/phone -> navigation/search/menu -> watch`，不再一次性混批。
2. `watch` 虽属于稳定前缀簇，但必须拆成 `charging/download/upload/time/disable` 子簇逐个处理，不能整簇共用一套 tags。
3. 稳定前缀簇的规则工程不应只按前缀整体放行，而应采用 `主体骨架 + 子动作词 + 黑名单` 三段式规则，把家族骨架和动作词分开控制。
4. 该轮抽象已经落成可执行实施清单文档：`docs/plans/2026-06-24-Streamline稳定前缀簇下一轮实施清单.md`，后续执行可以直接以该文档为输入。

## stable prefix batch1 closeout

1. 批次 `1` 的正式实现范围仅限 `micro-solid` 的 `layout`、`mail`、`phone` 三个稳定前缀簇，不扩展到 `navigation`、`search`、`menu`、`watch`。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch1.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch1.test.mjs`。
3. 批次 `1` 的 promotion 规则是：对 `review_required` 且 `confidence >= 0.99` 的样本，使用显式 profile 生成干净 tags；`layout`、`mail`、`phone` 各自维护主体骨架和子动作词，不再回网页抓 tags。
4. 测试验证结果为 `5/5` 通过，promotion 报告 `promotedCount=56`，dry-run apply `appliedCount=56`，真实 apply `appliedCount=56`。
5. 批次完成后，`micro-solid` manifest 的 metadataStatus 统计从 `success=937 / pending=967` 变为 `success=993 / pending=911`，说明这 `56` 条稳定前缀结果已经真实落盘。
6. 运行时 registry 消费验证也已通过，`layout-border-center`、`mail-search`、`phone-signal-low` 的 `searchText` 均已包含新增 tags，说明生成产物的搜索面同步成立。
7. 这轮结果进一步确认：稳定前缀簇可按“显式 profile + 家族骨架 + 子动作词”批量收敛，不需要回退到网页抓取，也不应把批次 `1` 的规则扩大到其他簇。

## stable prefix batch2 closeout

1. 批次 `2` 的正式实现范围仅限于 `micro-solid` 的 `navigation`、`search`、`menu` 三个稳定前缀簇，不扩展到 `watch` 及其他剩余 `pending`。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch2.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch2.test.mjs`。
3. 批次 `2` 的 promotion 规则是：对 batch2 suggestions 用显式 profile 生成干净 `tags`；`search` / `menu` 保持高置信度门槛，`navigation` 由于原始推荐器统一被噪音词拖低到 `0.77`，因此改为显式白名单前缀直接提升。
4. 测试验证结果为 `5/5` 通过，promotion 报告 `promotedCount=21`，dry-run apply `appliedCount=21`，真实 apply `appliedCount=21`。
5. 批次完成后，`micro-solid` manifest 的 `metadataStatus` 统计从 `success 993 / pending 911` 变为 `success 1014 / pending 890`，说明这 `21` 条稳定前缀结果已经真实落盘。
6. 运行时 registry 消费验证也已通过，`navigation-arrow-west`、`search-text`、`menu-alternate-vertical` 的 `searchText` 均已包含新增 `tags`，说明生成产物的搜索面同步成立。
7. 这一轮继续确认：稳定前缀批次应按分簇收敛，不要把 `watch` 混入当前批次，也不要把 batch2 的白名单提升策略外溢到其他 `pending`。

## stable prefix batch3 closeout

1. 批次 `3` 的正式实现范围仅限于 `micro-solid` 的 `watch` 前缀簇，不扩展到其他稳定前缀或剩余 `pending`。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch3.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch3.test.mjs`。
3. 批次 `3` 的 promotion 规则是：对 `watch-*` 条目按 `charging`、`disable`、`download`、`upload`、`time` 五个子语义生成显式 profile；`watch` 不能整簇共用一套 tags，必须拆子簇处理，并过滤 `flight`、`travel`、`abstract`、`design`、`bubble`、`chat` 等漂移词。
4. 测试验证结果为 `5/5` 通过，promotion 报告 `promotedCount=9`，dry-run apply `appliedCount=9`，真实 apply `appliedCount=9`，说明这套显式 profile 可以稳定产出 `auto_accept` suggestions。
5. 批次完成后，`micro-solid` manifest 的 `metadataStatus` 统计从 `success 1014 / pending 890` 变为 `success 1023 / pending 881`，说明这 `9` 条稳定前缀结果已经真实落盘。
6. 运行时 registry 消费验证也已通过，`watch-circle-charging`、`watch-circle-download`、`watch-square-time` 的 `searchText` 已包含新增 `tags`，说明生成产物的搜索面同步成立。
7. 这一轮进一步确认：`watch` 必须作为独立子簇工程推进，后续不能再回到整簇共用 tags 的方案。

## stable prefix batch4 closeout

1. 批次 `4` 的正式实现范围仅限于 `micro-solid` 的 `number` 前缀簇，不扩展到其他稳定前缀或剩余 `pending`。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch4.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch4.test.mjs`。
3. 批次 `4` 的 promotion 规则是：将 `number` 统一收敛为 `digit` 与 `shape` 两层显式 profile，`shape` 只保留 `plain`、`circle`、`square`，并去掉原始推荐里的 `arrow`、`ascending`、`download` 等噪音词。
4. 测试验证结果为 `5/5` 通过，promotion 报告 `promotedCount=30`，dry-run apply `appliedCount=30`，真实 apply `appliedCount=30`，说明这套显式 profile 可以稳定产出 `auto_accept` suggestions。
5. 批次完成后，`micro-solid` manifest 的 `metadataStatus` 统计从 `success 1023 / pending 881` 变为 `success 1053 / pending 851`，说明这 `30` 条稳定前缀结果已经真实落盘。
6. 运行时 registry 消费验证也已通过，`number-zero`、`number-two-circle`、`number-nine-square` 的 `searchText` 已包含新增 `tags`，说明生成产物的搜索面同步成立。
7. 这一轮进一步确认：`number` 只在本批次内收敛，不应外溢到其他 `pending`，也不应把 `shape` 规则回退成更泛化的方向词集合。

## stable prefix batch5 closeout

1. 批次 `5` 的正式实现范围仅限于 `micro-solid` 的 `warning` 前缀簇，不扩展到其他剩余 `pending`。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch5.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch5.test.mjs`。
3. 批次 `5` 的 promotion 规则是：将 `warning` 统一收敛为 `warning + alert + caution/exclamation + shape` 这一显式骨架，并去掉 `bubble`、`chat`、`message` 等噪音词。
4. 测试验证结果为 `4/4` 通过，promotion 报告 `promotedCount=6`，dry-run apply `appliedCount=6`，真实 apply `appliedCount=6`。
5. 批次完成后，`micro-solid` manifest 的 `metadataStatus` 统计从 `success 1053 / pending 851` 变为 `success 1059 / pending 845`，说明这 `6` 条稳定前缀结果已经真实落盘。
6. 运行时 registry 消费验证也已通过，`warning-circle`、`warning-shield`、`warning-triangle` 的 `searchText` 已吸收新增 `tags`，说明生成产物的搜索面同步成立。
7. 这一轮进一步确认：`warning` 只在本批次内收敛，不应外溢到其他 `pending`，也不应把 `bubble`、`chat`、`message` 这类噪音词带回正式骨架。

## stable prefix batch6 closeout

1. 批次 `6` 的正式实现范围仅限于 `micro-solid` 的 `share` 前缀簇，不扩展到其他剩余 `pending`，也不把处理面扩到 `share` 之外。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch6.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch6.test.mjs`。
3. 批次 `6` 的 promotion 规则是把 `share` 拆成 `code`、`hand-lock`、`heart`、`link-approved`、`link-circle`、`link-lock`、`symbol`、`user` 八个子语义 profile，并去掉 `disabled`、`off`、`cash`、`care` 等漂移词。
4. 测试验证结果为 `5/5` 通过，promotion 报告 `promotedCount=8`，dry-run apply `appliedCount=8`，真实 apply `appliedCount=8`，说明这套显式 profile 可以稳定产出可落盘结果。
5. 批次完成后，`micro-solid` manifest 的 `metadataStatus` 统计从 `success 1059 / pending 845` 变为 `success 1067 / pending 837`，说明这 `8` 条稳定前缀结果已经真实落盘。
6. 运行时 registry 消费验证也已通过，`share-code`、`share-link-lock`、`share-user` 的 `searchText` 已吸收新增 `tags`，说明生成产物的搜索面同步成立。
7. 这一轮进一步确认：`share` 只能按子语义 profile 做稳定收敛，不应把 `disabled`、`off`、`cash`、`care` 这类漂移词带回正式骨架，也不应扩大到 `share` 之外的其他 `pending`。

## stable prefix batch7 closeout

1. 批次 `7` 的正式实现范围仅限于 `micro-solid` 的 `time` 前缀簇，不扩展到其他稳定前缀或剩余 `pending`。
2. 新增实现脚本为 `scripts/streamline-export/promote-streamline-stable-prefix-batch7.mjs`，对应测试为 `tests/streamline-export/promote-streamline-stable-prefix-batch7.test.mjs`。
3. 批次 `7` 的 promotion 规则是把 `time` 拆成 `alarm`、`clock-circle`、`clock-hand`、`clock-square`、`history-off`、`hour-glass`、`lapse`、`midnight`、`digits`、`reset`、`timer` 等显式子语义 profile，并去掉 `flight`、`travel`、`abstract` 这类漂移词。
4. 这批 profile 的实现方式是直接从 `itemId` 解析语义部件，再拼出干净 `tags`；其中 `time-alarm`、`time-clock-circle`、`time-history-off`、`time-nine` 是最稳定的代表性锚点。
5. 测试验证结果为 `5/5` 通过，promotion 报告 `promotedCount=13`，dry-run apply `appliedCount=13`，真实 apply `appliedCount=13`，说明这套显式 profile 可以稳定产出可落盘结果。
6. 批次完成后，`micro-solid` manifest 的 `metadataStatus` 统计从 `success 1067 / pending 837` 变为 `success 1080 / pending 824`，说明这 `13` 条稳定前缀结果已经真实落盘。
7. 运行时 registry 消费验证也已通过，`time-alarm`、`time-clock-circle`、`time-history-off`、`time-nine` 的 `searchText` 已吸收新增 `tags`，说明生成产物的搜索面同步成立。
8. 这一轮进一步确认：`time` 必须继续按子语义 profile 收敛，不能把 `flight`、`travel`、`abstract` 这类漂移词带回正式骨架，也不能把本轮规则外溢到其他剩余 `pending`。

## stable prefix batch8 closeout

1. 批次 `8` 的正式实现范围仅限于 `micro-solid` 的 `user` 前缀簇收口，不混入后续 `wave2` / `wave3` / `wave4`，也不把结论外溢到其他剩余 `pending`。
2. `user` 簇这轮共有 `23` 条 `review_required` 项被显式 profile 提升；规则入口为 `scripts/streamline-export/promote-streamline-stable-prefix-batch8.mjs`，具体 profile 锚点落在 `scripts/streamline-export/stable-cluster-profiles.mjs` 的 `stableClusterProfiles.user`。
3. 这一轮不再为 `user` 单独维护一套批次专用引擎，而是把规则迁移到 stable-cluster 通用引擎，通过 `promoteStableClusterSuggestion` / `promoteStableClusterSuggestions` 共用同一条提升链路，只由 `user` profile 定义标签骨架。
4. `stableClusterProfiles.user` 的长期规则是以 `user` 为主体骨架，再按 `add`、`block`、`check`、`delete`、`following`、`identifier-card`、`multiple`、`off`、`protection`、`question-query`、`refresh-sync`、`remove-subtract`、`search-magnifier`、`share`、`single`、`story`、`sync`、`team-community`、`warning` 等显式子语义补充 `tags`，并继续保持去重与最多 `8` 个标签的收口约束。
5. 批次 `8` 的 `23` 条建议已在 `wave1` 中完成真实回写；本轮权威结果不再看单独批次 dry-run，而是以 `artifacts/streamline-export/micro-solid-stable-prefix-wave1-apply.json`、manifest 真值和 registry 重建后的运行时消费为准。
6. 真实回写完成后，`micro-solid` labeled 从 `1080` 提升到 `1127`，unlabeled 从 `824` 降到 `777`，说明这 `23` 条 `user` 前缀结果已经真实落盘。
7. registry / `searchText` 验证也已成立；可复用样本锚点包括 `user-search-magnifier => user/search/find/magnifier`，以及 `user-warning => user/warning/alert`。
8. 这一轮进一步确认：`user` 前缀簇已经正式纳入 stable-cluster profile 工程，而不是继续沿用批次专用拼接逻辑；后续若继续做其他簇，应复用通用引擎并保持“显式 profile 收口 + manifest 真值 + registry/searchText 验证”的同一验收标准。

## stable cluster template layer closeout

1. stable-cluster profile 工程已经新增跨前缀模板层，主锚点仍在 `scripts/streamline-export/stable-cluster-profiles.mjs`；本轮新增 helper 包括 `hasPart`、`hasAllParts`、`hasOrderedParts`、`tokenRule`、`allPartsRule`、`orderedRule`、`buildTagsFromTemplate`。
2. 这层模板的长期职责是把“部件识别”“规则匹配”“标签骨架拼装”从各 profile 的逐个 `if/else` 中抽离出来，使 stable cluster 规则可以按模板声明，而不是继续堆叠批次专用分支。
3. 已迁移到模板 helper 的稳定簇至少包括 `user`、`shopping`、`laptop`、`list`、`location`、`wifi`、`music`、`pathfinder`、`play`、`print`、`screen`、`timer`；这些 profile 现在都通过 `buildTagsFromTemplate(...)` 和规则 helper 生成 tags，不再纯靠逐项条件分支。
4. `orderedRule` / `hasOrderedParts` 的存在说明这层模板不只处理“是否包含 token”，还正式支持带顺序约束的部件组合；当前可复用语义是把 `ordered parts` 判定纳入统一模板入口，而不是在单个 profile 内临时手写顺序判断。
5. 本轮模板化已覆盖后续稳定簇推进所需的批次脚本与 profile 锚点，包括 `stable_prefix_batch9`、`stable_prefix_batch10`、`stable_prefix_batch14`、`stable_prefix_batch15`、`stable_prefix_batch16` 对应的 profile 元数据继续统一收口在 `stableClusterProfiles`。
6. 相关验证面已覆盖 `tests/streamline-export/promote-streamline-stable-prefix-batch8.test.mjs`、`batch9.test.mjs`、`batch10.test.mjs`、`batch14.test.mjs`、`batch15.test.mjs`、`batch16.test.mjs`、`promote-streamline-stable-prefix-wave4.test.mjs`，以及 stable-cluster 通用用例；当前结论是模板层改造后这些相关测试均通过。
7. 这轮模板化的 durable 目标不是改变 manifest 真值或验收标准，而是降低新增稳定簇时的规则样板与维护成本；后续新增稳定簇应优先复用模板 helper 扩 profile，而不是回退到新开一套逐个 `if/else` 的批次实现。

## stable cluster machine wave1 closeout

1. 当前批量标注机的第一轮正式推进不再新增批次专用 wrapper，而是直接通过 `scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <name>` 接入下一批稳定簇。
2. 这轮新增接入的 stable-cluster profile 为 `lock`、`move`、`notepad`、`shipment`、`signal`，分别对应 `stable_prefix_batch25` 到 `stable_prefix_batch29`，锚点统一落在 `scripts/streamline-export/stable-cluster-profiles.mjs`。
3. 这五个簇的建议已分别产出独立 report / suggestions，并合并为 `artifacts/streamline-export/micro-solid-machine-wave1-suggestions.json`；真实回写结果落在 `artifacts/streamline-export/micro-solid-machine-wave1-apply.json`，本轮 `appliedCount=24`。
4. 本轮真实回写后，`micro-solid` 汇总从 `labeled=1235 / unlabeled=669 / reviewRequired=375 / suggested=394` 收敛到 `labeled=1259 / unlabeled=645 / reviewRequired=351 / suggested=370`，说明这套“通用 cluster 入口 + 模板 profile”已经继续压低待处理量。
5. manifest 真值验证已覆盖 `lock-shield`、`move-object-left`、`notepad-subtract`、`shipment-search`、`signal-graph-circle` 五个样本；这些条目的 `metadataStatus` 均为 `success`，且 tags 已按本轮规则落盘。
6. registry 搜索消费验证也已成立；上述五个样本在 `src/generated/streamline-shared-view-icons.mjs` 的运行时对象中都能看到新增 `tags`，且 `searchText` 已包含这些 tags，说明回写到生成产物的闭环成立。
7. 这一轮进一步确认：后续新增稳定簇的默认工程姿势应是“扩 `stableClusterProfiles` + 复用通用 `--cluster` 入口 + 合并 apply + 重建 registry + 抽样验证 searchText”，而不是继续复制新的批次专用脚本骨架。

## stable cluster next-wave scope

1. `machine-wave1` 已经通过 `scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <name>` 完成 `lock`、`move`、`notepad`、`shipment`、`signal` 五个簇的真实回写收口；下一轮范围确认应继续沿用同一 stable-cluster 通用入口，而不是回到批次专用脚本。
2. 下一轮范围筛选的权威输入仍然是 `artifacts/streamline-export/micro-solid-tag-suggestions.json` 中剩余的 `review_required`；应先按簇评估语义稳定性和噪音词密度，再决定是否扩进 `stableClusterProfiles`。
3. 本轮实际执行面已经固定为 `pathfinder`、`shopping`、`scroll`、`shield`、`sign` 五个簇；这五个簇都属于下一轮 stable-cluster 的正式处理范围，而不是仅停留在候选评估阶段。
4. `pathfinder` 与 `shopping` 在本轮属于已有 stable-cluster profile 的补覆盖收口，应继续沿用既有 profile / 模板层表达，不为它们新增批次专用 wrapper。
5. `scroll`、`shield`、`sign` 是本轮新增纳入的 stable-cluster profile；它们的长期锚点仍应落在 `scripts/streamline-export/stable-cluster-profiles.mjs`，并通过 `scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <name>` 接入统一 promotion / apply 链路。
6. `shield` 与 `sign` 虽然原始 suggestions 置信度高，但默认候选里会混入 `catholicism`、`christianity`、`dangerous`、`rating` 一类漂移词；本轮正式去噪边界是用显式 profile 直接重建干净 `tags`，而不是继承这些原始噪音词。
7. `medical`、`sim`、`webcam`、`threat` 继续排除在本轮自动回写之外；这些簇的建议面仍存在较重的跨域漂移，在没有更强约束前不应纳入 stable-cluster 批量提升面。
8. 因此，下一轮 stable-cluster 的默认工程策略保持不变：优先扩 `scripts/streamline-export/stable-cluster-profiles.mjs` 的 profile 能力，并复用 `scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <name>` 执行分簇 promotion、合并 apply 与后续 registry 验证；在模板层仍可表达的前提下，不再新增批次专用 wrapper。

## stable cluster machine wave2 suggestions

1. 下一轮 stable-cluster 的 suggestions 生成已经通过通用入口 `scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <name>` 完成，覆盖 `pathfinder`、`shopping`、`scroll`、`shield`、`sign` 五个簇；本轮没有新增任何批次专用 wrapper。
2. 五个簇都已生成独立 report / suggestions，数量分别为 `pathfinder=7`、`shopping=5`、`scroll=3`、`shield=4`、`sign=3`，合计产出 `22` 条 `auto_accept` 候选。
3. 本轮产物统一收口到 `artifacts/streamline-export/micro-solid-machine-wave2-*.json` 命名空间，用于与 `machine-wave1` 及更早批次隔离，避免覆盖旧批次 report、suggestions 或 apply 证据。
4. 对已有 profile 但覆盖不足的簇，例如 `pathfinder`、`shopping`，当前默认做法是继续补 profile 覆盖并复用原 cluster；这类收口不应触发新的 wrapper 设计。
5. 对本轮新增接入的 `scroll`、`shield`、`sign`，正式接入姿势仍然是直接扩 `scripts/streamline-export/stable-cluster-profiles.mjs` 并走通用 cluster 入口，而不是为新簇复制批次专用骨架。

## stable cluster machine wave2 closeout

1. `machine-wave2` 的完整实现继续沿用 stable-cluster 通用工程：补强已有 `pathfinder`、`shopping` profile 覆盖，并新增 `scroll`、`shield`、`sign` 三个 stable-cluster profile；整个过程始终复用 `scripts/streamline-export/promote-streamline-stable-clusters.mjs --cluster <name>`，没有新增专用 wrapper。
2. 本轮真实产物已经收口为 `artifacts/streamline-export/micro-solid-machine-wave2-suggestions.json` 与 `artifacts/streamline-export/micro-solid-machine-wave2-apply.json`；合并 suggestions 后正式 apply `22` 条，说明 wave2 已从“分簇生成候选”推进到“合并回写完成”。
3. 真实回写后，`micro-solid` 汇总从 `labeled=1259 / unlabeled=645 / reviewRequired=351 / suggested=370` 收敛到 `labeled=1281 / unlabeled=623 / reviewRequired=328 / suggested=348`，说明这轮 stable-cluster profile 补强与新增确实继续压低了待处理量。
4. manifest 真值样本验证已覆盖 `pathfinder-union`、`shopping-store-signage-1`、`scroll-up-down`、`shield-star-police-badge`、`sign-cross-shield`；这些条目均已写成 `metadataStatus=success`，且 tags 按本轮 profile 落盘。
5. generated registry 消费验证也已成立；上述样本在运行时对象中的 `tags` 与 `searchText` 都已吸收新标签，说明“manifest 回写 -> registry 重建 -> 搜索消费”闭环在 wave2 继续成立。
6. 这一轮进一步确认：stable-cluster 的后续提速默认策略仍然是“优先补 profile / 新增 profile + 复用通用 cluster 入口 + 合并 apply + 顺序重建 registry + `searchText` 抽样验证”，而不是回退到新的批次专用 wrapper 或并行分叉实现。

## related code

- `.claw/archive/tasks/Streamline-micro-solid-tags-自动补全链路第一版实现/plan.json`
- `.claw/tasks/Streamline-micro-solid-tags-pending并行推进批次-48/plan.json`
- `.claw/archive/tasks/Streamline-micro-solid-stable-prefix批次实施清单/plan.json`
- `.claw/tasks/Streamline-micro-solid-stable-prefix批次8规则实现/plan.json`
- `docs/plans/2026-06-24-Streamline稳定前缀簇下一轮实施清单.md`
- `docs/plans/2026-06-24-Streamline标签自动补全实现计划.md`
- `docs/plans/2026-06-24-Streamline标签自动补全策略指南.md`
- `scripts/streamline-export/build-streamline-tag-knowledge.mjs`
- `scripts/streamline-export/suggest-streamline-tags.mjs`
- `scripts/streamline-export/apply-streamline-tag-suggestions.mjs`
- `scripts/streamline-export/promote-streamline-review-required.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch1.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch2.mjs`
- `scripts/streamline-export/promote-streamline-stable-clusters.mjs`
- `scripts/streamline-export/stable-cluster-profiles.mjs`
- `artifacts/streamline-export/micro-solid-machine-wave1-suggestions.json`
- `artifacts/streamline-export/micro-solid-machine-wave1-apply.json`
- `artifacts/streamline-export/micro-solid-machine-wave2-*.json`
- `artifacts/streamline-export/micro-solid-machine-wave2-suggestions.json`
- `artifacts/streamline-export/micro-solid-machine-wave2-apply.json`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch3.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch4.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch5.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch6.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch7.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch8.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch9.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch10.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch14.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch15.mjs`
- `scripts/streamline-export/promote-streamline-stable-prefix-batch16.mjs`
- `scripts/streamline-export/promote-streamline-stable-clusters.mjs`
- `scripts/streamline-export/stable-cluster-profiles.mjs`
- `tests/streamline-export/apply-streamline-tag-suggestions.test.mjs`
- `tests/streamline-export/promote-streamline-review-required.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch1.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch2.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch3.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch4.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch5.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch6.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch7.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch8.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch9.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch10.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch14.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch15.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-batch16.test.mjs`
- `tests/streamline-export/promote-streamline-stable-prefix-wave4.test.mjs`
- `artifacts/streamline-export/micro-solid-auto-accept-apply-report.json`
- `artifacts/streamline-export/micro-solid-review-required-promotion-report.json`
- `artifacts/streamline-export/micro-solid-review-required-promoted-suggestions.json`
- `artifacts/streamline-export/micro-solid-review-required-apply-dry-run.json`
- `artifacts/streamline-export/micro-solid-review-required-apply-report.json`
- `artifacts/streamline-export/micro-solid-auto-accept-round2.json`
- `artifacts/streamline-export/micro-solid-auto-accept-round2-apply-report.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch3-suggestions.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch3-report.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch3-apply-dry-run.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch3-apply.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch5-report.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch8-report.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-batch8-suggestions.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-wave1-suggestions.json`
- `artifacts/streamline-export/micro-solid-stable-prefix-wave1-apply.json`
- `src/generated/streamline-shared-view-icons.mjs`
- `src/generated/streamline-shared-view-icons.d.ts`

## search terms

`micro-solid`、`auto-complete`、`offline suggestion`、`official tags`、`name evidence`、`SVG features`、`strong lexical neighbors`、`suggestion file`、`manifest writeback`、`time-alarm`、`time-clock-circle`、`time-history-off`、`time-nine`、`stable-cluster`、`buildTagsFromTemplate`、`tokenRule`、`orderedRule`、`user-search-magnifier`、`user-warning`
## baseline 铺底模式切换与 micro/core 全量收口

1. Streamline 大规模标签推进的默认主路线已经从“高精度小批回写”切换为 baseline 铺底模式；正式执行入口继续复用 `scripts/streamline-export/suggest-streamline-tags.mjs`、`scripts/streamline-export/apply-streamline-tag-suggestions.mjs` 与既有 registry 重建链路，不再把小批高精度回写当成主流程。
2. `scripts/streamline-export/suggest-streamline-tags.mjs` 现在正式支持 `--mode baseline` 与 `--include-labeled`。前者用于生成 baseline 铺底建议，后者用于把已标注项也纳入同一轮 suggestions，从而支持“先补齐无标签，再全量重写”的统一执行面。
3. baseline 模式的长期规则已经固定在 `scripts/streamline-export/lib/streamline-tag-suggestion-knowledge.mjs`：`buildBaselineTagsForItem(...)` 只依赖 `itemId` / `name` 的机械拆词和少量低风险补词，不依赖近邻推断、SVG 特征或外部真值抓取。
4. baseline 补词集必须保持保守，目标是先铺底、再避免 search 污染，而不是追求语义扩写。当前已确认需要从补词集中排除 `confirm`、`remove`、`disable`、`inactive` 这一类容易串到动作语义的别名；后续若继续扩补词，也应维持“低风险、弱歧义、可机械复核”的门槛。
5. `micro-solid` 已按这条主路线完成两轮正式推进：第一轮先铺满剩余 `623` 条无标签项，第二轮再通过 `--include-labeled` 对全量 `1904` 条做统一重写；当前 `micro-solid` 已收敛为 `1904 / 1904` 全量有 tags。
6. `core-solid` 也已通过同一入口完成 baseline 写回收口，当前收敛为 `5603 / 5603` 全量有 tags。这个结果说明 baseline 铺底入口已经不是 `micro-solid` 特例，而是可直接复用到 `core-solid` 的通用执行面。
7. 这轮收口后，manifest 抽样与 generated `searchText` 仍然是正式验收面，但 `searchText` 验证必须注意 Node 同进程 `import()` 模块缓存边界：如果在同一进程里重复导入 generated 模块，运行时抽样可能继续读到旧对象，即使生成文件已经更新。
8. 因此，涉及 generated `searchText` 的正式验收，应优先通过“重新加载 generated 模块”或“直接检查生成文件内容”来判断是否吸收了新 tags，而不是把同进程旧对象结果直接判成 generator 或 manifest 回写回归。

