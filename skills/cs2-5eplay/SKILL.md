---
name: cs2-5eplay
description: 当用户请求了解 CS2（Counter-Strike 2）的对局、赛事、选手、战队等相关信息时，必须使用此 skill。使用 Playwright MCP 工具访问 5eplay（5E对战平台）官方赛事页面，获取最新的 CS2 比赛数据、赛事信息、战队排名和职业选手资料。触发关键词包括但不限于：CS2对局、CS2比赛、CS2赛事、CS2战队、CS2选手、职业选手信息、CS2排名、CS2近期比赛、5E对战、CSGO赛事等。只要用户提到 CS2 或 CSGO 的竞技信息，就应使用此 skill。
compatibility: 需要 Playwright MCP 工具可用（用于网页操作）
---

# CS2 信息查询 Skill（via 5eplay）

## 概述

本 skill 指导 Claude 使用 Playwright MCP 访问 5eplay 平台，获取 CS2 对局、赛事、战队、选手等信息。

---

## 数据来源 URL

| 信息类型 | URL |
|---------|-----|
| 对局（比赛结果/赛程） | https://event.5eplay.com/csgo/matches |
| 赛事（比赛列表） | https://event.5eplay.com/csgo/events |
| 战队 | https://event.5eplay.com/csgo/teams |
| 选手 | https://event.5eplay.com/csgo/player |

---

## 操作流程

### 第一步：确定查询类型

根据用户的问题，判断需要访问哪个页面：

- 用户问"最近的比赛/对局结果" → 访问 **matches** 页面
- 用户问"最近有什么赛事/锦标赛" → 访问 **events** 页面
- 用户问"某支战队的信息/排名" → 访问 **teams** 页面
- 用户问"某位选手的信息" → 访问 **player** 页面
- 用户问题较宽泛时 → 根据上下文选择最相关的页面，或同时访问多个页面

### 第二步：使用 Playwright MCP 访问页面

```
使用 Playwright MCP 的 browser_navigate 工具访问对应 URL
```

**注意事项：**
- 页面可能需要等待加载，使用 `browser_wait_for_load_state` 等待页面完成
- 如果页面内容为空，等待 2-3 秒后重试
- 若遇到登录弹窗，尝试关闭或跳过

### 第三步：获取页面内容

**只使用以下文本类工具读取页面内容，禁止使用截图：**

1. **`browser_snapshot`** — 获取页面完整 accessibility tree（推荐首选），包含所有可见文本、链接、按钮等结构化信息，直接由 Claude 解析
2. **`browser_get_visible_text`** — 获取页面纯文本，适合内容密集的列表页
3. **`browser_click`** — 点击条目/链接进入详情页，之后再次调用 `browser_snapshot` 读取
4. **`browser_evaluate`** — 执行 JS 提取特定 DOM 数据（snapshot 不足时备用）

> ⚠️ 严禁调用 `browser_take_screenshot` 或任何截图工具，所有信息通过 MCP 返回的文本结构直接读取。

### 第四步：深入查询（如需要）

若用户需要更详细的信息：

- **赛事详情**：在 events 页面点击具体赛事，查看参赛队伍、赛程、结果等
- **对局详情**：在 matches 页面点击具体对局，查看地图、局分、MVP等
- **战队详情**：在 teams 页面点击具体战队，查看阵容、近期战绩等
- **选手详情**：在 player 页面点击具体选手，查看数据统计、历史战队等

### 第五步：整理并呈现信息

将获取到的信息以清晰的格式呈现给用户：

- 使用表格展示比赛结果、战队列表等列表类信息
- 使用结构化文本展示详细信息
- 注明信息来源和数据时效性

---

## 常见场景示例

### 场景 1：查询近期对局
```
1. browser_navigate → https://event.5eplay.com/csgo/matches
2. browser_snapshot 读取页面结构，直接解析比赛列表数据
3. 整理并展示近期对局信息（队伍、比分、赛事名称等）
```

### 场景 2：查询赛事信息
```
1. browser_navigate → https://event.5eplay.com/csgo/events
2. browser_snapshot 获取赛事列表
3. 如用户感兴趣某赛事，browser_click 进入详情页
4. 展示赛事时间、参赛队伍、奖金等信息
```

### 场景 3：查询战队信息
```
1. browser_navigate → https://event.5eplay.com/csgo/teams
2. browser_snapshot 获取战队列表/排名
3. 如需查询特定战队，找到并点击该战队
4. 展示阵容、近期成绩、排名等
```

### 场景 4：查询选手信息
```
1. browser_navigate → https://event.5eplay.com/csgo/player
2. browser_snapshot 获取选手列表
3. 找到目标选手，browser_click 进入选手详情
4. 展示选手数据、历史战队、近期表现等
```

---

## 错误处理

| 问题 | 解决方案 |
|------|---------|
| 页面加载失败 | 等待后重试，最多 3 次 |
| 内容为空 | 等待后调用 `browser_snapshot` 重试，或用 `browser_evaluate` 检查 DOM |
| 找不到目标信息 | 尝试页面搜索功能或滚动加载更多内容 |
| 需要登录才能查看 | 告知用户该内容需要登录，并展示已获取的公开信息 |

---

## 重要提示

- 始终以中文回复用户（除非用户使用其他语言）
- 告知用户数据来源为 5eplay 平台
- 如果数据较多，优先展示最相关、最新的信息
- 可主动询问用户是否需要进一步了解某个具体赛事/队伍/选手的详情
