# Streamline 逐个 JSX 导出自动化方案

## 方案概述

### 1. 总体目标和范围

本方案用于把 Streamline 网页端当前已经验证可行的单图 `JSX + Copy` 流程，收敛为一个可重复执行、可断点恢复、可批量落盘的自动化导出工具链。

目标是解决以下问题：

- 在网页端 **不支持批量 JSX 导出** 的前提下，仍然能稳定拿到大量 React 可用的 JSX 图标源码
- 把“人工逐个点击复制”的高重复劳动，改造成“浏览器自动化 + 剪贴板读回 + 本地写文件”的可执行流程
- 为后续 React 组件化、资产归档、命名收敛和缺失校验提供干净输入

本方案范围仅包含：

- 图标清单采集
- 浏览器循环导出单图 JSX
- 剪贴板读回与本地文件写入
- manifest 状态落盘
- 失败重试与导出结果校验

本方案不包含：

- Streamline 私有接口逆向
- 自动登录或账号体系改造
- data-editor 运行时直接消费这些导出资产
- JSX 到最终 React 组件 API 的二次封装
- npm 包发布或对外分发

### 2. 各阶段任务概要

#### 阶段一：页面能力与输入清单收敛

主要工作：

- 固化已验证事实：网页端批量态只支持 `SVG / PNG`，不支持批量 `JSX`
- 明确自动化主路径只能走单图 `JSX + Copy`
- 生成待导出图标清单 manifest，作为后续批处理输入

预期成果：

- 一份结构化 manifest
- 每个图标都有唯一标识、来源 URL、导出目标路径和状态位

执行顺序：

1. 选择目标 family / topic
2. 采集图标 URL / slug / 显示名称
3. 初始化 manifest

#### 阶段二：浏览器循环导出

主要工作：

- 逐个进入图标详情页
- 切换 `Export as -> JSX`
- 点击 `Copy`
- 读取浏览器剪贴板
- 校验 JSX 内容后写入本地文件

预期成果：

- 单个图标的自动化导出闭环
- 批量循环可连续执行

执行顺序：

1. 打开图标详情页
2. 校验单图工具条存在
3. 选择 `JSX`
4. 点击 `Copy`
5. 读取剪贴板
6. 落盘并更新 manifest

#### 阶段三：断点恢复与失败重试

主要工作：

- 每成功一个图标立即更新 manifest
- 对失败项保留错误信息和尝试次数
- 支持中断后继续跑未完成项

预期成果：

- 工具可在数千图标规模下可靠执行
- 不依赖人工翻日志恢复现场

执行顺序：

1. 初始化运行状态
2. 成功/失败后即时写回 manifest
3. 重启任务时只继续 `pending` / `failed` 项

#### 阶段四：导出结果校验

主要工作：

- 检查文件数量是否与成功数一致
- 检查是否存在空文件、非 JSX 内容、命名冲突
- 产出失败清单与导出报告

预期成果：

- 明确知道哪些图标已成功导出
- 明确知道哪些图标需要补跑

执行顺序：

1. 扫描输出目录
2. 对比 manifest 状态
3. 生成校验报告

### 3. 整体结构框架

本方案把自动化导出工具拆成三层：

1. **清单层**
   - 负责收集目标图标列表
   - 负责生成和更新 manifest

2. **执行层**
   - 负责控制浏览器
   - 负责页面操作、格式切换、复制和剪贴板读取

3. **结果层**
   - 负责本地文件写入
   - 负责状态回写、校验和报告输出

建议目录结构如下：

```text
scripts/streamline-export/
  collect-streamline-icons.mjs
  export-streamline-jsx.mjs
  verify-streamline-export.mjs
  lib/
    chrome-session.mjs
    streamline-page.mjs
    manifest-store.mjs
    file-writer.mjs
    normalize-name.mjs

artifacts/streamline-export/
  micro-solid.manifest.json
  micro-line.manifest.json
  latest-report.json

vendor/streamline-jsx/
  micro-solid/
  micro-line/
```

---

## 一、现状结论

基于已完成的 Chrome 真实验证，当前网页端能力边界如下：

- 支持单图 `Export as -> JSX`
- 支持单图 `Copy`
- 单图 `Copy` 后可从浏览器剪贴板真实读回 JSX 字符串
- 支持批量选择，页面会进入 `1/100 assets selected` 模式
- 批量态 `Copy` 为禁用状态
- 批量态格式菜单仅有 `SVG / PNG`
- 当前网页端 **不支持批量 JSX 导出**

因此，自动化方案的唯一主路径应为：

```text
逐个图标进入详情页 -> 切到 JSX -> 点击 Copy -> 读取剪贴板 -> 写本地文件
```

---

## 二、方案设计

### 2.1 主方案

主方案采用：

**浏览器驱动 + 剪贴板读回 + manifest 断点恢复**

该方案的判断依据：

- 走的是网页端已验证成功的真实用户路径
- 不依赖私有接口
- 不依赖解析页面内部状态生成 JSX
- 即使中途失败，也可以基于 manifest 继续

### 2.2 不采用的路线

#### 路线 A：继续寻找批量 JSX 导出

不采用原因：

- 已在真实页面中确认批量态没有 `JSX`
- 批量态 `Copy` 为禁用
- 再继续投入只会增加试错成本

#### 路线 B：批量下载 SVG 再统一转 JSX

不作为当前主方案的原因：

- 这条路线偏离了“直接拿 Streamline JSX”的目标
- 会引入额外的本地转换链路和格式差异
- 适合作为后备技术路线，不适合作为当前首选

#### 路线 C：从页面内部状态直接抓 JSX

不作为首选原因：

- 比 `Copy` 这条官方交互更脆
- 更依赖页面内部实现和前端状态结构
- 页面一旦改版，维护成本更高

---

## 三、脚本职责拆分

### 3.1 `collect-streamline-icons.mjs`

职责：

- 访问目标 family / topic 页面
- 收集图标清单
- 生成初始 manifest

输入：

- family，如 `micro-solid`
- 可选 topic，如 `interface-essential`
- 可选数量上限

输出：

- `artifacts/streamline-export/<family>.manifest.json`

manifest 建议字段：

```json
{
  "slug": "attachment-1",
  "name": "Attachment 1",
  "iconUrl": "https://www.streamlinehq.com/icons/download/attachment-1--26582",
  "status": "pending",
  "attempts": 0,
  "outputPath": "vendor/streamline-jsx/micro-solid/attachment-1.jsx",
  "error": null,
  "copiedAt": null
}
```

### 3.2 `export-streamline-jsx.mjs`

职责：

- 读取 manifest
- 对未完成项逐个执行自动化导出
- 实时写回导出状态

单项执行步骤：

1. 打开图标详情页
2. 确认当前处于单图详情模式
3. 找到格式按钮并切换到 `JSX`
4. 点击 `Copy`
5. 读取浏览器剪贴板
6. 校验内容包含 `<svg`
7. 写入目标文件
8. manifest 标记为 `success`

失败处理：

- 记录错误摘要
- `attempts + 1`
- 状态标记 `failed`
- 不中断整批循环

### 3.3 `verify-streamline-export.mjs`

职责：

- 扫描输出目录与 manifest
- 做结果校验
- 生成报告

校验项：

- `success` 数与实际文件数是否一致
- 文件内容是否包含 `<svg`
- 是否存在空文件
- 是否存在重复命名
- 是否存在未处理失败项

输出：

- `artifacts/streamline-export/latest-report.json`

---

## 四、关键数据结构

### 4.1 Manifest

manifest 是整个方案的唯一运行真相来源，不用日志当状态来源。

建议结构：

```json
{
  "family": "micro-solid",
  "generatedAt": "2026-06-23T10:00:00+08:00",
  "items": [
    {
      "slug": "attachment-1",
      "name": "Attachment 1",
      "iconUrl": "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      "status": "success",
      "attempts": 1,
      "outputPath": "vendor/streamline-jsx/micro-solid/attachment-1.jsx",
      "error": null,
      "copiedAt": "2026-06-23T10:01:23+08:00"
    }
  ]
}
```

### 4.2 输出文件

第一版建议直接写原始 JSX 资产文件，不先包成组件。

原因：

- 保持与网页端复制结果一致
- 降低第一阶段复杂度
- 组件化可作为下一阶段单独处理

建议扩展名：

- 默认：`.jsx`

不建议第一版直接输出 `.tsx`，因为当前目标是稳定导出，不是先引入额外类型包装。

---

## 五、执行流程建议

### 5.1 最小执行顺序

```text
采集图标清单
-> 生成 manifest
-> 逐项执行单图 JSX 复制
-> 每项成功立即落盘
-> 每项成功/失败立即更新 manifest
-> 全量完成后做校验
-> 输出报告
```

### 5.2 第一阶段试点

不建议一开始就跑 `Micro Line + Micro Solid` 全量。

建议试点顺序：

1. 先选 `micro-solid`
2. 先限定一个 topic，或前 20 个图标
3. 跑通完整闭环：
   - manifest 生成
   - 单图复制
   - 剪贴板读回
   - 文件落盘
   - 失败重试
   - 报告输出
4. 试点稳定后，再扩到整套 family

这样做的原因：

- 更快发现命名和目录问题
- 更快验证页面结构是否足够稳定
- 失败成本低

---

## 六、风险与约束

### 6.1 页面结构变动风险

风险：

- Streamline 的 hover 控件、格式菜单和详情工具条后续可能改版

应对：

- 把页面选择器封装在 `streamline-page.mjs`
- 不在业务流程里散落硬编码定位逻辑

### 6.2 剪贴板权限风险

风险：

- 浏览器会话、页面权限或自动化上下文可能导致剪贴板读取失败

应对：

- 每次复制后都立即验证剪贴板内容
- 失败时记录错误并进入重试队列

### 6.3 登录态与权限风险

风险：

- 未登录或非 premium 状态下，部分图标可能无法完整导出

应对：

- 启动前先做一次登录态检查
- 如果页面处于未登录态，直接停止执行并报错，不做隐式绕行

### 6.4 大批量执行时间风险

风险：

- 全量数千图标执行时间较长，且容易被用户操作或页面异常打断

应对：

- manifest 断点恢复必须作为一等能力
- 每个图标成功后立即持久化状态

---

## 七、验收标准

本方案落地完成后，至少应满足以下验收条件：

1. 能生成目标 family 的 manifest
2. 能自动进入单图详情并切换到 `JSX`
3. 能点击 `Copy` 并稳定读回剪贴板文本
4. 能把 JSX 写入本地文件
5. 能在中断后从 manifest 继续执行
6. 能产出失败清单与校验报告
7. 能在小范围试点下稳定运行，不依赖人工逐个复制

---

## 八、待确认决策

在进入实施前，需要确认以下决策：

### 决策 1：输出文件是否只保留原始 JSX

推荐方案：

- **只保留原始 JSX 文件**

理由：

- 与网页端复制结果一致
- 第一阶段复杂度最低
- 后续组件化可独立进行

### 决策 2：第一批试点范围

推荐方案：

- **先跑 `micro-solid` 的单个 topic 或前 20 个图标**

理由：

- 能快速验证脚本稳定性
- 失败成本更低
- 便于收敛命名与目录结构

### 决策 3：整套导出是否接受长时间后台执行

推荐方案：

- **接受长时间执行，但必须具备断点恢复**

理由：

- 数千图标规模不适合一次性无状态跑完
- 断点恢复比追求单次跑通更重要

---

## 九、推荐下一步

推荐下一步不是直接全量运行，而是进入实施计划阶段，明确：

- 每个脚本的输入输出
- 目录与文件职责
- 首批试点执行顺序
- 失败处理与校验命令

等你确认本方案方向后，再继续写实施计划文档。
