# entryActions 第二版方向收敛：放弃项目共享，转为双层个人化配置

status: accepted

## context

这条 truth 只沉淀 `entryActions` 第二版的长期产品与架构判断。

当前代码里已经存在第一版条目级自动化闭环：项目通过 `Project Settings` 维护 `entryActions`，详情面板按当前项目配置与目标过滤按钮，服务端再走 `entry-actions/run` handoff 链路。

但第二版不再把这套“项目共享动作定义”继续当作最终产品方向。这里保留的是为什么要转向，以及转向后哪些边界不应再重新打开。

## 结论

### 1. 项目共享 `entryActions` 不适合作为长期产品方向

第一版把 `entryActions` 放进项目级配置，适合验证详情按钮、payload 和 handoff 链路是否能跑通；但它不适合继续扩展成长期产品模型。

根因不是按钮渲染或运行时链路不稳定，而是动作真正要调用的能力天然依赖环境：

- 不同用户绑定的 Codex 入口可能不同
- 不同用户安装的 skill 可能不同
- 同一个用户在不同设备上的本地工作流也可能不同

因此，项目共享配置很难同时满足“可执行”和“可移植”。

### 2. 项目级配置如果不绑定真实入口，会退化为空壳按钮；如果绑定个人入口，又会失去可移植性

项目级动作定义只有两种方向：

- 不绑定实际 skill / Codex 入口，只保留 `label`、目标和壳层动作定义
- 直接绑定某个用户、某台设备的 skill、Codex 启动方式或本地包装器

前者无法保证按钮在不同用户、不同设备上真的可执行，后者会把个人环境细节写进项目真值。

所以第二版不应继续在项目层寻找“共享动作协议”的折中解。

### 3. 第二版长期方向改为双层个人化

长期方向应明确为：

- 每个用户维护自己的动作规则
- 动作规则可以跨设备共享
- 真正的执行绑定留在当前设备本地

换句话说，条目级自动化的真正归属是：

- 用户级的自动化意图
- 加上设备级的执行能力

而不是项目共享元数据。

### 4. 共享规则层和设备绑定层必须分开

双层结构中：

- 上层“共享规则”负责描述：哪些条目该显示什么按钮、带哪些 payload
- 下层“设备绑定”负责描述：这台设备上这个按钮实际绑定哪个 skill / Codex 入口

这两层不能合并成单层“全本地”，也不能都做成跨设备完全同步。

补充边界：

- 共享规则层是正式用户配置，但不默认承诺天然跨设备同步
- 是否跨设备共享，由 profile home 或后续部署方式决定
- 自动化规则不绑定 `selectedViewProfile`
- 设备绑定层必须放在独立本地正式配置里，不用 `localStorage` 作为长期方案

### 5. 第二版 UI 入口不应继续挂在 `Project Settings`

既然第二版配置归属不再是项目级，就不应继续把入口放在 `Project Settings`。

`Project Settings` 仍然适合项目共享元数据，不适合作为用户私有规则和设备绑定的长期承载面。

第二版应转为独立的用户级自动化设置入口，例如“Automation Settings”或同类个人入口，而不是继续扩展项目设置弹窗。

### 6. 第二版首批实现优先级是规则层 + 绑定层的最小闭环

第二版首批实现应优先收敛四件事：

- 用户级配置入口
- 共享动作规则编辑器
- `target file` / `collection` 选择器
- 当前设备执行绑定编辑器

运行历史展示不属于首批优先级。原因是第二版当前最重要的是把配置归属、编辑语义和目标匹配闭环迁移到正确层级，而不是先堆运行态面板。

## 长期规则

### 1. 第一版代码事实仍然成立，但只应作为已验证的 MVP 运行时链路

当前项目里关于 `entryActions` 的第一版事实仍然有效：

- `src/App.tsx` 中的 `ProjectSettingsDialog` 负责项目级维护入口
- `src/project-registry.mjs` 仍是第一版项目配置真值承载层
- `src/detail/DetailPanel.tsx` 与 `src/entry-actions.mjs` 仍是现有按钮过滤和 handoff 运行时链路

这些锚点说明第一版已经验证了动作按钮与执行链路本身，而不是说明项目共享配置应继续作为第二版长期方向。

### 1.1 第二版迁移要以“清理旧真值”为目标

既然当前项目仍处于早期草稿阶段，第二版迁移不应为了兼容成本而长期保留：

- `Project Settings` 里的旧 `entryActions` 编辑入口
- 项目级 `entryActions` 旧真值
- 项目级与个人级两套长期双读逻辑

正确方向是：提供一次性的迁移 / 导入能力，然后收口到新的双层个人化配置链。

### 2. 后续不要再把“完全本地化”或“完全跨设备同步”当成默认终局

当前产品阶段真正稳定的方向是双层个人化：

- 用户共享动作规则
- 设备本地执行绑定

后续如果需要复盘第二版方向，默认先检查这两层是否被错误合并，而不是重新回到单层模型。

### 3. 第二版需求评审时，优先检查配置归属是否被重新混回项目层

只要需求包含下面任一倾向，就应视为偏离这条 truth：

- 把个人 skill / Codex 绑定重新写回项目配置
- 继续把第二版主入口挂在 `Project Settings`
- 把设备本地绑定错误做成跨设备完全同步
- 在双层配置闭环完成前优先做运行历史展示

## 关联代码

- `src/App.tsx`
- `src/detail/DetailPanel.tsx`
- `src/api/client.ts`
- `src/project-registry.mjs`
- `src/entry-actions.mjs`
- `server.mjs`
- `scripts/run-entry-action.mjs`

## 关联文档

- `docs/plans/2026-07-01-entryActions第二版体验方案.md`
- `.claw/truth/detail-panel-entry-codex-automation-boundary.md`

## 关键检索词

- `entryActions`
- `Project Settings`
- `Automation Settings`
- `dual-layer personalization`
- `shared action rules`
- `device-local binding`
- `detail panel codex automation`
