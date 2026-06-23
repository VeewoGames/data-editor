# Streamline 批量 SVG 导出自动化方案

## 方案概述

### 1. 总体目标和范围

本方案用于把 Streamline 网页端已经验证存在的批量导出能力，收敛为一个以 **SVG 作为主资产格式** 的自动化导出工具链。目标不是直接拿 React 组件，而是先稳定沉淀原始 SVG 资产库，再把 JSX / TSX 转换留到后处理阶段。

本方案要解决的问题：

- 在网页端能力边界下，找到最稳妥的 **批量获取图标原始资产** 的方式
- 把人工多选、导出、下载、整理、核对，改造成可追踪、可断点恢复的自动化流程
- 形成一套后续可以反复复用的 SVG 资产导入链路

本方案范围仅包含：

- 图标清单采集
- 批量选择与批量导出 SVG
- 下载结果落盘
- ZIP 解包与 SVG 归档
- manifest 状态记录
- 缺失、重复、异常校验

本方案不包含：

- React 组件生成
- `svg -> jsx/tsx` 转换实现
- npm 包发布
- Streamline 私有接口逆向
- 自动登录或账号体系改造
- data-editor 运行时直接消费这些导出结果

### 2. 各阶段任务概要

#### 阶段一：页面能力与导出边界确认

主要工作：

- 固化网页端已验证事实：批量态支持 `SVG / PNG`，不支持批量 `JSX`
- 明确 SVG 是当前网页端最现实的批量主路径
- 确认批量上限、选择态 UI、下载动作和登录依赖

预期成果：

- 一份明确的页面能力边界结论
- 可作为脚本输入的批量导出约束

执行顺序：

1. 确认目标 family / topic
2. 确认批量态入口与上限
3. 确认导出格式和下载行为

#### 阶段二：导出清单生成

主要工作：

- 生成待导出的图标清单或批次清单
- 明确每个批次的 family、topic、目标数量和输出目录
- 初始化 manifest，作为后续导出和校验真相来源

预期成果：

- 一份结构化批次 manifest
- 每个批次都有唯一标识、来源页面、状态位和输出位置

执行顺序：

1. 采集 family / topic
2. 生成批次定义
3. 初始化 manifest

#### 阶段三：批量 SVG 导出执行

主要工作：

- 进入目标页面
- 通过真实页面选择控件进入批量态
- 维持每批最多 `100` 个资产的选择边界
- 执行 `SVG` 导出并触发下载

预期成果：

- 可稳定触发批量 SVG 下载
- 每个批次都有对应导出产物和状态记录

执行顺序：

1. 进入目标页面
2. 按批次选择图标
3. 确认批量态
4. 选择 `SVG`
5. 触发下载
6. 更新 manifest

#### 阶段四：解包整理与校验

主要工作：

- 对下载结果解压
- 把 SVG 归档到标准目录
- 检查空文件、重复命名、缺失项和异常批次
- 生成最终报告

预期成果：

- 一套可复用的原始 SVG 资产库
- 一份完整性报告

执行顺序：

1. 解压 ZIP
2. 平铺或按 family/topic 归档
3. 对比 manifest
4. 输出报告

### 3. 整体结构框架

本方案把导出链路拆成三层：

1. **批次层**
   - 定义导出单位
   - 管理 family / topic / 批次边界

2. **执行层**
   - 控制浏览器
   - 负责选择、导出、下载、下载完成检测

3. **资产层**
   - 负责 ZIP 解包、SVG 归档、命名映射、校验报告

建议目录结构如下：

```text
scripts/streamline-export/
  collect-streamline-batches.mjs
  export-streamline-svg.mjs
  unpack-streamline-svg.mjs
  verify-streamline-svg.mjs
  lib/
    chrome-session.mjs
    streamline-page.mjs
    manifest-store.mjs
    download-store.mjs
    archive-store.mjs
    normalize-name.mjs

artifacts/streamline-export/
  micro-solid.manifest.json
  micro-line.manifest.json
  latest-report.json

vendor/streamline-svg/
  raw-zips/
    micro-solid/
    micro-line/
  extracted/
    micro-solid/
    micro-line/
  manifest/
```

---

## 一、现状结论

基于已完成的网页端真实验证，当前能力边界如下：

- 网页端支持批量选择
- 批量态页面会显示 `1/100 assets selected`
- 批量态支持 `Download`
- 批量态格式菜单只有 `SVG / PNG`
- 批量态 `Copy` 为禁用
- 单图模式支持 `JSX + Copy`，但这不适合作为批量主路径

因此，当前最合理的主路线应为：

```text
批量选择 -> 选择 SVG -> 批量下载 -> ZIP 解包 -> 归档为原始 SVG 资产库
```

这条路线的核心判断是：

- **SVG 是网页端天然支持的批量格式**
- **SVG 更适合做长期原始资产**
- JSX / TSX 更适合作为下游派生产物，而不是导入主格式

---

## 二、为什么选 SVG 而不是 JSX

### 2.1 SVG 的优势

- 是标准原始图形格式，不绑定 React
- 更适合批量下载、归档、重命名和去重
- 后续可以转换成 JSX、TSX、sprite、设计稿素材等多种产物
- 不会把网页端当前 JSX 输出细节绑定成长期真相

### 2.2 JSX 不适合作为当前主资产

- 网页端不支持批量 JSX
- 单图 `JSX + Copy` 只适合按需兜底，不适合作为数千图标的主导入路径
- 直接保存网页端 JSX，会把当前 React 属性形态、尺寸属性和注释一起固化进资产层

### 2.3 结论

当前推荐结构是：

- **主资产格式：SVG**
- **后处理格式：JSX / TSX**

也就是说，自动化导出链路负责“拿到干净 SVG”，组件化链路负责“把 SVG 转成 React 可用形式”。

---

## 三、导出单位设计

### 3.1 为什么不能把“整套 family”当作单批次

网页端批量态真实显示 `1/100 assets selected`，说明单次导出有明确上限。

因此不能把整套 family 直接看成一个导出动作，而应拆成多个批次。

### 3.2 批次定义

建议把一个批次定义为：

- 一个 family
- 一个 topic 或一个连续分段
- 一个不超过 `100` 个图标的导出单元

示例：

```json
{
  "batchId": "micro-solid-interface-essential-001",
  "family": "micro-solid",
  "topic": "interface-essential",
  "startIndex": 0,
  "endIndex": 99,
  "expectedCount": 100,
  "status": "pending",
  "zipPath": null,
  "error": null
}
```

### 3.3 推荐批次组织方式

优先级建议如下：

1. **按 topic 分批**
2. topic 内再按 `100` 个一批切段

不建议直接按无限滚动裸选全页，原因是：

- 不利于追踪缺失和重跑
- 页面虚拟滚动和 hover 选择更脆
- 批次粒度太粗，失败恢复成本高

---

## 四、脚本职责拆分

### 4.1 `collect-streamline-batches.mjs`

职责：

- 采集目标 family / topic
- 按 `100` 个上限切批次
- 生成初始 manifest

输入：

- family，如 `micro-solid`
- 可选 topic，如 `interface-essential`
- 可选数量上限

输出：

- `artifacts/streamline-export/<family>.manifest.json`

建议 manifest 结构：

```json
{
  "family": "micro-solid",
  "generatedAt": "2026-06-23T10:00:00+08:00",
  "batches": [
    {
      "batchId": "micro-solid-interface-essential-001",
      "topic": "interface-essential",
      "startIndex": 0,
      "endIndex": 99,
      "expectedCount": 100,
      "status": "pending",
      "zipPath": null,
      "extractPath": null,
      "error": null,
      "attempts": 0
    }
  ]
}
```

### 4.2 `export-streamline-svg.mjs`

职责：

- 读取批次 manifest
- 对未完成批次执行批量选择和 SVG 下载
- 记录下载结果

单批次步骤：

1. 打开目标 family / topic 页面
2. 定位目标批次图标范围
3. 用真实页面多选控件加入选择
4. 确认页面进入 `n/100 assets selected` 状态
5. 保持导出格式为 `SVG`
6. 触发下载
7. 等待 ZIP 落盘
8. manifest 标记为 `downloaded`

失败处理：

- 保留错误摘要
- `attempts + 1`
- 状态标记 `failed`
- 不阻断整批任务

### 4.3 `unpack-streamline-svg.mjs`

职责：

- 扫描已下载 ZIP
- 解压到标准目录
- 记录解包路径和文件数

输出：

- 更新 manifest 的 `extractPath`
- 记录每批次解包结果

### 4.4 `verify-streamline-svg.mjs`

职责：

- 对比 manifest 与解包结果
- 校验 SVG 数量、空文件、重复命名和缺失项
- 输出报告

报告建议包含：

- family 总批次数
- 成功下载批次数
- 成功解包批次数
- 实际 SVG 数量
- 缺失批次
- 缺失 SVG
- 重复命名
- 异常文件

---

## 五、目录与资产落盘策略

### 5.1 原始 ZIP 保留

建议保留原始 ZIP，不要只保留解包结果。

原因：

- 便于后续追溯导出来源
- 便于重复解包和校验
- 便于对比网页端后续更新

建议目录：

```text
vendor/streamline-svg/raw-zips/
  micro-solid/
  micro-line/
```

### 5.2 解包目录

建议按 family 隔离，并保留 topic / batch 维度：

```text
vendor/streamline-svg/extracted/
  micro-solid/
    interface-essential/
      batch-001/
      batch-002/
  micro-line/
    interface-essential/
      batch-001/
```

这样做的原因：

- line / solid 同名图标不会碰撞
- topic 内重跑时不会污染其他批次
- 后续平铺整理可以基于 manifest 做，而不是强依赖 ZIP 原结构

### 5.3 平铺资产库

如果后续需要给组件化管线提供统一输入，可以再单独生成一层平铺目录：

```text
vendor/streamline-svg/flat/
  micro-solid/
  micro-line/
```

这一层建议作为后处理产物，不建议在第一阶段直接替代解包目录。

---

## 六、执行流程建议

### 6.1 最小执行顺序

```text
采集 family/topic
-> 按 100 个一批生成 manifest
-> 逐批执行批量 SVG 下载
-> 保留原始 ZIP
-> 解包并归档
-> 对照 manifest 校验
-> 生成导出报告
```

### 6.2 第一阶段试点

不建议一开始就跑两套全量。

推荐试点顺序：

1. 先选 `micro-solid`
2. 先选一个 topic
3. 只跑第一个 `100` 图标批次
4. 验证：
   - 批量选择稳定
   - SVG 下载稳定
   - ZIP 能成功落盘
   - 解包文件结构可读
   - manifest 与实际文件数一致

试点成功后，再扩到：

1. 同 topic 全部批次
2. 整个 family
3. 再扩到 `micro-line`

---

## 七、风险与约束

### 7.1 登录态与权限风险

风险：

- 当前网页端导出行为依赖登录态和订阅权限
- 未登录或非 premium 状态下，下载动作可能受限

推荐方案：

- 启动前先做登录态检查
- 如果未登录，直接报错退出，不做隐式绕行

### 7.2 页面结构变动风险

风险：

- 多选入口依赖卡片 hover 控件
- 页面结构或选择器变动会影响自动化

推荐方案：

- 把所有页面定位逻辑集中在 `streamline-page.mjs`
- 业务流程层不散落页面结构细节

### 7.3 下载完成检测风险

风险：

- 批量导出会进入浏览器下载链路
- 如果只靠页面点击，不跟踪下载完成，容易出现“状态写成功但文件没落盘”

推荐方案：

- 下载结果必须以本地 ZIP 存在为准
- manifest 只有在 ZIP 真正落盘后才能标记 `downloaded`

### 7.4 同名文件冲突风险

风险：

- 不同 family、topic 或批次下可能存在同名 SVG

推荐方案：

- family 物理隔离
- topic / batch 先保留层级
- 平铺目录通过 manifest 做映射生成

### 7.5 执行时间与中断风险

风险：

- 数千图标规模下载时间长，容易中断

推荐方案：

- 批次化执行
- manifest 断点恢复
- 每个批次成功后立即写回状态

---

## 八、验收标准

本方案完成后，至少应满足以下条件：

1. 能按 family / topic 生成批次 manifest
2. 能基于真实页面批量选择图标
3. 能以 `SVG` 格式稳定触发下载
4. 能检测 ZIP 是否真正落盘
5. 能保留原始 ZIP 并成功解包
6. 能输出结构化 SVG 资产目录
7. 能对照 manifest 产出缺失、异常和重复报告
8. 能在批次级别断点恢复

---

## 九、待确认决策

### 决策 1：是否保留原始 ZIP

推荐方案：

- **保留**

理由：

- 有利于追溯来源
- 有利于重新解包和复查
- 有利于后续增量更新对比

### 决策 2：第一版是否生成平铺 SVG 目录

推荐方案：

- **第一版先不强制生成平铺目录**

理由：

- 先把批量导出与解包闭环跑通
- 平铺目录属于下游消费形态，适合后处理阶段

### 决策 3：第一批试点范围

推荐方案：

- **`micro-solid` 单个 topic 的第一个 `100` 图标批次**

理由：

- 页面风险和下载风险最低
- 能尽快验证下载、解包、归档、校验全链路

---

## 十、推荐下一步

当前技术路线已经明确：

- **导入主格式：SVG**
- **网页端主路径：批量下载**
- **后续 React 化：放到导出后处理阶段**

推荐下一步进入实施计划阶段，继续明确：

- 批次 manifest 的最终字段
- 下载完成检测机制
- ZIP 解包与归档规则
- 小范围试点执行顺序
- 校验命令与失败补跑策略

等你确认这个 SVG 方案方向后，再继续写实施计划文档。
