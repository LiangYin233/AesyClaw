# AesyClaw 上下文管理设计说明

## 目标

AesyClaw 的上下文管理目标是：在尽量保留有效历史的同时，避免单次 LLM 调用超过模型上下文窗口。

当前策略分为四层：

1. **输入预算守卫**：用户输入本身放不进模型上下文窗口时，直接拒绝处理。
2. **自动历史压缩**：上下文接近软阈值时，自动把历史压缩为摘要。
3. **手动历史压缩**：用户通过 `/compact` 主动释放历史占用。
4. **工具结果截断**：工具返回内容过大时，进入模型前截断。

---

## Token 估算原则

上下文判断使用估算 token，不用于计费。

估算规则：

- 如果消息带有 `usage.totalTokens`，优先使用真实 token。
- 如果没有 usage，则按文本长度估算。
- 当前输入内容没有 usage，始终按文本长度估算。
- 平均换算规则为：约 `3.5` 个字符视为 `1` 个 token。

相关实现：

- `src/session/utils/token-utils.ts`

---

## 输入预算守卫

输入预算守卫位于：

```text
pipeline:beforeAgent
```

Hook：

```text
core:user-input-budget-guard
```

它在 `pipeline:beforeAgent` 阶段最后运行，因此会在 `time-inject` 等同链 Hook 完成后，再判断最终进入 Agent 前的消息内容。

判断逻辑：

```text
historyTokens = 当前会话历史估算 token（仅用于日志和诊断）
currentTokens = 当前消息内容估算 token
limitTokens = model.contextWindow

如果 currentTokens >= limitTokens：
  拒绝本次处理
否则：
  继续进入 Agent
```

守卫不再因为历史占用过高而拒绝普通输入。历史太长时，后续 `agent:beforeLLM` 阶段的自动压缩会先尝试把历史压缩为摘要。

被拒绝时：

- 不进入 Agent。
- 不调用 LLM。
- 写入 warn 日志。
- 回复用户：

```text
输入内容本身超过当前模型上下文限制，已停止本次处理。请减少输入长度后再试。
```

这个设计确保只有“当前输入本身过长”会被提前拒绝；“历史过长”交给自动压缩或用户手动 `/compact` 处理。

---

## 自动历史压缩

自动压缩位于：

```text
agent:beforeLLM
```

Hook：

```text
core:auto-compact
```

它在真正调用 LLM 前运行。

判断逻辑：

```text
estimatedTokens = historyTokens + currentTokens
limit = model.contextWindow * compressionThreshold

如果 estimatedTokens >= limit：
  压缩历史
```

压缩后：

- 会话历史被替换为摘要。
- 内存中的 session 会重新绑定最新历史。
- 本轮临时 history 会被拼回去，避免丢失当前工具调用或中间消息。

自动压缩负责处理“历史太长”的情况；它不负责拒绝用户输入。

---

## 手动历史压缩

用户可以通过命令手动压缩当前会话：

```text
/compact
```

链路：

```text
pipeline:receive
  -> command-detect
  -> /compact
  -> session.compact()
  -> compactSession()
  -> LLM 生成摘要
  -> replaceWithSummary()
  -> session.bind()
```

手动压缩会减少历史占用，使后续请求拥有更多可用上下文。

保护规则：

- `/compact` 不允许在 Agent 正在处理时执行。
- 如果会话 locked，命令检测阶段会直接提示稍后再试。

---

## 工具结果截断

工具结果截断位于：

```text
agent:afterToolCall
```

Hook：

```text
core:tool-result-truncation
```

作用：

- 工具结果返回给模型前，根据剩余预算进行截断。
- 截断保留头部和尾部。
- 截断内容会附带可见说明。
- 截断信息写入 tool result details。

这层只处理工具结果，不处理用户输入。

---

## 当前整体流程

```text
用户消息进入 Pipeline
  |
  v
pipeline:receive
  |
  |-- command-detect
  |     |-- 如果是 /compact：执行手动压缩
  |
  v
解析会话、角色、模型，创建 Agent
  |
  v
pipeline:beforeAgent
  |
  |-- time-inject
  |     |-- 注入当前时间
  |
  |-- user-input-budget-guard
  |     |-- 最后检查当前消息本身是否超过模型上下文窗口
  |     |-- 如果超过：回复并停止
  |
  v
Agent.callLLM()
  |
  v
agent:beforeLLM
  |
  |-- auto-compact
  |     |-- 如果历史 + 当前输入超过软阈值：压缩历史
  |
  v
prompt:build
  |
  v
调用 LLM
  |
  v
agent:afterToolCall
  |
  |-- tool-result-truncation
  |     |-- 工具结果过大时截断
  |
  v
pipeline:send
  |
  v
发送给用户
```
