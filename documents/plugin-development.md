# 插件开发指南

## 概述

插件是 `extensions/plugin_*` 目录下的外部模块，通过 Hooks 机制介入 Pipeline 生命周期，可以注册工具、命令和管道钩子来扩展 Agent 行为。

所有公共 API 通过 `@aesyclaw/sdk` 导入，内部重构时只需更新 SDK 导出路径，插件代码无需修改。

---

## 快速开始

创建 `extensions/plugin_myplugin/` 目录，包含 `index.ts` 和可选的 `package.json`：

```ts
// extensions/plugin_myplugin/index.ts
import { Type } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';

const plugin: PluginDefinition = {
  name: 'myplugin',
  version: '0.1.0',
  description: 'My custom plugin',
  defaultConfig: { option: 'value' },

  async init(ctx) {
    // 初始化逻辑
    ctx.logger.info('MyPlugin initialized');
  },

  async destroy() {
    // 清理逻辑
  },

  middlewares: [
    {
      id: 'my-hook',
      chain: 'pipeline:send',
      priority: 100,
      enabled: true,
      handler: async (ctx, next) => {
        // 处理消息
        return next !== undefined ? await next() : { action: 'next' };
      },
    },
  ],
};

export default plugin;
```

---

## PluginDefinition

| 字段            | 类型                 | 必填 | 说明                         |
| --------------- | -------------------- | ---- | ---------------------------- |
| `name`          | `string`             | ✅   | 插件名称，用于配置标识       |
| `version`       | `string`             | ✅   | 语义化版本号                 |
| `description`   | `string`             | ❌   | 插件简介                     |
| `defaultConfig` | `object`             | ❌   | 默认配置，用户配置会与其合并 |
| `init(ctx)`     | `async`              | ✅   | 插件初始化入口               |
| `destroy()`     | `async`              | ❌   | 插件卸载时清理               |
| `middlewares`   | `HookRegistration[]` | ❌   | 注册的管道钩子               |

---

## PluginContext

插件在 `init(ctx)` 中接收的受限上下文：

### 配置与路径

| 属性     | 类型                      | 说明                                                      |
| -------- | ------------------------- | --------------------------------------------------------- |
| `config` | `Record<string, unknown>` | 插件自身配置（defaultConfig 与用户配置合并后）            |
| `paths`  | `ResolvedPaths`           | 路径解析器，包含 extensionsDir、mediaDir、workspaceDir 等 |

### 注册能力

| 方法                       | 说明                                           |
| -------------------------- | ---------------------------------------------- |
| `registerTool(tool)`       | 注册一个工具，作用域自动限定为 `plugin:{name}` |
| `unregisterTool(name)`     | 注销已注册的工具（只能注销自己的）             |
| `registerCommand(cmd)`     | 注册一个斜杠命令，作用域同上                   |
| `registerChannel(channel)` | 注册一个消息频道（ChannelPlugin 接口）         |

### 日志与模型

| 属性/方法                     | 说明                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `logger`                      | 带 `plugin:{name}` 作用域的 Logger                          |
| `resolveModel(providerModel)` | 根据 `provider/model` 字符串解析完整模型配置（含 API 密钥） |

`resolveModel` 从核心配置的 `providers` 段读取 API 密钥和 baseUrl，插件无需自行管理凭据。

---

## Hooks 系统

插件通过 `middlewares` 注册 Hooks，介入 Pipeline 的不同阶段：

### 可用 Hook 链

```
pipeline:receive → pipeline:beforeLLM → pipeline:send
```

| Hook 链              | 触发时机                   | 上下文 `ctx`                                        |
| -------------------- | -------------------------- | --------------------------------------------------- |
| `pipeline:receive`   | 收到用户消息后，命令检测前 | `message`, `sessionKey`, `sender`                   |
| `pipeline:beforeLLM` | LLM 调用前，会话锁定后     | `message`, `sessionKey`, `session`, `agent`, `role` |
| `pipeline:send`      | 出站消息投递前             | `message`, `sessionKey`                             |

### Hook 返回值

| action    | 行为                                               |
| --------- | -------------------------------------------------- |
| `next`    | 继续执行下一个 Hook                                |
| `respond` | 跳过后续 Hooks，直接以 `result.message` 为最终消息 |
| `block`   | 阻止消息投递（仅 `pipeline:send` 支持）            |

### middleware 格式

```ts
{
  id: 'unique-hook-id',
  chain: 'pipeline:send',
  priority: 100,   // 数值越小越先执行
  enabled: true,
  handler: async (ctx, next) => {
    // 处理 ctx.message
    return await next?.() ?? { action: 'next' };
  },
}
```

---

## 已有插件参考

| 插件                | 用途                        | 关键技术                  |
| ------------------- | --------------------------- | ------------------------- |
| `plugin_example`    | 演示插件系统全部能力        | 工具注册、命令注册、Hooks |
| `plugin_exec`       | 提供 Shell 命令执行工具     | 工具注册、子进程管理      |
| `plugin_md2img`     | 将 Markdown/HTML 渲染为图片 | pipeline:send Hook        |
| `plugin_multimodal` | 图片理解与语音转文本        | resolveModel、工具注册    |

详见 `extensions/` 目录下的源码。
