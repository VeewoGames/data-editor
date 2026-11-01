# shared view 图标多轮保存：持久化、快照与验证边界

<!-- document-state: current -->
<!-- state: current -->

## Current behavior

shared view顶层view/group icon是first-class persisted field，和结构身份、名称及顺序共同保存，不是渲染时随意推导的装饰。删除、重建、复制、normalize、迁移和profile序列化都必须保留icon。

多轮保存问题要区分两类机制：结构重建漏字段；连续保存读取旧快照并覆盖前一次新值。一次HTTP成功不能证明多轮操作后磁盘与刷新结果仍正确。

## 长期规则

### 1. 全部持久化表面保留结构字段

collection items重建带回leaf icon，group duplicate复制group.icon；命名profile的structureDrafts及其normalize/serialize/migrate完整保留group icon。viewDrafts、viewLayouts、path migration或local drafts只要承载该字段，也必须遵守同一保留边界。

结构字段不能只在shared config正确、到profile就静默丢失。排查入口包括delete/rename、duplicate、direct save、publish draft、structure reorder和profile处理，不先假定网络波动或某一个helper负责全部故障。

### 2. team与personal保存语义分别验证

team mode普通编辑/结构拖拽先入draft或structure draft，再由显式“保存团队共享视图”发布；personal mode这类shared view编辑/重排直接保存正式shared config。个人profile布局与共享内容的owner仍分开，不能用个人布局覆盖团队共享配置。

必须分别验证filter修改后发布、top-level view重排、group structure draft落盘回读、personal direct save及刷新。没有覆盖某种组合时，不能用一次成功扩大为所有模式/动作已验。

### 3. 连续保存共享最新ref与React state

`src/App.tsx::commitSharedViewsConfig(...)` 同步更新 `sharedViewsConfigRef.current` 和React state；成功保存后的状态提交沿该入口维护一致性。`enqueueSharedViewDirectSave(...)` 的下一次mutator必须消费最新已提交配置，不能只等useEffect下一拍同步ref。

保存时序的典型反证是先改icon成功，再立即reorder：若第二次读取旧ref，就会把新icon覆盖成旧值。刷新只是读出已写坏的共享配置，不应直接被当作丢字段源头。

profile保存的keepalive降低离页/刷新时请求丢失概率，但不代替字段完整性与快照一致性。不能以“请求发出/成功”推断后续保存未覆盖新内容。

### 4. 最小复现与文件证据

记录mode、profile是否命名、顶层view/group/leaf、是否刚改icon、后续filter/sort/rename/delete/duplicate/reorder/模式切换/publish/direct-save/refresh序列，以及立即消失还是刷新后消失；team模式还要区分发布前后。

文件取证至少对比两次保存后的共享配置：第一次写入新icon；第二次操作是否仍保留该值。复现使用明确选择的独立fixture，不要求真实项目路径或公开个人profile内容。

## 验证边界

回归按保存入口拆开：view-state的rename/delete/group复制，profile normalize/保存/加载，local draft读写及path migration，team发布与personal direct-save，紧邻icon更新的即时重排与刷新。命名profile的structure draft和顶层group/view都要覆盖。

相关现有入口为 `tests/view-state.test.mjs`、`tests/view-state-storage.test.mjs`、`tests/view-profile.test.mjs`、`tests/path-migration.test.mjs` 与 `tests/data-editor.spec.ts`。测试是否存在及本轮结果须按当前树与实际执行核对；旧Chrome现场只证明当时复现的链路，不能宣称所有多轮组合已穷尽。

## References

- [应用内ref/state与保存队列](C:/Code/data-editor/src/App.tsx)
- [保存客户端与keepalive](C:/Code/data-editor/src/api/client.ts)
- [共享view结构处理](C:/Code/data-editor/src/view/view-state.mjs)
- [协作模式与保存通用合同](C:/Code/data-editor/.claw/truth/shared-view-collaboration-mode-routing-and-save-contract.md)

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 事故与项目现场来源

旧实现曾分别在删除后重建items、group duplicate及命名profile normalize时漏icon，另有连续保存旧ref覆盖新值的独立缺陷。这些是通用事故机理，不能读成当前仍未修复的状态。

原题“shared view 图标多轮保存 follow-up：剩余真实根因、当前验证边界与复现收口”中的真实游戏文件、命名profile和Chrome具体现场移交[项目历史索引](C:/Code/Nocturnel/.claw/truth/tech/data-editor/编辑器侧项目知识承接与历史索引.md)；[原字节对象](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/objects/c324f3f85e3473671696739e39ca9348faeaa554ed29b5da1498a1cd382ff201.source)保留全部现场、旧测试名称和证据。本文没有复制个人profile文件，也不把当次现场提升为所有项目的当前验收。
