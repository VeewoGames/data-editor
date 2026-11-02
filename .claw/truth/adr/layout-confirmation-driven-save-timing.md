# ADR：布局按确认事件驱动保存时机

## 背景

2026-11-02 状态更新：本 ADR 的布局确认调度已随配置阶段正式激活至 generation 8，正式前端为已验收预编译产物，根目录开发端源码未同步。配套配置安全与跨版本验收见[正式激活记录](../../../docs/records/2026-11-02-配置保存修复与跨版本校验正式激活记录.md)。下文保留设计接受时的背景和验证要求，不再代表“尚未实施”的当前结论；业务保存、Job 及启动改造仍未完成。

布局字号、主题等离散操作和连续拖动拥有不同确认边界，统一 800ms 防抖会造成可感知等待。在途请求完成后再起同一窗口还会增加交叠等待。用户于 2026-11-01 同意更新方案；本决策仅接受设计，未授权实施或正式激活。当前调度和隔离 S0 证据范围由[保存 Truth](../large-file-performance-and-configuration-autosave.md)维护。

## 决策

既有 profile owner 负责确认值及完整可提交快照；控件负责 preview / commit / cancel，单一 coordinator 负责 scope/revision、ready 资格和串行调度。真实变化的离散布局确认后立即排队；连续拖动 move 只预览，在原确认结束事件提交最终值。缺可靠 end 的来源只有已经按原合同确认才可采用短合并兜底；150–250ms 只是未来验证候选，不是已验参数。前序成功释放 inFlight 后消费最新 ready 布局，不再首次或续轮统一等待 800ms；立即排队不等于立即落盘。

完整 profile 保留全部已确认修改和个人视图草稿，排除活跃预览与未确认输入；不改 patch 协议。同目标非布局 intent 按原合同尚未就绪时等待必要依赖，再完整发送，不拼接字段 baseline。其它域及文本/IME 时机不变。已发快照不可替换，旧 ACK 不清新 revision / scope；失败、blocked、deferred 和 unknown 沿既有门，不新增自动重放、超时释放或恢复机制。

取消沿原控件合同：列宽 pointercancel 也提交 lastWidth，侧栏和详情面板 cancel 仅清理。blur、lost capture、unmount、切 scope 和短计时都不能自行确认预览；已确认 dirty 继续受原强 flush / 阻止切换合同保护。纯布局不得执行无关文档前置，但未证明独立的必要依赖不能越过。

## 备选方案

- 所有布局首次仍等 800ms、仅去掉 ACK 后重复防抖：未满足用户已确认的操作结束保存语义。
- 用短 timer 周期保存拖动或把所有 cancel 统一视为确认/撤销：会泄漏预览或改变原控件合同。
- 立即发送任意 UI profile、字段拼装或改 patch 协议：会夹带未确认状态、提前其它 intent 或增加本轮不需要的协议复杂度。
- 将整个 S2 期限/CAS 或 L3 无历史迁移作为 L1 前置：超出独立布局时机修订范围；已有保护仍必须保留。

## 影响与验证

实施需先闭合确认快照边界，再开放 ready 调度。依据入口为 `src/App.tsx` 的 `mutateSelectedViewProfile`、`handleChangeTheme`、`handleChangeBaseFontSize`、`beginSidebarResize`，`src/detail/DetailPanel.tsx::beginPanelResize`，`src/table/ColumnHeader.tsx` 的结束回调，以及 `src/save-coordinator.ts::schedule/runFlush`。正式前端维护须遵守[交付身份边界](../data-loading-candidate-and-v2-forward-upgrade-boundary.md)，不能把根源码检查当成正式产物已改变。

未来验收记录 confirm→ready→dispatch、HTTP、ACK 与请求数：离散确认无固定等待；长拖动跨多个旧窗口仍零中间 POST；另一布局确认不夹带活跃 preview；cancel、重复结束、旧 ACK、新 dirty、scope、完整个人草稿及同目标非布局未就绪依赖分别覆盖。失败不重放、deferred 不忙转、其它域不提前，单独布局和交叠分别报告。L2 名称登记 no-op 与 L3 当前控制检查点保持独立，HTTP 成本须另测。本轮仅完成方案修订及复核，未运行这些未来验收，不宣称性能收益。
