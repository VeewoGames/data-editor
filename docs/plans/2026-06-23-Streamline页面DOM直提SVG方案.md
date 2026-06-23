# Streamline 页面 DOM 直提 SVG 方案

## 方案概述

### 1. 总体目标和范围

本方案用于在 Streamline 网页端不适合走批量下载、`SVG Copy` 又会卡在 `COPYING...` 的前提下，直接从图标详情页的页面 DOM 中提取当前图标的 inline SVG，落盘为本地 `.svg` 原始资产。

目标是解决以下问题：

- 避开官方对连续下载的阻断
- 避开 `SVG Copy` 卡住且不写入剪贴板的问题
- 保持 `SVG` 作为主资产格式，而不是退回 `JSX`
- 建立一条可断点恢复、可批量执行、可校验的采集链路

本方案范围仅包含：

- 图标清单采集
- 图标详情页 DOM 定位
- 当前选中图标的 inline SVG 提取
- 本地 `.svg` 文件写入
- manifest 状态回写
- 缺失、重复、异常校验

本方案不包含：

- Streamline 私有接口逆向
- 自动登录或账号体系改造
- `svg -> jsx/tsx` 转换
- data-editor 运行时直接消费这些资产
- npm 包发布

### 2. 各阶段任务概要

#### 阶段一：页面真值边界确认

主要工作：

- 固化当前网页端结论：批量下载不稳定、`SVG Copy` 会卡住、`JSX Copy` 可用但不适合作为 SVG 主资产方案
- 确认图标详情区和列表卡片中都存在 inline SVG
- 明确应当抓取“当前激活详情图标”的 SVG，而不是列表任意卡片

预期成果：

- 一套可复用的 DOM 定位规则
- 明确的“采什么，不采什么”的边界

执行顺序：

1. 确认当前图标详情模式
2. 确认详情工具条与当前图标名称
3. 确认详情对应 SVG 宿主节点

#### 阶段二：清单与 manifest 初始化

主要工作：

- 采集目标 family / topic / icon url 列表
- 生成待处理 manifest
- 为每个图标记录唯一 slug、来源 URL、输出路径和状态位

预期成果：

- 一份结构化图标 manifest

执行顺序：

1. 采集 family / topic
2. 收集图标详情 URL 或 slug
3. 初始化 manifest

#### 阶段三：DOM 提取与落盘

主要工作：

- 逐个进入图标详情页
- 从当前详情区读取 inline SVG
- 做最小清洗
- 写入本地 `.svg` 文件
- 更新 manifest 状态

预期成果：

- 单图采集闭环
- 可连续批量执行

执行顺序：

1. 打开图标详情页
2. 验证当前图标 slug / 标题
3. 抓取详情区 SVG outerHTML
4. 校验内容包含 `<svg`
5. 落盘并回写 manifest

#### 阶段四：断点恢复与结果校验

主要工作：

- 每个图标成功后即时更新 manifest
- 对失败项记录错误与尝试次数
- 扫描输出目录，检查空文件、重复文件与缺失项

预期成果：

- 可断点恢复
- 可产出清晰的失败补跑清单

执行顺序：

1. 成功/失败即时写回
2. 重跑仅继续 `pending` / `failed`
3. 最终输出校验报告

### 3. 整体结构框架

本方案把自动化链路拆成三层：

1. **清单层**
   - 收集目标图标列表
   - 管理 manifest

2. **提取层**
   - 控制浏览器进入详情页
   - 定位当前详情图标对应的 SVG
   - 提取 inline SVG 文本

3. **资产层**
   - 写入 `.svg`
   - 做命名与目录归档
   - 输出校验报告

建议目录结构如下：

```text
scripts/streamline-export/
  collect-streamline-icons.mjs
  extract-streamline-svg-dom.mjs
  verify-streamline-svg.mjs
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

vendor/streamline-svg/
  micro-solid/
  micro-line/
```

---

## 一、现状结论

基于已完成的真实验证，当前能力边界如下：

- 批量下载 SVG 可能在大量连续操作下被官方阻断
- 单图 `SVG Copy` 会卡在 `COPYING...`
- 自动化点击 `SVG Copy` 不会覆盖浏览器会话剪贴板
- 同页 `JSX Copy` 可正常写入剪贴板
- 页面列表卡片和详情区都存在 inline SVG

因此，当前最合理的主路径应为：

```text
进入图标详情页 -> 从页面 DOM 直接读取当前图标 SVG -> 写本地 .svg 文件
```

这条路径的关键优势是：

- 不走下载链路
- 不依赖失效的 `SVG Copy`
- 不牺牲 SVG 作为原始资产格式

---

## 二、为什么选 DOM 提取而不是其他路线

### 2.1 不再选批量下载 SVG

原因：

- 用户已确认大量连续下载会被官方阻断
- 即使页面支持下载，工程上也不稳定

### 2.2 不再选 `SVG Copy`

原因：

- 真实手动点击会卡在 `COPYING...`
- 自动化点击不会写入剪贴板
- 当前证据已足够判定其不适合作为主方案

### 2.3 不退回 `JSX Copy`

原因：

- JSX 可作为消费产物，不适合作为 SVG 主资产真相
- 目标已经明确为保留 SVG

### 2.4 选择 DOM 提取的理由

- 页面已经渲染出 SVG 真值
- 不需要走额外导出/复制逻辑
- 技术路径最短
- 有利于保持采集结果与页面当前展示一致

---

## 三、DOM 提取规则

### 3.1 提取对象

必须提取：

- **当前详情图标对应的 SVG**

不能提取：

- 图标列表任意卡片里的 SVG
- hover 预览中的 SVG
- 非当前选中图标的相邻卡片 SVG

### 3.2 定位原则

应优先利用以下信号绑定“当前详情图标”：

1. 当前 URL 中的 `icon=` 参数
2. 详情区标题 / 名称
3. 详情区导出工具条紧邻的图标预览容器
4. 与当前标题、分享链接、风格切换共同存在的局部容器

### 3.3 提取内容

建议直接提取：

- 详情区 SVG 节点的 `outerHTML`

不建议只提取：

- 单个 `path`
- 内联 style 片段
- 已经 React 化的 JSX 属性

目标文件应保持标准 SVG 属性风格，不应保存成 React 属性名。

---

## 四、脚本职责拆分

### 4.1 `collect-streamline-icons.mjs`

职责：

- 采集目标 family / topic 下的图标清单
- 生成初始 manifest

输入：

- family，如 `micro-solid`
- 可选 topic
- 可选数量上限

输出：

- `artifacts/streamline-export/<family>.manifest.json`

manifest 单项建议字段：

```json
{
  "slug": "attachment-1",
  "name": "Attachment 1",
  "iconUrl": "https://www.streamlinehq.com/icons/download/attachment-1--26582",
  "status": "pending",
  "attempts": 0,
  "outputPath": "vendor/streamline-svg/micro-solid/attachment-1.svg",
  "error": null,
  "extractedAt": null
}
```

### 4.2 `extract-streamline-svg-dom.mjs`

职责：

- 读取 manifest
- 对未完成项逐个进入详情页
- 提取当前图标详情区 SVG
- 写入本地文件并更新状态

单项步骤：

1. 打开图标详情页
2. 校验当前 slug / 标题匹配
3. 定位详情区 SVG
4. 读取 `outerHTML`
5. 校验内容包含 `<svg`
6. 写入本地 `.svg`
7. manifest 标记 `success`

失败处理：

- 记录错误摘要
- `attempts + 1`
- 状态标记 `failed`
- 不阻断整批流程

### 4.3 `verify-streamline-svg.mjs`

职责：

- 扫描输出目录与 manifest
- 检查空文件、缺失项、重复命名与无效 SVG
- 输出报告

输出：

- `artifacts/streamline-export/latest-report.json`

---

## 五、目录与命名策略

建议按 family 物理分目录：

```text
vendor/streamline-svg/
  micro-solid/
  micro-line/
```

文件命名建议：

- 默认使用页面 slug
- 如 `attachment-1.svg`

原因：

- 与页面 URL 对齐
- 稳定、可追溯
- 便于后续转换为组件名

如果后续要保留显示名称映射，可额外在 manifest 中记录：

- `slug`
- `name`
- `iconUrl`
- `outputPath`

---

## 六、执行流程建议

### 6.1 最小执行顺序

```text
采集图标清单
-> 生成 manifest
-> 逐个进入详情页
-> 提取详情区 SVG outerHTML
-> 写本地 .svg
-> 每项成功/失败即时更新 manifest
-> 全量完成后做校验
-> 输出报告
```

### 6.2 第一阶段试点

不建议一开始就跑整套。

推荐试点顺序：

1. 先选 `micro-solid`
2. 先跑前 10 到 20 个图标
3. 验证：
   - URL 与当前详情区是否稳定匹配
   - 提取到的是当前图标，而不是列表别的 SVG
   - 输出文件可正常打开
   - manifest 与文件数一致

试点稳定后，再扩到整个 topic，再扩到整个 family。

---

## 七、风险与约束

### 7.1 抓错 SVG 风险

风险：

- 页面同时存在详情区图标和列表卡片图标
- 如果选择器不够精确，容易抓到错误 SVG

应对：

- 必须把 URL / 标题 / 详情区工具条作为联合锚点
- 不允许只按“页面第一个 svg”这类脆弱规则提取

### 7.2 页面结构变动风险

风险：

- Streamline 后续改版会影响 DOM 定位

应对：

- 所有页面结构逻辑集中在 `streamline-page.mjs`
- 业务脚本只调用语义化 helper

### 7.3 详情区 SVG 与最终下载 SVG 不完全一致风险

风险：

- 页面展示 SVG 可能包含展示态颜色、尺寸或属性补充

应对：

- 第一阶段先接受“页面真值即导出真值”
- 如果后续发现展示态污染，再单独做最小清洗规则

### 7.4 大批量执行时间风险

风险：

- 数千图标逐个详情页提取耗时较长

应对：

- manifest 断点恢复必须是一等能力
- 每成功一项就立即持久化状态

---

## 八、验收标准

本方案完成后，至少应满足以下条件：

1. 能生成目标 family 的 manifest
2. 能逐个进入图标详情页
3. 能稳定提取当前详情图标的 SVG，而不是列表其他图标
4. 能把 SVG 写入本地 `.svg` 文件
5. 能在中断后从 manifest 继续执行
6. 能输出失败清单与校验报告
7. 试点范围内结果可人工抽样验证正确

---

## 九、待确认决策

### 决策 1：是否接受“页面展示 SVG”作为第一版主真相

推荐方案：

- **接受**

理由：

- 当前最可执行
- 能最短路径拿到 SVG 原始资产
- 后续如发现展示态污染，再加清洗层

### 决策 2：第一批试点范围

推荐方案：

- **`micro-solid` 前 10 到 20 个图标**

理由：

- 足够验证 URL / 详情区 / SVG 对齐关系
- 失败成本低

### 决策 3：是否在第一版就做 SVG 清洗

推荐方案：

- **先不做**

理由：

- 先拿到真值
- 只有在确认展示态属性确实影响后续使用时，再加最小清洗规则

---

## 十、推荐下一步

推荐下一步进入实施计划阶段，继续明确：

- 当前详情图标的精确 DOM 定位规则
- `streamline-page.mjs` 的 helper 接口
- manifest 字段最终结构
- 试点执行顺序
- 校验命令与失败补跑策略

等确认本方案方向后，再继续写实施计划文档。
