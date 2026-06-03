# 插件开发指南

## 概述

插件是 `extensions/plugin_*` 目录下的外部模块。插件通过 `PluginContext` 注册工具、命令和 Hooks，也可以通过 `ctx.control` 读取运行时管理数据。

所有公共 API 通过 `@aesyclaw/sdk` 导入，插件不应直接导入 `src/*` 内部路径。

---

## 快速开始

```ts
import { Type } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';

const plugin: PluginDefinition = {
  name: 'myplugin',
  version: '0.1.0',
  description: 'My custom plugin',
  configSchema: Type.Object({
    option: Type.String({ default: 'value' }),
  }),

  async init(ctx) {
    ctx.registry.tools.register({
      name: 'my_tool',
      description: 'Example tool',
      parameters: Type.Object({}),
      execute: async () => ({ content: ctx.config.self.get('option') ?? 'ok' }),
    });

    ctx.hooks.register({
      id: 'my-hook',
      chain: 'pipeline:send',
      priority: 100,
      handler: async (_hookCtx, next) => {
        return next !== undefined ? await next() : { action: 'next' };
      },
    });

    ctx.log.info('MyPlugin initialized');
  },

  async destroy(ctx) {
    ctx.log.info('MyPlugin destroyed');
  },
};

export default plugin;
```

---

## PluginDefinition

| 字段            | 类型                 | 必填 | 说明                                      |
| --------------- | -------------------- | ---- | ----------------------------------------- |
| `name`          | `string`             | ✅   | 插件名称，用于配置标识                    |
| `version`       | `string`             | ✅   | 语义化版本号                              |
| `description`   | `string`             | ❌   | 插件简介                                  |
| `configSchema`  | `TSchema`            | ❌   | TypeBox Schema，默认值通过 schema default |
| `permissions`   | `object`             | ❌   | 插件权限声明，目前用于 `ctx.config.global` |
| `init(ctx)`     | `async`              | ✅   | 插件初始化入口                            |
| `destroy(ctx)`  | `async`              | ❌   | 插件卸载时清理（可选）                    |
| `healthCheck()` | `async`              | ❌   | 健康检查，返回 `{ ok, error, latencyMs }` |

不再支持：

```ts
defaultConfig
middlewares
capabilities
```

配置默认值请写在 `configSchema` 的 `default` 中。Hooks 请在 `init(ctx)` 中动态注册。

---

## PluginContext

插件在 `init(ctx)` 中接收命名空间化上下文：

```ts
type PluginContext = {
  meta: PluginMetaApi;
  log: Logger;
  paths: PluginPathsApi;
  config: PluginConfigApi;
  registry: PluginRegistryApi;
  hooks: PluginHooksApi;
  models: PluginModelApi;
  control: RuntimeControlApi;
};
```

不再提供旧 alias：

```ts
ctx.name
ctx.logger
ctx.state
ctx.configManager
ctx.registerTool()
ctx.unregisterTool()
ctx.registerCommand()
ctx.resolveModel()
```

### meta

```ts
ctx.meta.name          // PluginDefinition.name
ctx.meta.owner         // plugin:{name}
ctx.meta.directoryName // 插件目录名，例如 plugin_exec
```

### paths

`ctx.paths` 只暴露插件常用路径：

```ts
ctx.paths.runtimeRoot
ctx.paths.dataDir
ctx.paths.mediaDir
ctx.paths.workspaceDir
ctx.paths.pluginDir
```

`pluginDir` 是按插件目录名隔离的数据目录。

### config

```ts
ctx.config.self.get<T>(path): T | undefined
await ctx.config.self.set(path, value)

ctx.config.global.get<T>(path): T | undefined
await ctx.config.global.set(path, value)
```

规则：

- `self` 默认允许读写插件自己的配置段。
- `global` 默认禁止读写，必须通过 `permissions.config` 声明。
- 缺失路径返回 `undefined`。
- 权限不足抛 `PluginPermissionDeniedError`。
- `set(path, undefined)` 禁止。
- 不提供 `delete()`。

示例：

```ts
const plugin: PluginDefinition = {
  name: 'webui',
  version: '0.1.0',
  permissions: {
    config: {
      read: ['plugins.*.enabled'],
      write: ['plugins.*.enabled'],
    },
  },
  async init(ctx) {
    await ctx.config.global.set('plugins.exec.enabled', false);
  },
};
```

### registry

```ts
ctx.registry.tools.register(tool)
ctx.registry.commands.register(command)
```

工具和命令不提供手动 unregister。插件卸载时框架按 owner/scope 自动清理。

### hooks

```ts
ctx.hooks.register({
  id: 'my-hook',
  chain: 'pipeline:send',
  priority: 100,
  handler,
});

ctx.hooks.unregister('my-hook');
```

规则：

- `priority` 必填。
- 不提供 `enabled` 字段。
- 插件只传短 id，框架自动加 `plugin:{name}:` 前缀。

### models

```ts
ctx.models.resolve('openai/gpt-4o')
await ctx.models.list()
```

`resolve()` 找不到模型时抛错。`list()` 返回最小字段：

```ts
{ id: string; provider: string; model: string }
```

### control

`ctx.control` 是运行时管理 API，默认对所有插件开放，不做权限声明限制。

第一批基础 API 包括：

```ts
ctx.control.plugins.list()
ctx.control.plugins.definition(name)
ctx.control.plugins.reload()
ctx.control.plugins.reload(name)

ctx.control.channels.list()
ctx.control.channels.definition(name)
ctx.control.channels.reload()
ctx.control.channels.reload(name)

ctx.control.sessions.list()
ctx.control.roles.list()
ctx.control.cron.list()
ctx.control.logs.query()
ctx.control.usage.query()
ctx.control.status.get()
ctx.control.tools.list()
ctx.control.skills.list()
```

不提供旧的通用协议接口：

```ts
ctx.control.dispatch(...)
ctx.control.on(...)
ctx.control.waitUntilReady()
```

---

## Hooks 系统

可用 Hook 链：

```text
pipeline:receive
pipeline:beforeAgent
pipeline:send
prompt:build
tool:beforeCall
tool:afterCall
agent:beforeLLM
agent:afterToolCall
```

Hook 返回值：

| action    | 行为                                               |
| --------- | -------------------------------------------------- |
| `next`    | 继续执行下一个 Hook                                |
| `respond` | 跳过后续 Hooks，直接以 `message` 为最终消息        |
| `block`   | 阻止消息投递                                      |
| `override`| 覆盖工具结果                                      |
| `error`   | 标记 Hook 错误                                    |

---

## 已有插件参考

| 插件                | 用途                        | 关键技术                  |
| ------------------- | --------------------------- | ------------------------- |
| `plugin_example`    | 演示插件系统基础能力        | 工具注册、命令注册、Hooks |
| `plugin_exec`       | 提供 Shell 命令执行工具     | 工具注册、子进程管理      |
| `plugin_md2img`     | 将 Markdown/HTML 渲染为图片 | pipeline:send Hook        |
| `plugin_multimodal` | 图片理解与语音转文本        | models.resolve、工具注册  |

详见 `extensions/` 目录下的源码。
