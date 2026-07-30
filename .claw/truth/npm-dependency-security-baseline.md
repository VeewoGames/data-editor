# npm 依赖安全基线：同主版本修复、锁文件状态与验证边界

<!-- state: current -->
## 当前状态

### 1. 当前依赖基线已切换到安全的同主版本

当前工作树中的依赖清单与锁文件使用以下版本：

- `ajv`: `8.20.0`
- `fast-uri`: `3.1.4`
- `vite`: `8.1.5`
- `postcss`: `8.5.25`

`ajv` 与 `vite` 是 `package.json` 中的直接依赖；`fast-uri`、`postcss` 及随锁文件解析更新的 `nanoid`、`rolldown` 由 `package-lock.json` 固定。判断真实安装基线时应同时检查依赖清单和锁文件，不能只看直接依赖声明。

### 2. 本地漏洞状态以当前锁文件对应的 `npm audit` 为准

GitHub 告警数量可能来自较早的远端扫描快照，或按 advisory 分项计数，因此不应直接与本地 `npm audit` 的聚合数量互换。只有提交并推送锁文件、等待远端重新扫描后，才能把 GitHub 告警状态写成已清除；当前 Truth 不声称远端复扫已经完成。

<!-- state: current -->
## 约束与复用规则

- 优先采用已有安全修复版本的同主版本升级，不用 `npm audit fix --force` 绕过主版本兼容性判断。
- 每次治理先根据当前锁文件运行 `npm audit` 并检查依赖树，区分直接依赖、间接依赖和 advisory 聚合差异。
- 更新后必须核对 `package-lock.json` 的实际解析版本，并执行类型检查、构建及受影响依赖对应的相关测试。
- 若唯一修复路径要求主版本升级，应把它作为独立兼容性决策处理，不能把未验证的破坏性升级写成治理完成。
- 远端告警只有在相应依赖文件已推送并完成平台复扫后，才可记录为已清除。

<!-- state: current -->
## 相关实现

- `package.json`
- `package-lock.json`

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-29 -->
### 完成 `ajv`、`fast-uri`、`vite` 与 `postcss` 的同主版本漏洞修复

当次升级前，本地 `npm audit` 将锁文件归并为 3 条漏洞：`ajv` 1 条中危、`fast-uri` 1 条高危、`postcss` 1 条高危；升级后结果为 `0 vulnerabilities`。

完成记录还确认 TypeScript 类型检查、Vite 构建和 AJV 合同校验相关 48 项测试通过。当次任务的实现变更仅涉及 `package.json` 与 `package-lock.json`；该结论只说明 2026-07-29 的升级没有暴露已覆盖的类型、构建或 AJV 合同回归，不替代未来依赖变化后的重新审计与验证。

## 检索词

`npm audit`、`audit fix --force`、`ajv`、`fast-uri`、`vite`、`postcss`、`package-lock.json`、依赖漏洞、GitHub advisory
