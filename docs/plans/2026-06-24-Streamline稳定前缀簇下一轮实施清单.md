# 方案概述

## 总体目标和范围

本清单面向 `micro-solid` 剩余 `pending` 中最稳定的一批前缀簇，目标是在不回到网页/MCP 主路径的前提下，为下一轮规则工程提供可直接执行的分组、标签骨架和过滤规则。范围仅覆盖本轮已确认更适合继续自动提升的前缀簇：`layout`、`mail`、`phone`、`watch`、`navigation`、`search`、`menu`。

## 各阶段任务概要

1. 统计与分组  
   主要工作：确认各稳定前缀簇数量与代表样本。  
   预期成果：形成下一轮批次边界。  
   执行顺序：先做。

2. 规则骨架定义  
   主要工作：为每个前缀簇定义推荐标签骨架与应剔除的风险词。  
   预期成果：形成可直接编码的规则工程输入。  
   执行顺序：第二步。

3. 批次推进顺序  
   主要工作：按稳定性和风险划分执行批次。  
   预期成果：形成下一轮最小可执行批次。  
   执行顺序：最后确定。

## 整体结构框架

1. 稳定前缀簇清单
2. 每簇标签骨架
3. 每簇风险词与过滤规则
4. 下一轮推荐执行顺序

---

# 稳定前缀簇清单

当前建议优先推进的稳定前缀簇共约 `85` 条：

| 前缀 | 数量 | 代表样本 |
| --- | ---: | --- |
| `layout` | 27 | `layout-1`、`layout-10`、`layout-4` |
| `mail` | 15 | `mail-add`、`mail-block`、`mail-mark-as-read` |
| `phone` | 14 | `phone-book`、`phone-ringing-1`、`phone-open-in-mobile` |
| `watch` | 9 | `watch-circle-charging`、`watch-circle-download`、`watch-square-time` |
| `navigation` | 8 | `navigation-arrow-1`、`navigation-arrow-fork-left`、`navigation-arrow-west` |
| `search` | 6 | `search-check`、`search-circle`、`search-text` |
| `menu` | 6 | `menu-alternate-1`、`menu-alternate-vertical`、`menu-line-2` |

---

# 标签骨架与过滤规则

## `layout-*`

推荐标签骨架：
`layout`、`dashboard`、`widgets`、`arrangement`、`customization`、`frame`、`grid`、`design`

规则建议：
- 将 `layout-*` 视为纯布局类家族，优先保留结构与界面词。
- 若后续样本混入方向类词，只保留在确有箭头/角落语义的子家族中，例如 `layout-border-*`。

建议过滤词：
`arrow`、`travel`、`flight`、`favorite`

## `mail-*`

推荐标签骨架：
`message`、`communication`、`email`、`envelope`、`mail`、`inbox`

按子动作追加：
- `mail-add` 保留 `add`
- `mail-check` 保留 `check`
- `mail-lock` 保留 `lock`、`secure`
- `mail-mark-as-read` 保留 `read`

规则建议：
- `mail-*` 应优先围绕邮件通信语义，不继承泛化操作词作为主体。
- `all`、`send` 这类词只在确有发送/全回复语义时保留，不能作为整个 `mail-*` 家族默认词。

建议过滤词：
`all`、`affection`、`bookmark`、`bubble`

## `phone-*`

推荐标签骨架：
`phone`、`call`、`contact`、`telephone`、`communication`

按子动作追加：
- `phone-off` 保留 `disable`、`off`
- `phone-ringing-*` 保留 `ringing`
- `phone-book` 保留 `book`、`directory`
- `phone-open-in-mobile` 保留 `mobile`

规则建议：
- 去掉设备平台泛化词，避免把 `android`、`assistance`、`device` 默认灌进所有 `phone-*`。
- 保持通信主体优先，子动作词次之。

建议过滤词：
`android`、`assistance`、`device`

## `watch-*`

推荐标签骨架：
- `watch-circle/square-charging`：`watch`、`charging`、`energy`、`power`、`battery`
- `watch-circle/square-download`：`watch`、`download`、`data`、`storage`
- `watch-circle/square-upload`：`watch`、`upload`、`data`、`storage`
- `watch-square-time`：`watch`、`clock`、`time`

规则建议：
- `watch-*` 适合拆子簇，不建议整个前缀共用一套 tags。
- `watch-square-time` 已出现 `flight`、`travel`、`abstract` 这类漂移词，必须单独加时间语义门禁。
- `watch-*` 内只保留与智能手表动作直接相关的功能词。

建议过滤词：
`flight`、`travel`、`abstract`、`design`、`bubble`、`chat`

## `navigation-*`

推荐标签骨架：
`arrow`、`direction`、`navigation`

按子语义追加：
- `fork-left/right` 保留 `fork`
- `east/west/south` 保留方位词
- `off` 保留 `disable`、`off`

规则建议：
- `dashed`、`click`、`cursor` 不应作为整个前缀的默认标签，除非图标本身确实表达虚线或点击。
- 优先压缩成“方向 + 导航 + 分叉/方位/禁用”三层结构。

建议过滤词：
`dashed`、`click`、`cursor`、`backward`、`point`

## `search-*`

推荐标签骨架：
`search`、`find`、`lookup`

按子语义追加：
- `search-check` 保留 `check`、`confirm`
- `search-off-disable` 保留 `disable`、`off`
- `search-text` 保留 `text`
- `search-dollar` 保留 `money` 或 `finance` 仅在后续规则确认后再加

规则建议：
- `app`、`apps`、`browser`、`programming`、`research` 都是过泛辅助词，不应默认进入。
- 保持“搜索主体词 + 修饰语义词”的简骨架。

建议过滤词：
`app`、`apps`、`browser`、`programming`、`research`、`explore`

## `menu-*`

推荐标签骨架：
`menu`、`navigation`、`options`、`interface`

按子语义追加：
- `horizontal` / `vertical` 保留方向词
- `line-*` 保留 `line`
- `alternate-*` 保留 `alternate`

规则建议：
- `button`、`circle`、`dots` 不是所有 `menu-*` 都需要。
- 先保留菜单/导航主体，形态词按子家族补充。

建议过滤词：
`button`、`app`、`dots`

---

# 下一轮推荐执行顺序

## 批次 1：低风险主批次

建议先做：
- `layout` 27
- `mail` 15
- `phone` 14

原因：
- 数量高
- 候选高度重复
- 风险词模式清晰
- 最容易用显式规则快速收敛

## 批次 2：中风险结构批次

建议第二批做：
- `navigation` 8
- `search` 6
- `menu` 6

原因：
- 总量不大
- 结构清晰
- 但更容易混入界面辅助词和方向词，需要加一层轻门禁

## 批次 3：需拆子簇的受控批次

建议最后做：
- `watch` 9

原因：
- 数量不大
- 但内部其实是 `charging / download / upload / time / disable` 多个子语义
- 需要先拆子簇，再回写

---

# 实施建议

1. 下一轮不要直接基于前缀整簇放行，而是先给每个前缀簇定义“主体骨架 + 子动作词 + 黑名单”三段式规则。
2. 优先把 `layout`、`mail`、`phone` 做成单独规则模块，因为收益最大。
3. `watch` 应单独拆成子簇规则，不能与其他稳定簇共用一层放行逻辑。
4. 若新一轮 promotion 仍出现跨语义词，优先继续缩词表，不要放宽门禁。
