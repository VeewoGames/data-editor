# Nocturnel 限制需求项目程序的精确准备与正式按钮接入边界

<!-- document-state: current -->
<!-- state: current -->
## 当前交付状态（2026-10-24知识核对）

用户已将最终范围确定为三块描述交付：17条特质、53条玩家技能、18条当前符文，共88项适用描述界面；浮框关键词、滚轮、关闭和来源刷新；生成材料、拒旧、草稿保护及正式按钮接入。30条敌人技能不再纳入统一限制接入分母，既有AI、冷却及行动力保留；自然刷取、通关、任意构筑、全旧档与无关玩法修复不作为本次描述交付门槛。主动技能仍按原CD/AP/法力规则释放，没有因显示接入新增通用次数计数器。

在明确批准的v3维护包范围内，已向生产交付142个产品/工具/配置/合同文件及1个受保护符文目标，共143文件；最终材料454项依赖与拟发布字节逐项匹配。18条当前符文仅补缺失空 `limit_note_output`，退款符文仅迁移两个已批准的机制字段，保持每回合1次、恢复1点AP。264条历史符文未变，未用候选整表覆盖生产。铁卫独立上下文补接沿原live host及binding读取，不增预算或玩法owner；最终owner检查792项及按钮Node检查103项为既有通过证据，本次未重跑。

正式页面事务 `410da1b1-5a62-45bf-87ea-4596ce883801` 已实际点击原「生成正式描述」，终态 `completed_without_changes / no_changes`。按钮前后traits、skills、runes与历史registration/anchor/state六文件字节相同；层层压制仍为count1和“每回合1次”，未进行生产改次或代填作者需求。1↔2写回、真实触发及恢复的能力来自既有隔离证据，生产无变更运行不能替代实际生产改次验收。

项目发布窗口交付快照为OPEN、generation 2，accepted未结事务、continuation及blocking义务均为0。当前源码已接入通用publication wrapper，工具部署配置已含物理项目绑定及 `managed-entry-non-replay-v1`。已采用B保证边界：受管按钮和恢复入口拒绝旧事务重放；同账户直接文件写入、未知旧程序不在该保证内。原12项历史的业务效果仍未知，注册和处置账本未改，不能解释为逐项非重放结案成功或完整OS撤权。

首轮维护在首文件写入前以 `HISTORY_RUN_CONTEXT_REQUIRED` 拒绝，写集为空、窗口HELD；随后在同一window/publisher下核对前像并绑定原历史保护上下文，经原owner逐写检查续行。保留失败与继续执行的区别，不重建旧事务、不清空历史、不将缺上下文改为放行。最终独立Spec/Quality均通过且无P1/P2，所核范围为以上描述交付及精确生产包。

作者草稿、机制真值与正式描述有效性分开：允许草稿暂时落后，生成报告差异并保留输入；缺源、版本漂移、语言资格冲突或不支持需求拒绝，不静默改文案、自动重签资格或扩张次数能力。项目程序负责规则、来源、材料及完整后像重算；Data Editor保持通用执行、事务、字段保护、历史拒绝与发布窗口职责。

本次只维护知识，定向核对既有完成回执、当前配置和实现入口，未重跑测试、探测服务、启动Browser或执行维护。交付时8787/api/health与8791/health均HTTP200/ok，正式URL为 `http://127.0.0.1:8787/`，Browser留在该地址；未共享停启、改OS权限、提交或push。自有维护/测试进程已退出，隔离副本、私有测试存储、前后像与报告作为证据保留；这些是交付快照，不代表当前时刻探测。

后续生产改次仍须具体作者意图与精确写入授权。历史完整结案、保证范围以外渠道、自然玩法及全旧档不由本次完成状态推定。下文为按阶段保留的历史快照，其中“生产仍v2”“未安装”“实施未启动”“12项阻断”描述当时状态，当前描述交付和受管B边界以上文为准。

<!-- state: history -->
## 历史阶段证据（不代表当前启用状态）

### 最初准备与职责快照

2026-10-22 已完成精确准备并接入正式按钮：17 条当前特质为 prepared/request-draft，6 条旧备注具备显式采用凭据，13 条历史记录未启用。用户补充的 4 条需求原样保留；旧预览中的 3 条缺字段已有 2 条由作者填写，因此实际仅为 `forced_movement_payoff` 补 1 个空字段，不能按旧预览覆盖最新作者输入。

项目接入位于 `C:\Code\Nocturnel`，包含限制需求准入、纯编译、依赖环境、固定命令、可信 validator 和只读准备预览。Data Editor 维护通用 `project-command` 执行与提交协议；具体规则语义、旧值采用证明和完整后像重算属于项目程序。该接入没有向通用产品加入 Nocturnel 专用判断。

项目入口为 `.data-editor/contracts/limit-request-authoring.v1.json` 与 `tools/description/limit-request-*.mjs`，只读准备入口为 `tools/description/preview-limit-request-preparation.mjs`。原生成按钮保持同一 actionId，切换为 `trait-description-generate.v2`，并声明必需 proposal validator。项目作者需求准入与已退出协议的通用 `entry-action-eligibility.json` 不是同一门禁，不能据此恢复旧 eligibility 机制。

普通保存保护通过 `src/field-write-policy.mjs` 的 `rowSelector` 精确匹配获准 ID；前后像均核对稳定身份与受保护字段，不能通过删除重建或改主键解除保护。项目 validator 核对 selector 与准入合同一致，Editor 只解释通用选择器。`src/api/client.ts` 保存自动化设置时保留 `proposalValidator` 与 `allowConcurrentSave` 声明；旧页面须先保存草稿、刷新，再保存自动化设置，以加载新版客户端。

## 已实现的保守语义

- 通过内部条目 ID、业务 ID、来源/集合、角色、模板及稳定 rule/contribution/budget 身份核对项目准入；历史备注不能自动成为需求。
- 首版 `trait-existing-limits.v1` 仅确认真实 owner 已有窗口与次数；固定 1 不接受 2，不支持新建、扩张或移除真实次数预算。
- “不限次”仅确认没有自有触发次数预算，保留原机会条件与其他上限；空白草稿不表示取消限制，含混或不支持的需求拒绝。
- 复用现有 `description-compiler.mjs` 和来源 catalog，保留 `limit_note_output` 原文，不输出作者需求或 `component_contributions` 修改。声明贡献数组写回权限不等于任意机制进化已实现。
- validator 从原始行重新编译并比较完整后像与精确 changes，包括目标外字段、语言及虚假 `no_changes`。命令与 validator 都检查输入依赖快照，不能相信生成器自述 evidence。

## 验证范围与剩余门槛

本次接入验收记录了 31 + 5 + 67 + 11 项诊断、typecheck/build 与 `stage1.required / local` 通过，其中自动化设置客户端测试为 11 项。正式 HTTP 运行 `b204270a-4301-4335-879e-2345fe8f7e7e` 无变更，原内容哈希不变。隔离链路覆盖成功提交、幂等、不支持需求、伪造补丁及并发恢复；正式 HTTP 的无变化结果不能替代完整 GUI 或 Godot 玩法验收。本次知识维护仅核对完成记录与实现入口，没有重跑测试。

验收记录中 330 条内容除该空字段外深相等，1261 项代码基线不变；已验语言文案与机制未改，正式双端口健康，自有夹具及临时构建目录已清理，未提交或 push。这些是交付时的证据快照，不能解释为未来服务与工作树永远不变。

正式技术门通过不等于 GA、游戏发布或总体方案完成。依赖集只覆盖列出的程序与输入闭包，不能从 catalog 声明推出整个游戏实现图均具备变化拒旧能力。

## 后续真实机制写回：生产启用待批准

2026-10-22 后续方案明确：生产按钮仍只确认已有机制，尚未启用真正修改 `component_contributions`；隔离v4候选现已完成，见下文。本轮已核查 `trait_layered_suppression` 的 round/count 真实 owner 能力，后续精确写回仍须冻结窗口、分区、预算及状态身份；不能由读取 cap 或正整数校验推断任意次数都受支持，也不能从首切片外推其他 family、新增/删除预算或窗口迁移。

机制变化须联合核验全部受影响的既有语言正文及其作者源。现有编译器不能自动判断普通正文中“每回合仅一次”等任意语义冲突；首批需显式核准正文版本并守卫摘要，版本变化、缺源或冲突时拒绝写回并保留作者输入，不自动改写已验文案。隔离能力检查点已在后续获批并执行，当前限定结果见下文；生产精确写回仍待后续批准，文件提交与运行发布仍分开验收。

## 2026-10-22 当前能力检查点与统一嵌套修正

层层压制在先前自有隔离副本中仅改预算count为2、运行源码保持原样，21项检查通过：真实声明验证、取得安装、两次实际疲劳与消费1/2、第三次预算拒绝、磁盘Continue保留2、自然end_player_turn_async到下回合重置及再次施加。slow/blind前置与owner prepare/finalize调用由夹具控制，不代表两次完整付费Action或GUI验收。原count1的既有owner与installed付费/Undo/Continue诊断也通过。新检查未自行登记正式catalog，不以诊断称正式gate。当时definition限制查询及JS来源catalog仍固定1；这一查询限制已由下述后续批准切片解除，生产按钮仍未启用机制写回。

用户明确要求统一嵌套规则：撤除ReadonlyGeneratedValue及其结构样式，保护结构沿原摘要/集合/NodeEditorHost/fallback浏览，只读权限准确匹配selector并传递到所有层及最终回调；未知权限也明确只读。现行规则见对应ADR。生产特质、文案和Nocturnel运行源码不修改，其他任务不操作。

## 2026-10-22 受限来源查询与离线候选已完成

后续获批切片已接通 `description-source-catalog.mjs` 与 `description_trigger_limit_query.gd`，仅 `trait_layered_suppression` 原 round 预算接受整数1、2，其他family及条件、身份、状态策略验证不放宽。已取得限制取真实发布快照；发布值为2而作者草稿回到1时仍显示2，查询不消费次数、不改发布状态。

休眠合同 `tools/description/limit-request-layered-capability.v1.json` 固定entry/contribution/rule/budget、round、[1,2]及准入/全语言正文和绑定摘要。固定命令和validator仅在显式 `--layered-candidate` 下从原准入内存派生候选v2准入/v3 action；请求JSON不能升级能力，生产v1准入/v2 action及required-validator配置保持原样。既有30条记录、6条采用收据及17条保护集合复用。共享来源目录支持2不等于生产写权限扩张，默认v2仍只确认1。

候选只在clone上改变唯一稳定预算count，守卫全部 `description`/`description_*`、作者源、绑定和语言映射，并在候选机制上重编译全部已有语言；任何版本变化或编译差异均拒绝，保留作者草稿与已验文案。空白保持当前值、相同需求幂等。摘要是已验版本守卫，不是对任意自然语言语义的证明。validator从原请求重算完整后像与changes，覆盖fresh/commit/admit/recovery和真实no_changes；不能由这些模式的程序测试推断真实锁内提交或未知run恢复已完成。默认依赖64项，候选增加能力JSON与Godot查询文件为66项。

交付记录为44项Node定向诊断及3套自有物理Godot副本focused诊断通过，可信command生成且validator通过的count2后像串联真实取得、发布快照、activation/ledger/store与限制查询；新查询含22项断言。该阶段新测试尚未登记正式catalog，不是正式gate、完整付费Action或GUI验收；后续六项L1/L2接入见下文。1324项基线核对保留生产330条traits、已验文案/草稿、生产配置与Editor源码；另一任务12项奖励/流程变化保留，结论限于本轮隔离快照。本次知识维护只核对记录和实现，没有重跑测试。

该切片之后已另行批准并完成下述隔离事务检查；受控起点的完整付费Action已在后续检查通过，六项L1/L2 catalog/profile亦已接入；隔离count2付费正式驱动、正式L4与同按钮生产切换仍为独立门槛。生产值改2仍须具体作者需求与明确写入授权。

## 2026-10-22 隔离事务与原run恢复已验证

自有项目副本物理复制66项候选依赖和330条traits，仅副本配置v3候选动作及可信validator。实际 `startProjectCommandEntryAction`、行级journal/fencing、document coordinator和 `recoverProjectCommandRun` 调用既有候选command/validator，强化版18项诊断通过；本次知识维护核对完成记录、项目实施记录和服务入口，没有重跑测试。

- 真实1→2→1提交后，全量JSON比较仅目标稳定预算count改变；其他条目、全部语言及作者源/关联/需求草稿保留。重复需求为真实 `no_changes`，默认v2仍拒绝改次。
- 生成中更改草稿、未选语言作者源、另一行、owner依赖、能力合同或动作profile均拒绝旧结果；获取锁前及锁内admit期间的外部改源也拒绝。同coordinator的依赖保存等待事务提交与终态发布。部分输入变化直接写副本模拟外部作者，不代表HTTP/UI保存验收。
- 真实子进程分别在源替换前的 `commit_intent`、替换后仍为 `commit_intent`、结果文件close后终态可读但journal仍为 `verified` 时退出。恢复同一run：替换前失败且保留原值，替换后保留已写值并完成结果；重复恢复幂等并释放准入。恢复遇到新作者输入或依赖时保留新内容，拒绝采用新基线或伪造成功。
- 两个真实恢复进程竞争同一Windows named-pipe锁，第二个观测到 `EADDRINUSE` 后才释放首进程，最终原run结果一致。恢复前后生成命令调用记录不增加；此证据不扩展为任意副作用的exactly-once保证。

最初published故障注入等待不存在的结果rename，修正为真实文件close后暂停并补journal断言后通过；只修正诊断夹具，未修改产品源码。1330项基线保留生产traits、生产配置及Editor源码，自有子进程和夹具清理，交付时双健康通过。不重叠奖励/流程并行变化保留，不能声称整个并行仓库集成通过。

这是事务库与项目程序的隔离诊断，未覆盖HTTP/UI重连、断电或设备持久性、正式catalog/profile门或GA。该阶段未包含完整付费Action；后续受控付费检查结果见下节，正式门与同按钮生产切换仍独立推进。生产内容、默认v2和作者草稿未改；未启用生产改次、未提交或推送。

## 2026-10-22 受控完整付费链与正式归属已核实

通过同一真实事务在自有物理Godot副本生成count2，再由原 `ActionProvider` 的 `battle.player_skill` 查询目标并执行三种原技能；没有直接调用特质host的prepare/finalize。起点显式受控：三张不同原决斗技能、AP5/mana15、三名原敌人及既有弱化状态。前三次AP为5→3→2→0、mana为15→11→8→4、手牌为3→2→1→0；前两次实际疲劳并消费预算1、2，第三次技能仍完整付费并生效，特质明确返回 `layered_suppression_round_budget_used`，预算保持2。只读观察真实 `action_committed` 的准备结果，拒绝与第三次动作的action_ref一致，不能仅凭无疲劳推断拒绝原因。

自然结束一回合预算清空，原cooldown2仍余1；再自然结束一回合原冷却归零，使用自然抽回的原牌完整付费，再次施加疲劳并消费1。中途没有补资源、改冷却或重发状态。完成记录为31项断言、原count1两套基准及再次真实事务产出count2后的最终复跑通过；本次知识维护核对实施记录与夹具调用入口，没有重跑测试。早期夹具的时序、mana和冷却失败不作为成功或产品缺陷证据，原动画/UID诊断日志也不意味着零错误运行。

该结果只证明受控起点的完整付费执行链，不证明正常AP4、每回合抽2牌可自然获得三次起手，也不是fresh owned MCP L4、GUI/L5或正式gate。当时catalog尚无该能力的正式target；后续六项L1/L2接入见下节。`stage1.required`、`stage2.focused.production_contracts`、`stage2.fresh_mcp.baseline`不能替代精确登记。治理配置、受影响系统、ActionProvider与runtime MCP的既有职责仍保留；执行授权与技术复核不等同其他owner签批，自然构筑与L5另验。

交付时1342项基线保留生产traits、生产配置、描述工具、Editor源码和测试manifest；14个奖励/流程/地图文件的并行变化保留，隔离结论限定复制快照。生产按钮仍v2，新机制写回未启用，已验文案与作者草稿保持。允许草稿暂时落后机制，但生成必须报告差异并保留输入；生产次数修改仍需具体作者需求及独立写入授权。

## 2026-10-22 六项正式技术门与日常复用边界

用户明确既有机制组件复用现成规则，技术测试登记、覆盖与验证由开发侧维护，不再逐组件请求用户批准技术验收清单。新增机制能力、玩法歧义、生产写回或实质范围变化仍需用户决定。本轮据此授权追加六个L1/L2 driver/test、`layered.limit_candidate.contracts.v1`专用profile及精确impact规则；未代填其他owner签名，未修改owner_registry、默认profile或公共runner。

统一runner的`task_completion --profile layered.limit_candidate.contracts.v1`最终6/6通过，每份report的primary、cleanup、gate均passed，bundle及变更影响选择通过。覆盖作者需求、来源目录、离线候选、原owner、原付费与限制查询合同；这些是正式L1/L2技术门，不是正式MCP玩法验收。本次知识维护只核对完成记录、正式登记与夹具入口，没有重跑测试。

首轮5过1失败暴露了查询夹具对真实来源的假设：`progression_context.add_trait`按trait_id回读ConfigLoader，传入count2草稿不能覆盖canonical源1。修正后定义1/2均验证，真实安装按当前发布值验证；相反草稿不覆盖发布快照，伪造快照拒绝，消费不改变上限。当前正式查询安装值为1，不能用测试名`query_two`声称已覆盖真实安装2；安装2与两次完整付费仍来自先前canonical2隔离诊断。失败报告保留。

前一独立fresh owned MCP诊断18项通过在该阶段仍未登记为正式L4；当时第7套隔离付费驱动及正式L4尚待接入，后续完成情况见下节。既有`NOCTURNEL_MCP_TRANSPORT=0`仅用于该轮focused子进程，未接管占用9090的共享实例。交付时生产traits、文案、作者草稿、生产配置及运行源码保留，自有存档与子进程清理、双端口健康；生产按钮仍v2，机制写回关闭，未提交或推送。

## 2026-10-22 隔离付费正式驱动与受控 L4 已完成

复用现有 `actions_gameplay` kind 与 session/report 框架，正式登记 `actions.layered_paid.v1`、`gameplay.layered_paid.v1`、固定场景 `gameplay.layered.paid_count_two.v1` 及严格 schema。项目专用实现位于 Nocturnel 的 `tools/testing/layered_paid_*.mjs`、`run_layered_paid_candidate.mjs` 与 `tests/mcp/support/layered_paid_scenario_fixture.gd`；Data Editor 产品与公共 runner/session/report 规则未因该接入增加业务判断。

物理副本通过既有公共事务 API 生成 count2 并比较完整后像，只允许原稳定预算 count 差异。正常 canonical `class_tester`、固定 seed/房间与空池后一次 `GRANT_ASCENDANCY` 建立取得账本；AP5/mana15/三张原技能及目标既有状态仍为受控起点。主仓 target snapshot、隔离 afterimage/实际输入和外部 Editor 实现摘要分开核验，不能以主仓未改替代隔离输入校验。

- `layered.paid_isolated.contract.v1` 正式 L2 通过，包含真实事务及28项 canonical/付费/拒绝/自然恢复检查；不依赖9090。
- `layered.paid_driver.contract.v1` 最终10项控制流检查通过，覆盖成功、业务失败、blocked、真实子进程超时、最终 verify 超时、清理失败、绑定破坏拒绝、硬杀残留锁及缓存路径边界。五类 conformance 是受控事实到报告映射，单独保留，不作为实际 gameplay 替身。
- `layered.paid_mcp.contract.v1` 最终 bundle `c0dbc11b9a582382ce2c0fc1ffaaf8ee6462c41139e49f1a088303fc9b204f5b` 的 fresh owned MCP 正式 L4 通过，6步动作、15项 witness、报告绑定、artifact 哈希、primary/cleanup/gate 均通过。原六项 L1/L2 回归另行通过，不扩大旧 claim。

最终正式报告为 `C:\Code\Nocturnel\temp\reports\testing\layered-paid_mcp-v1-20261022081724498-2d7e633d-14a3-497f-bb0f-a3c3da4b89b9\report.json`。两次付费触发消费1、2，第三原技能仍完整付费，特质以同一 action_ref 明确拒绝且预算保持2；自然下一回合清预算而原CD仍余1，再自然回合归零并再次付费触发。主仓/副本各30643项输入与294项Editor实现摘要受校验，311项生产/Editor/文案草稿保护输入保留。这是报告绑定快照，本次知识维护只核对既有报告、正式登记与实施记录，未重跑测试。

旧通过、UID变化导致快照拒旧、外部9090抢占失败及预检 blocked 报告均保留。外部 listener 存在时不能把 outer Node 退出当整轮清理通过；仅在验证自有PID退出、隔离锁释放后，按 artifact 精确归属删除自有副本/存档，并经既有 recovery token API 恢复自身过期 main guard，不接管外部进程。隔离缓存复制限定 `.godot/imported` 直接目录，支持引号内空格/中文路径并拒绝 Windows 穿越和 ADS；启动缓存存在/缺失及可变缓存前后哈希单列。

最终交付记录确认自有进程、锁、副本与专用存档清理，8787/8791健康；这不是当前时刻的服务探测。本轮技术接入完成不等于总体方案完成：生产按钮仍v2、新写回关闭，生产切换和具体内容改2需独立授权；自然构筑、GUI/L5与零引擎错误均未由此证明，既有 `committed_target_plan` metadata 日志边界保留。

## 2026-10-22 隔离 v4 生产形态候选与同按钮验收完成

用户已另行批准并完成7.1/7.2；7.3主仓程序/配置交付和生产启用未获批准。隔离候选为 `trait-description-generate.v4` 与可信固定参数 `--layered-production`；生产仍为v2/count1。新分支只在项目程序中实现，Data Editor通用产品未增加特质业务。

候选在次数改变时仅修改原稳定预算count，冻结全部已有语言正文、作者源、绑定与草稿；空或相同需求继续普通正文生成，支持当前count1/2。正文生成导致已验版本资格过期时必须明确提示重新验证，不自动重签摘要；文字和次数同时变化被拒绝并保留两份输入。其余16条准入不扩权。完整配置保留18个动作中的其余17个动作与原18个合同，新增v4合同；生成器和required validator使用相同66项依赖并重算完整后像。

完成记录与最终正式报告确认：

- `layered.production_candidate.contracts.v1 / task_completion` 5个登记测试、76项断言通过，覆盖分流、17条边界、5类拒旧及提交前/替换后原run恢复；既有v2/v3语义保持。通用Editor另有49项事务/validator检查通过。
- 隔离UI/HTTP沿原按钮先保存真实行再生成，完成1→2→1、同/空需求、count1/2普通正文、资格失效提示与拒绝保留；纯API证据不替代这些UI观察。
- 最终 `layered.paid_isolated.contract.v1` 28项真实付费/预算拒绝/自然恢复检查及控制驱动通过。最终fresh owned MCP run `layered-paid_mcp-v1-20261022093039112-74ec577f-e480-4e51-ab84-065fb6c1ead6`，bundle `67fcaa0439921e6748fb427e785accef837b4d44cbec62f3efc873b348bdaa16`，primary、cleanup、run_cleanup与gate均passed；6个生产Action、15项witness通过。此前端口竞争failed/blocked和自有遗留锁恢复记录保留，不覆盖为成功。
- 交付时353项受保护生产输入、11份候选文件与已验文案/作者草稿均保持；自有Godot/driver、两份锁、私有运行副本与测试存档已清理，服务finalize后8787/8791健康。这是交付快照，本次知识维护未重跑测试或探测服务。

最终L4仍限定受控canonical起点，不证明自然获取、致死因果或L5；`opponent_branch`警告和`committed_target_plan`元数据错误原样保留，不能声称零引擎错误。保留候选及证据供7.3复核，不归档仍被后续阶段引用的方案。主仓切换前必须另行获得批准并核实共享依赖发布窗口与受影响在途/unknown/恢复run；空闲采样不能替代发布窗口。已有count2时不得盲退v2或自动2→1。

## 2026-10-22 共享依赖发布窗口仍未成立

只读核实已完成，未执行7.3交付或启用。`src/entry-action-route.mjs`直接分派project-command；`src/project-command-action-service.mjs`在编译前创建handoff/started，而fencing在后续proposal阶段取得。`src/project-command-snapshot.mjs`对完整profile/contracts及声明依赖做快照拒旧；document coordinator串行化提交段。这些能力均不能证明最后空闲核查到联合交付验证结束之间持续阻止相关新run，也不能防止多文件交付期间接纳混合版本快照。

本次生产配置快照有7个project-command和11个project-skill。前者均快照完整profile/contracts，后者也读取共享规则/合同authority；发布影响范围先按该项目全部18个动作及外部产物、候选创建、原run提交和恢复入口核实，不能只封目标行。其他注册项目不在该窗口范围；外部CLI或手工磁盘写入不能宣称已受服务端锁强制保护。

2026-10-22 09:53:53 UTC只读采样记录8个历史started缺终态回执、3个group journal未完成。缺回执不证明writer仍活或已死；已有失败回执也不证明未写入，须核对原源文件/产物、authority及恢复资格。未调用会触发恢复的active/latest/result接口，未恢复、删除或改写记录；该采样不是持续窗口或完整排空证明。

原调查给出的推进顺序为W1历史分类 → W2合同确认 → 获批后W3隔离实现 → W4联合候选验证。后续用户已批准W2推荐合同用于W3自有副本，W3完成情况见下节；正式Editor仍未应用该能力，真实发布窗口仍未成立。窗口复用原事务/恢复owner，先关闭受影响新准入，再排空旧run；unknown或恢复未决阻断交付，发布中断保持关闭，完整包验证后显式重开。普通作者编辑沿原保存语义；其他任务有启动需求冲突则延期，不停止它们。

运行交付包为3个项目模块与2份共享配置；6项测试资产另需其runner消费者的发布窗口，不由运行准入窗口自动覆盖。该轮353项保护输入与11份候选摘要保持，生产仍v2/count1、作者草稿及已验正文保留。以上是完成时证据快照，本次知识维护未重跑测试、探测服务或执行恢复。精确清单、启用与回退步骤见项目实施计划§7.3.5；已有count2时仍不得盲退v2或还原整表。

## 2026-10-22 W1分类完成与W2合同稿边界

W1已逐项只读关联8条旧version1 handoff和3份未闭合group；分类完成不等于历史处置完成。8条旧run只有handoff/started，缺终态、原writer身份及同run proposal/子提交证据；没有唯一匹配lease不能证明没有外部写入者，删除旧action定义也不能证明旧任务失去写入能力，均继续保留为unknown。

3份group不能因已有failed/COMMIT_JOURNAL_INVALID回执而推定未写入：`a427b6de-5b93-4b4a-9c28-5101adf0de79`的原进程身份已不匹配，但旧group结构不兼容、子日志缺失且内容不同于原before/after，纯证据releasable不授予组合恢复资格；`490f04c8-f3c7-4866-89e1-d98efb071232`缺proposal、owned-evidence和子日志，源及产物已变化；`5ca3cdbd-c2cf-4983-b534-07847f3776f1`有匹配after且result_published的产物子提交证据，但源事务未闭合。不得试跑恢复、重放整个组合、补写旧源或覆盖后续内容。

本轮3347份读取输入审计末尾重读无漂移，353项生产保护输入与11份候选保持；这些是审计快照。本轮没有恢复、清理、取消或改写历史记录，没有改生产程序/配置/内容或操作服务。本次知识维护只核对记录与实现入口，未重跑测试或服务探测。真实READY仍需逐项原owner闭合证明，或可审计的无晚到写入及无需恢复处置结论；W3可先在自有夹具验证unknown阻断，无需先清理真实历史。

W2经架构与独立复核形成以下合同；最初为待采用建议，随后已获准在W3自有副本实现验证，尚未应用到正式Editor或生产项目：

- 同一Windows用户、本机多服务复用一个持久准入owner，以规范物理projectRoot和真实配置位置识别项目；短临界区原子完成关闭与accepted/continuation登记，持久保留windowId/revision、发布者及精确包摘要。其他用户、主机或旧绕过入口须先证明不会写，否则阻断READY。
- 先登记再handoff、提升身份、启动子进程或创建提交义务；已接纳旧run排空，关闭后新义务拒绝且无副作用，尚未接纳followup延后而非永久失败。fencing/journal及业务生命周期仍归原事务owner。
- OPEN→DRAINING→READY→DEPLOYING→VERIFYING→OPEN，失败/中断保持HELD，不按超时自动开放。READY前闭合全部已登记义务；READY及之后阻止晚到提交和自动恢复，coordinator内再次核窗。
- 普通草稿/正文保存保持既有ETag和字段保护；精确部署profile/contracts保存于窗口关闭时拒绝并保留设置输入。外部磁盘写以唯一发布者、前后摘要和漂移停止约束，不能声称Editor锁可强制阻止任意写盘。
- 窗口状态/inspect始终纯读；关闭后新观察不隐式恢复、清claim或启动followup。OPEN保留现有观察恢复，但恢复前须原子登记continuation。半包保持关闭，完整恢复原包后才可回DRAINING按原run恢复；完整目标包和无未决事务验证通过才重开。此合同不扩为全产品GET协议重构。

W3隔离实现及后续获批的W4联合隔离验证已完成；真实7.3交付仍需独立授权、历史处置与无任务冲突窗口。其他项目继续工作，相关任务有启动需求冲突则延期。既有count2不得盲退v2、自动改1或还原整表。历史分类由项目实施计划§7.3.6维护，W3/W4完成状态见§7.3.7、§7.3.8。

## 2026-10-22 W3通用窗口候选完成，正式产品尚未应用

本次只在自有Editor物理副本实现通用能力，交付20项运行实现/入口及CLI和4项测试。正式Editor源码669项基线无变化，未初始化Nocturnel生产窗口、未切换v4、未处置W1历史；业务仍v2/count1。353项生产保护输入、3347项W1读取输入及11项旧业务候选的完成时摘要保持。以上为交付证据快照，本次知识维护未重跑测试、探测服务或操作恢复。

候选持久owner以规范物理projectRoot、实际profile/contracts/runtime绑定项目，显式初始化前检查历史义务，unknown拒绝初始化。短临界区原子登记accepted/continuation，跨异步completion保留义务；command、skill、proposal/group/exact artifact、候选创建、pending/ack及独立followup均接入，coordinator内和raw group物理目标再次复核。托管fencing短操作复用既有同用户进程互斥，不在生成或提交期间持长锁。未初始化项目保留原执行路径；产品中没有增加具体项目业务判断。

状态为OPEN、DRAINING、READY、DEPLOYING、VERIFYING、HELD，不按超时自动重开。闭窗inspect/观察不隐式恢复或迁移；OPEN观察恢复先登记continuation。普通草稿保存沿原ETag及字段保护，自动化配置联合保存从首次bindings写入前登记，关闭时拒绝并保留输入。HELD恢复完整before包后可携未决义务回DRAINING，再按原run恢复；显式reconcile仅在DRAINING、发布者/window/revision匹配、旧writer精确身份已退出且原事务/journal/claim闭合后关闭登记。该能力不授权生产历史清理。

最终定向237项测试通过，0失败/跳过，覆盖真实双进程竞争与崩溃、command及原run恢复、HTTP托管/未托管候选创建、promotion/ack、独立followup、闭窗只读、配置拒绝及普通草稿保存。独立审查发现的跨项目raw group许可复用、HELD恢复before保留未决义务、崩溃登记闭合三个问题已补反例并修复。早期helper漏复制、包装参数漏传及fencing短操作竞争的失败记录保留，成功结论依据修复后的最终合批；未跑浏览器UI、全仓npm test或Godot MCP。

候选保证范围限同Windows用户、本机多服务。跨用户/主机及旧绕过入口需在真实发布前另证排除；外部直接写盘不受强制拦截，以包摘要漂移保持HELD。后续W4已获独立授权，在新组合副本及独立runtime完成联合包、原按钮1↔2、no_changes和输入保留验证，未覆盖旧冻结候选。真实历史处置和7.3生产交付仍待授权，真实READY仍受W1未闭合证据及相关任务窗口约束；原统一方案与实施计划继续被引用，尚不归档。详情由项目实施计划§7.3.7、§7.3.8维护。

## 2026-10-22 W4联合隔离衔接完成，生产门槛保持

新自有物理副本组合W3的24项通用Editor候选与原11项业务候选，精确核对after/生产before摘要，保留18个动作、19个合同、17条既有准入和66项业务依赖。最终9组真实HTTP原按钮路径与事务验证通过：关窗排空后替换5项运行包并重开；READY普通保存可用而新按钮拒绝；1→2→1全表比较及同/空需求no_changes；已接纳原run完成且READY等待排空；target、other-row、profile、contracts、compiler五类并发拒旧并保留新输入；半包保持HELD；正文资格失效时拒绝改次并保留草稿与已验文案。候选产品代码没有改变。

隔离副本执行既有`layered.production_candidate.contracts.v1/task_completion`，5项登记测试及cleanup/gate通过，bundle保持`67fcaa0439921e6748fb427e785accef837b4d44cbec62f3efc873b348bdaa16`。报告Git head/driver.commit继承祖先Editor仓，不能证明Nocturnel生产commit或dirty状态；资格限定联合清单、补充引用及实际target摘要。原报告保留，不修改runner扩大资格。

本轮仅新增真实HTTP原路由与联合事务证据，未新增浏览器UI、未保存前端输入或Godot MCP验收；既有UI/L4证据及限制继续保留。早期驱动的终态轮询、projectId、静态引用复制与历史缺失项null比较问题修正后通过，失败记录保留，不作为产品故障或历史改写证据。原始HTTP事务与窗口/runtime/内容证据已归档后再清除运行夹具。

完成时353项生产输入、3347项W1基线、11项旧业务候选、24项W3候选、669项正式Editor源码及联合输入无漂移；生产窗口不存在，仍v2/count1，作者草稿与已验文案保持。交付记录确认9个临时服务及夹具收尾、8787/8791健康；这是完成时快照，本次知识维护没有重跑测试、服务探测或恢复。

W4闭合不解除历史处置、实际相关任务窗口及正式Editor/Nocturnel联合发布门槛。原11项只覆盖8条旧run与3份group journal；后续完整纯扫描补发现第12项pending，逐项建议已完成，当前结论见下节及项目实施计划§7.3.9。不得用隔离空runtime证明真实READY，不代作者调用生产按钮，生产交付仍未获授权。

## 2026-10-22 历史逐项建议完成，完整义务为12项且仍阻断

只读复核保留原11项事实，并以W3纯义务扫描补发现一条历史身份确认pending；这是漏列补正，不是新产生的生产事务。实际为8条unknown旧run、3份未闭合group及1条pending，12项均未处置、继续阻断。原3347项读取基线及本轮保护摘要保持；生产仍v2/count1、没有真实发布窗口，文案及作者草稿保留。独立架构结论为needs-decision，recheck认可建议及门槛，不代表批准实施新增能力。

补充项run为`e61f4889-9e75-4103-8995-cc27ddf691a2`，token为`e0e44442-2d12-40c4-aa39-ec1d9271814b`，位于项目runtime的`pending-entry-actions`。创建及到期均在2026-08-06，采样时state仍pending，身份receipt和旧fencing12/owner保留，当前lease probe为absent，head已372，没有同run的handoff/started/result/proposal。现行`src/entry-action-route.mjs`的`expirePendingPromotionsForSource`对非owned状态直接跳过；ack过期分支取消失败也不写expired。因此过了expiresAt、锁不存在均不等于已结清，不能重建旧锁、激活token或删除receipt来消除阻断。

8条旧v1 run缺现行生命周期及原writer证据，不能迁移到当前同名或替代action重跑；现行`cancelProjectSkillEntryAction`要求`projectSkillLifecycle`。3份group须分别保留结构不兼容、效果未知及文档已提交而源未闭合的事实；失败回执或释放fencing不使group自动闭合，不改stage、不补旧源、不重放组合。当前源、文档、身份和全部历史工件均须保留。

当时建议的后续方向为通用非重放处置合同：由原事务恢复owner提供逐项持久回执及幂等/CAS，扫描和start、ack、提交、恢复、观察入口消费同一闭合事实；不增加项目名单豁免。后续合同与封闭模型已获准并完成，见下节；真实产品结构部署、消费者接入和历史写者排除仍未完成。每项需有原执行渠道无晚到写入的可审核证明或获批精确撤权，来源、时效和入口覆盖不可简化为人工布尔；年龄、未找到PID、无锁、短时摘要稳定和接受当前内容均不能替代。

当时的顺序是先批准合同及隔离验证，再形成精确生产处置授权；前一步现已完成封闭模型范围，后一步仍未授权。任何新义务或摘要漂移须重新审查。失败或中断保持阻断，不恢复已结案旧writer写权限。本轮没有recover/cancel/expire、删除、补写历史状态或修改产品源码/生产配置；本次知识维护仅核对完成记录、现行代码及项目实施计划§7.3.9，没有重跑测试或服务探测。

## 2026-10-22 非重放合同封闭模型完成，真实历史仍阻断

本轮完成通用最小合同及封闭执行模型，范围限新建隔离夹具；不是正式Data Editor候选，也未接入W3/W4的消费者。单恢复owner管理物理项目绑定的anchor/state、逐run intent→receipt及CAS/幂等。intent落盘立即拒绝该run的模型副作用，扫描仍阻断；现场核验原登记身份退出、覆盖/epoch一致、原证据与当时内容摘要匹配后，才生成`closed_without_replay`回执。不改写原事务、效果未知或文档局部提交事实。

封闭来源由监督器先登记启动义务，再记录真实Windows PID及creationTime；人工布尔、任意JSON、新补PID不能补签unsupported历史。身份先校验格式及writerDigest，再比较现场原身份；该摘要用于损坏检测，不是抵抗同用户联合篡改的签名。未知渠道、未完成登记、anchor/state缺失或损坏均拒绝，不自动初始化。内容摘要在结案时CAS；receipt后的合法作者编辑不复活旧run，原历史证据变化或原缺失项出现仍重新阻断。

最终21组Node模型测试通过、0失败/跳过；覆盖真实受控writer、跨进程CAS、IPC竞争、intent后崩溃、19类模型guard、摘要漂移及身份损坏反例。独立审查指出的创建时间损坏缺口已在模型修复，原正式lib未改。19类标签仅证明模型调度器覆盖，不证明真实HTTP、CLI、自动恢复、提交边界或窗口消费者已接入；未证明断电持久性或所有竞争调度排列。本次知识维护读取完成记录与实现，没有重跑测试或操作服务。

37份夹具及21份受控writer身份已归档，运行夹具已清除。完成时353生产输入、3347历史读取项、12 pending补证路径、669正式Editor源文件与既有候选均无漂移；生产仍v2/count1、无真实发布窗口，草稿与已验文字保留。以上是完成时快照。原8条run、3份group、1条pending共12项仍阻断；合成12项形态全部unsupported，模型凭据不能用于生产。下一步须查原执行渠道的完整退出或精确撤权证据，再独立完成产品入口接入与生产处置授权，不能以模型通过宣布真实READY。项目实施计划§7.3.10维护本轮交付范围。

<!-- dated: 2026-10-22 -->
## 原执行渠道追溯完成时的维护路线建议

2026-10-22只读追溯精确关联R1（`26dcf5f2…`）与R5（`9a3acf94…`）的原exec会话，原请求含对应run ID且cwd为Nocturnel。两会话没有完成/中止事件，投影仍为inProgress，但已有工具调用均返回；这些事实既不证明当前仍运行，也不证明CLI、runner及后台后代全部退出。原索引已指向压缩会话时，读取实际压缩文件并核对字节摘要，不改写原数据库或会话。

该轮机器LANS-HOME-PC的boot边界为`2026-07-26T12:57:32.4153510Z`，仅可排除R1/R2/R4/R5/R6当时本机OS进程原样幸存；不能排除重启后重新启动、自动恢复、外部主机或未来主动恢复。指定日期705份会话头只命中上述2个origin，受限扫描未命中、3个scratch目录不存在及4个候选node进程采样均不能排除全部执行渠道；采样PID不是停止清单。R3/R7/R8/G1/G2/G3/P12晚于该boot边界，不适用该退出组件证据。8条run、3份group和1条pending共12项仍全部不具生产结案资格。

项目实施计划§7.3.11记录本轮只读结果与待决路线。当时推荐A尚待用户选择；后续已批准并完成下节所述首批候选及维护包准备。该路线要求先在自有副本准备真实产品结案消费者接入候选和精确维护包，保持12项拒绝；相关任务保存结束、具体停止身份与影响获批后，才执行维护退出或必要重启。重启仅是本机进程终止组件，实际启动/恢复/外部来源仍须封闭或明确排除；产品入口覆盖、真实结案回执、共同依赖发布与业务启用分别验收和授权。无法建立封闭范围时继续阻断，或另行设计安全主体/受控环境迁移。同账户复制目录、换runtime、关端口或归档会话不构成按run撤销直接写权限。

本轮未执行停止、重启、权限修改、恢复/取消/过期、历史补状态或生产交付。完成时保护摘要无漂移、双端口健康，属于当时快照；生产仍v2/count1，已验文案、作者草稿和旧候选保留，差异只报告不覆盖输入。本次知识维护仅核对已有完成记录及现行实施计划，没有重跑测试或操作服务。

<!-- dated: 2026-10-22 -->
## 路线A首批真实拒绝候选及维护包已准备，尚不具生产资格

用户已继续采用路线A的候选与维护包准备范围。在新自有W4副本完成15文件变更（14个产品文件、1个测试文件），正式Editor、旧W3/W4及封闭模型保持原样。当前实现已核对历史拒绝owner、publication包装、atomic/link与followup边界；这属于首批真实产品消费者负向接入，不是模型测试替代产品，也不是完整结案能力。

owner按物理项目/runtime读取anchor/state和registration，intent禁止对应run及可验证祖先重放；任何receipt一律`HISTORY_PROOF_UNSUPPORTED`，不采信verified字段，没有生产proof issuer或通用初始化器。共享publication短锁内重验最终atomic写和exact artifact link，迟到completion重取锁；原pending/result身份也参与检查，不能换新runId重标旧义务。scanner保留所有原始义务，intent/receipt仅追加阻断。无物理project binding的纯callback和未穷尽消费者不属于已证闭包，旧二进制、原生直写及其他用户/主机不受该guard保证。

完成记录的最终16文件联合回归为253/253、零跳过，含13个新增集成反例及实际隔离HTTP正常流程。独立审查发现的最终link漏检和祖先缺失当根漏洞已修复；pending检查误解析普通非JSON日志的回归也已修复后合批验证。测试结果是该轮证据快照，本次知识维护只核对已有记录、当前候选实现和项目实施计划§7.3.12，没有重跑测试或服务探测。

首批交付时，独立anchor pin仅有context/夹具能力，实际部署入口尚未持久接入；全部登记痕迹消失且无pin时不能声称拒绝。当时source/artifact/identity迁移、pending分支、followup completion、proposal/group恢复及raw写边界仍须补足；后续固定登记与已知治理入口补齐范围见下节，消费者全集保证仍未成立。原执行渠道owner、精确停启身份与完整退出/撤权证据尚未收敛，字面路径筛选服务/计划任务0项不能证明没有渠道。下一步先补这些缺口，再提出具体维护影响清单；不得直接跳至重启、真实回执或生产启用。

完成时保护清单均无漂移，真实12项继续unsupported/阻断，生产仍v2/count1、无真实发布窗口，已验文案及作者草稿保留。该轮service:finalize确认8787与8791健康、清理器0进程/0目录，候选node与测试case目录均为0；上述均为当时快照。候选和完整依赖包安装、实际停启/OS重启、权限、历史逐项处置及共同依赖发布/业务启用分别待独立批准，维护包不是执行授权。intent前已发生的局部提交继续作为未决事实保留，不回滚伪装未写入。

<!-- dated: 2026-10-22 -->
## 固定部署登记与已知治理写入边界在新隔离候选补齐

本轮在新的隔离Editor副本完成相对上轮15文件增量（13个产品/配置文件、2个测试文件），未安装正式Editor或覆盖旧候选。工具安装目录的 `config/historical-disposition-deployment.json` 为唯一部署pin来源，由 `src/historical-deployment.mjs` 共用于HTTP、CLI及raw路径发现；请求、环境变量和项目context不能选择该文件。显式空entries表示未登记，配置缺失/损坏、非规范物理绑定、重叠root则拒绝受治理写入和恢复，不默认空。部署entry绑定projectRoot/runtime/anchorId并交叉核验项目registration、anchor/state；项目三份痕迹全失、context丢pin、重启或以已登记root子目录伪装项目，均不能解除部署保护。最终候选entries为空，生产root尚未登记。

`src/historical-disposition.mjs` 的作者保存scope只能由原HTTP保存owner授予精确source及本次普通commit-journal写集，保留ETag、合同、字段保护和幂等语义；scope成功或异常退出后失效，异步后代不能延寿，automation不能提升为author。active查询和自动恢复位于作者scope外。无scope source/artifact/identity原子写、identity promotion/恢复、pending/旧run恢复、raw command/supervisor启动、project-skill诊断发布与cleanup等已知治理路径均补入检查；cleanup删除与复查同锁，启动临界区不等待命令完成，跨项目scope仍核对实际目标。旧intent或缺run证据保留pending，不制造receipt；scanner保留原义务，receipt/verified仍unsupported。

完成记录为22文件联合回归307/307、最终微修后受影响5文件94/94，均零跳过；两组重叠，不相加，部署专项10项与历史拒绝14项已含于最终补验。独立复核修复raw command无scope启动、cleanup竞态、author延寿、raw supervisor按cwd发现和跨项目旁路。部分原生分支依调用链与相关service回归核验，并非每个分支都有单独端到端故障证明。本次知识维护只核对既有完成证据、交付清单及候选reader/scope/HTTP入口，未重跑测试或操作服务。

保证仍限已核治理入口，不等于OS撤权或任意原生/外部代码、旧二进制、其他主机/用户及同账户改工具config的隔绝；无可关联cwd而参数指向其他目标的执行也未被证明排除。view-config/shared-views/view-profile保留原metadata保存owner，未增加其原生writeFile历史guard或目录豁免；primaryKeys与documentFiles.docRoot仍参与artifact目标authority，原提交/恢复须重读校验，不能将其全部视为布局。

真实12项仍unsupported/阻断，proof签发、真实非重放回执及生产pin未启用；生产仍v2/count1。维护前须审核完整候选与共同依赖、真实物理root/runtime及全部退出/恢复渠道，再由实际owner提出精确PID+creation/服务身份、任务收妥条件、中断范围与失败保持关闭步骤。具体停启、重启、权限、生产安装、历史处置及联合发布/业务启用分别另批。完成时保护摘要无漂移、8787/8791健康、自有进程/夹具/config临时文件为0，均属交付快照。作者草稿、已验文案和旧证据保留，差异只报告，不覆盖输入。

<!-- dated: 2026-10-22 -->
## 逐项来源与共享维护影响清单完成，尚无获准停止对象

已完成8条run、3份group和1条pending共12项的逐项原路径与摘要刷新（含缺失项，共62个路径），并按共享主服务、恢复桥/controller、Codex UI、项目后台计算、原记录/会话、启动/外部渠道、候选部署与保留内容七类整理维护前提。范围仅为只读准备；`productionSettlementQualified`仍全部false，停止白名单为空。项目实施计划§7.3.14维护该交付状态，清单完成不代表维护、历史结案或生产发布已获准。

R1/R5原会话压缩字节未变，只读turn投影仍为inProgress/completed_at=null，既不能证明仍运行，也不能证明退出。其他原会话关联仍缺；boot边界仅排除R1/R2/R4/R5/R6原本机进程原样幸存。G3既有局部文档成功保留，P12未ack、补lease或expire。显式项目root筛选服务/计划任务/Run项未命中，不覆盖通用launcher、快捷方式目标、远端或人工恢复。

共享registry在该轮快照包含Nocturnel、Neon Race、Slop、OneFPS四项目，8787主服务及8791恢复桥的维护影响不能只按目标项目计算。PID与creation、controller generation/idle均属采样，不能当作执行白名单或业务空闲证明；两个先前候选Node实际是Codex UI内核，缺少旧run归属，不得纳入停止目标。实际聊天、页面、自动化、在途事务与负责人收妥映射仍待补齐；Windows账户不代替人员授权。后台进程声明缺失或空字段不证明实际后台执行不存在。

后续先补逐项执行/恢复渠道覆盖和共享使用任务收妥，再分别审批精确停启/权限、完整候选安装、真实非重放回执及业务启用。该轮生产、历史、作者输入和各候选保护摘要无漂移，两个health为200/ok；均为交付快照。本次知识维护仅核对已有证据、项目实施状态及共享registry实现，没有重跑测试、探测服务或执行维护。

<!-- dated: 2026-10-22 -->
## 端到端总计划已编制，实施尚未启动

完整总计划已完成五章路线与独立架构/recheck复核，覆盖当前按钮生产接入、特质/技能/符文与必要宿主统一显示、原生限频G2、最终次数G3、自然入口验收和旧路径退出。成果是可审阅规划，不是产品实现、首次引导可行性或生产授权；既有生产v2/count1、真实12项阻断、停止白名单为空的状态未因文档完成而改变。本次知识维护仅核对规划成果及原有知识入口，没有重跑测试、探测服务或操作恢复。

总计划获准实施后，采用一个持续owning plan推进；已授权且同需求、同authority、同影响范围的调查、修复、技术验收、复核与任务细化自主续行，不按小阶段反复索取“继续”。既有结果仅在依赖/条件变化或存在缺口时补验。没有新线索时，来源调查收敛为一次具体阻断单；不以重复模型或空runtime替代真实证明。完整统一显示的范围不因单个层层压制切片通过而缩小，旧88玩家/30敌人仅为历史盘点，须刷新后再作验收分母。

首次生产publication-admission尚不存在，不能预设W3已安装并承担排空。最近决定性检查点须证明外部维护封闭、保留原runtime/历史、可信拒绝/签发入口安装、合法处置投影、W3初始化启用的可行依赖次序；循环未闭合时不能提交可执行维护包，不清历史或伪造空runtime。真实proof与G2/G3未知语义先查证，再按现authority补精确任务；实质玩法、架构或影响变化仍须汇总决策。

生产审批只在具体包可审阅后进行：一次披露最终去重依赖包、实际停启对象及身份、共享四项目实际使用任务收妥、时段、回退、12项处置与验证；相同获批范围内重试无需重复批准，超范围才汇总差异。真实首次改次仍需作者具体需求与原按钮触发或同一具体操作授权；count1/no_changes不算改次首用完成。正式路线见 `C:\Code\Nocturnel\docs\plans\2026-10-22-触发限制端到端交付与连续推进总计划.md`；原实施计划继续维护既有阶段证据。

## 权威入口

- 通用执行/验证/恢复协议：[`docs/09_Codex自动化机制.md`](../../docs/09_Codex自动化机制.md)。
- 普通保存字段保护：[`docs/07_校验与保存机制.md`](../../docs/07_校验与保存机制.md)。
- 通用与项目业务分工的既有决定：[`entry-actions-legacy-direct-write-hard-disable.md`](./adr/entry-actions-legacy-direct-write-hard-disable.md)。本次项目交付未改变该 ADR，亦未新增通用 eligibility 决策。
- 项目后续批准范围与实施状态：`C:\Code\Nocturnel\docs\specs\2026-10-22-触发限制来源与统一显示实施计划.md` 第五节为精确准备快照，§6.7记录受限查询和离线候选交付，§6.8记录隔离事务与恢复，§6.9记录受控完整付费链，§6.10为候选审核快照，§6.11记录六项正式L1/L2接入与日常分工，§6.12记录隔离付费正式驱动与最终受控L4通过。§7.4记录隔离v4候选、同按钮与最终绑定正式回归。隔离GUI按钮链已覆盖，生产切换、自然构筑与L5仍为独立后续范围，总体方案仍活跃。
- 受限候选能力与生产写权限分离决定：[`nocturnel-limit-candidate-capability-and-production-activation.md`](./adr/nocturnel-limit-candidate-capability-and-production-activation.md)。

- 通用只读结构展示决定：[`protected-generated-structured-value-display.md`](./adr/protected-generated-structured-value-display.md)。

## 检索词

`limit-request-authoring.v1`、`trait-description-generate.v2`、`trait-existing-limits.v1`、`LIMIT_NOT_PREPARED`、`LIMIT_FALSE_NO_CHANGES`、`limit_note_output`、`project-command-validation`。

<!-- state: history -->
## 演进历史

<!-- dated: 2026-10-22 -->
### 项目程序已交付但尚未准备或切换按钮

前一交付快照包含 30 条全部 `prepared=false`、`adoption=null` 的合同，以及 6 条旧值采用、3 条缺字段补空、8 条空草稿登记、13 条历史保留的待批准预览。当时仅有 31 项新增与 10 项既有工具诊断、bootstrap 和隔离服务链证据，没有正式 HTTP/GUI 或 `stage1.required` 验收；列入基线的 1394 份旧输入哈希无变化，读取依赖为 64 项。这些数字属于准备前快照。后续基于最新作者输入执行精确差异，已完成 17 条准备、正式按钮/权限切换和正式技术门；不能继续用旧缺字段清单或“未启用”结论覆盖当前状态。

### 已被统一嵌套导航取代的显示修复快照

历史显示修复快照（其独立展开方案已被用户后续修正为统一嵌套导航）：表格和详情共用 `src/components/ReadonlyGeneratedValue.tsx`，结构默认折叠、展开后可读且限制尺寸，不增加编辑权限。完成记录包含 typecheck/build 与正式页面回读；330 条特质文件与该轮基线字节一致，Nocturnel 运行代码未变。以上属于该轮交付证据，不代表机制写回或 GA 已完成；本次知识维护未重跑测试。
