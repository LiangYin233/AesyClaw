# 插件开发指南

本文面向 `extensions/plugin_*` 插件开发者，描述 AesyClaw 当前插件 API、生命周期、配置权限和运行时管理能力。

插件是运行在 AesyClaw 进程内的本地扩展模块。插件可以注册工具、斜杠命令和 Hooks，也可以通过运行时控制 API 读取或管理会话、角色、定时任务、插件、频道等运行时资源。

> 约定：插件代码应只从 `@aesyclaw/sdk` 导入公共 API，不要直接导入 `src/*` 内部路径。

---

## 目录与入口

插件目录必须放在：

```text
extensions/plugin_<directoryName>/
```

插件模块需要默认导出或命名导出一个 `PluginDefinition`：

```ts
export default plugin;
// 或
export const plugin = { ... } satisfies PluginDefinition;
```

插件名由 `PluginDefinition.name` 决定，配置段位于：

```text
plugins.<pluginName>
```

例如 `extensions/plugin_example` 的插件名为 `example`，配置段为：

```jsonc
{
  "plugins": {
    "example": {
      "enabled": true,
    },
  },
}
```

---

## 快速开始

```ts
import { Type } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';
import { isRecord } from '@aesyclaw/sdk';

const plugin: PluginDefinition = {
  name: 'myplugin',
  version: '0.1.0',
  description: 'My custom plugin',

  configSchema: Type.Object({
    greeting: Type.String({ default: 'Hello' }),
  }),

  async init(ctx) {
    ctx.registry.tools.register({
      name: 'myplugin_greet',
      description: 'Return a greeting from myplugin.',
      parameters: Type.Object({
        name: Type.Optional(Type.String()),
      }),
      execute: async (params) => {
        const name = isRecord(params) && typeof params.name === 'string' ? params.name : 'there';
        const greeting = ctx.config.self.get<string>('greeting') ?? 'Hello';
        return { content: `${greeting}, ${name}!` };
      },
    });

    ctx.registry.commands.register({
      name: 'myplugin',
      description: 'Run myplugin command.',
      usage: '/myplugin',
      execute: async () => ({
        components: [{ type: 'Plain', text: 'myplugin is active.' }],
      }),
    });

    ctx.hooks.register({
      id: 'send-footer',
      chain: 'pipeline:send',
      priority: 100,
      handler: async (hookCtx, next) => {
        const result = next ? await next() : { action: 'next' as const };
        if (result.action !== 'next') return result;
        return {
          action: 'respond',
          message: {
            components: [
              ...hookCtx.message.components,
              { type: 'Plain', text: '\n\n-- sent by myplugin' },
            ],
          },
        };
      },
    });

    ctx.log.info('myplugin initialized');
  },

  async destroy(ctx) {
    ctx.log.info('myplugin destroyed');
  },
};

export default plugin;
```

---

## PluginDefinition

```ts
type PluginDefinition = {
  name: string;
  version: string;
  description?: string;
  configSchema?: TSchema;
  permissions?: PluginPermissions;
  init(ctx: PluginContext): Promise<void>;
  destroy?(ctx: PluginContext): Promise<void>;
  healthCheck?(): Promise<PluginHealthStatus>;
};
```

| 字段            | 必填 | 说明                                                          |
| --------------- | ---- | ------------------------------------------------------------- |
| `name`          | 是   | 插件名，用于配置键、owner、Hook 前缀等。                      |
| `version`       | 是   | 插件版本。建议使用语义化版本。                                |
| `description`   | 否   | 插件说明，会展示在 WebUI/运行时状态中。                       |
| `configSchema`  | 否   | TypeBox Schema。框架会用它校验插件配置并填充 schema default。 |
| `permissions`   | 否   | 插件权限声明，目前用于 `ctx.config.global` 的全局配置读写。   |
| `init(ctx)`     | 是   | 插件启动入口。注册工具、命令、Hooks、启动服务等。             |
| `destroy(ctx)`  | 否   | 插件停止时调用。用于关闭 server、timer、连接等自持资源。      |
| `healthCheck()` | 否   | 健康检查，返回 `{ ok, error?, latencyMs? }`。                 |

配置默认值请写入 `configSchema` 的 `default`；Hooks 请在 `init(ctx)` 中通过 `ctx.hooks.register()` 注册。

---

## 生命周期

插件启动流程：

1. 扫描 `extensions/plugin_*` 目录。
2. 动态导入插件模块并发现 `PluginDefinition`。
3. 合并配置：框架默认字段 + 用户配置。
4. 检查 `enabled`。插件默认启用，配置中可设 `enabled: false` 禁用。
5. 使用 `configSchema` 校验配置并填充默认值。
6. 创建 `PluginContext`。
7. 调用 `plugin.init(ctx)`。
8. 记录运行时实例，并将填充后的默认配置写回配置文件。

插件停止流程：

1. 注销插件注册的 Hooks。
2. 调用 `plugin.destroy(ctx)`。
3. 框架按 owner 自动清理工具和命令。
4. 删除插件运行时配置引用和加载状态。

配置变更流程：

```text
ConfigManager.set / patch / update / syncDefaults
或外部编辑 config.json
  -> ConfigManager.onConfigChanged
  -> pluginManager.handleConfigReload()
  -> channelManager.handleConfigReload()
  -> mcpManager.handleConfigReload()
```

插件配置变更后，插件管理器会根据最新配置自动决定启动、停止或重启插件。插件通常不需要手动调用 `ctx.control.plugins.reload()`。

---

## PluginContext

插件在 `init(ctx)` / `destroy(ctx)` 中接收命名空间化上下文：

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

旧版顶层 alias 已移除。请始终使用 `ctx.log`、`ctx.config`、`ctx.registry`、`ctx.hooks`、`ctx.models`、`ctx.control` 等命名空间。

### meta

```ts
ctx.meta.name; // PluginDefinition.name
ctx.meta.owner; // plugin:{name}
ctx.meta.directoryName; // 插件目录名，例如 plugin_exec
```

### log

```ts
ctx.log.debug('message');
ctx.log.info('message');
ctx.log.warn('message');
ctx.log.error('message', error);
```

日志作用域为插件 owner，例如：

```text
plugin:myplugin
```

### paths

```ts
ctx.paths.runtimeRoot; // .aesyclaw/
ctx.paths.dataDir; // .aesyclaw/data/
ctx.paths.mediaDir; // .aesyclaw/media/
ctx.paths.workspaceDir; // .aesyclaw/workspace/
ctx.paths.pluginDir; // .aesyclaw/data/extensions/<plugin_directory>/
```

`pluginDir` 是插件专属数据目录。插件需要持久化自身文件时，优先写入该目录。

---

## 配置 API

插件配置 API 分为两类：

```ts
ctx.config.self;
ctx.config.global;
```

### self：插件自身配置

`self` 读写 `plugins.<pluginName>`，不需要额外权限。

```ts
ctx.config.self.get<T>(path): T | undefined;
await ctx.config.self.set(path, value);
```

示例：

```ts
const greeting = ctx.config.self.get<string>('greeting') ?? 'Hello';
await ctx.config.self.set('greeting', 'Hi');
```

读取根配置：

```ts
const config = ctx.config.self.get<Record<string, unknown>>('');
```

规则：

- `enabled` 是框架管理字段，`ctx.config.self.get()` 返回值会剥离 `enabled`。
- `set(path, undefined)` 禁止。
- 如果提供了 `configSchema`，写入后会重新校验并填充默认值。
- 不提供 `delete()`；如需删除字段，写入新的对象值。

### global：全局配置

`global` 用于读写顶层应用配置，必须声明权限：

```ts
ctx.config.global.get<T>(path): T | undefined;
await ctx.config.global.set(path, value);
await ctx.config.global.update(update);
```

`get/set` 使用点路径：

```ts
ctx.config.global.get('agent.defaultModel');
await ctx.config.global.set('plugins.exec.enabled', false);
```

`update()` 使用顶层配置 patch，并走 `ConfigManager.update()` 的原子校验/持久化：

```ts
await ctx.config.global.update({
  agent: { logLevel: 'debug' },
  plugins: { exec: { enabled: false } },
});
```

`update()` 当前支持的顶层段与 `ConfigManager.update()` 一致：

```text
agent      // 对象 patch 合并
providers  // 整段替换
channels   // 整段替换
mcp        // 整段替换
plugins    // 整段替换
```

> 建议：需要一次保存多段配置时优先使用 `ctx.config.global.update()`，避免多次 `set()` 造成半更新状态。

### 配置权限

全局配置默认禁止读写，需要在 `permissions.config` 中声明：

```ts
const plugin: PluginDefinition = {
  name: 'myadmin',
  version: '0.1.0',
  permissions: {
    config: {
      read: ['agent', 'plugins.*.enabled'],
      write: ['agent', 'plugins.*.enabled'],
    },
  },
  async init(ctx) {
    const agent = ctx.config.global.get('agent');
    await ctx.config.global.set('plugins.exec.enabled', false);
  },
};
```

权限规则：

- 精确路径：`agent`、`plugins.webui.enabled`
- 单段通配：`plugins.*.enabled`
- `*` 出现在规则末尾时匹配后续任意子路径，例如 `plugins.*` 可匹配 `plugins.exec.enabled`
- 权限不足时抛出 `PluginPermissionDeniedError`

---

## 工具注册

```ts
ctx.registry.tools.register({
  name: 'tool_name',
  description: 'Tool description.',
  parameters: Type.Object({
    input: Type.String(),
  }),
  execute: async (params, toolCtx) => {
    return { content: 'result' };
  },
});
```

工具返回：

```ts
type ToolExecutionResult = {
  content: string;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
};
```

规则：

- 工具名全局唯一。
- 插件注册工具时，框架会自动设置 owner 为 `plugin:<name>`。
- 插件卸载时，框架自动注销该 owner 下的工具。
- 工具参数来自 LLM，类型是 `unknown`；插件应自行做运行时校验或类型守卫。

---

## 命令注册

```ts
ctx.registry.commands.register({
  name: 'mycmd',
  description: 'Run my command.',
  usage: '/mycmd [args]',
  execute: async (args, commandCtx) => ({
    components: [{ type: 'Plain', text: `args: ${args.join(', ')}` }],
  }),
});
```

规则：

- 插件注册命令时，框架会自动设置 scope 为 `plugin:<name>`。
- 插件卸载时，框架自动注销该 scope 下的命令。
- 命令返回 `Message`。

---

## Hooks

注册 Hook：

```ts
ctx.hooks.register({
  id: 'my-hook',
  chain: 'pipeline:send',
  priority: 100,
  handler: async (hookCtx, next) => {
    return next ? await next() : { action: 'next' };
  },
});
```

注销 Hook：

```ts
ctx.hooks.unregister('my-hook');
```

规则：

- 插件只传短 id，框架会自动加前缀：`plugin:<name>:<id>`。
- `priority` 必填，数值越小越早执行。
- 插件侧不提供 `enabled` 字段，注册后默认启用。
- 插件停止时，框架自动注销 `plugin:<name>:` 前缀下的 Hooks。

常用 Hook 链：

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

| action     | 说明                                    |
| ---------- | --------------------------------------- |
| `next`     | 继续执行后续 Hook。                     |
| `respond`  | 使用 `message` 作为响应，短路后续流程。 |
| `block`    | 阻止消息投递。                          |
| `override` | 覆盖工具结果。                          |
| `error`    | 标记 Hook 错误。                        |

---

## 模型 API

```ts
const model = ctx.models.resolve('openai/gpt-4o');
const models = await ctx.models.list();
```

说明：

- `resolve(providerModel)` 使用当前配置解析完整模型信息，找不到 provider/model 或缺少 API key 时会抛错。
- `list()` 返回当前配置中声明的模型：

```ts
Array<{ id: string; provider: string; model: string }>;
```

---

## RuntimeControlApi

`ctx.control` 是运行时管理 API。AesyClaw 将插件视为本地受信任扩展，因此该 API 默认对插件开放，不通过 `permissions.config` 限制。

### 插件与频道

```ts
await ctx.control.plugins.list();
await ctx.control.plugins.definition(name);
await ctx.control.plugins.reload();
await ctx.control.plugins.reload(name);

await ctx.control.channels.list();
await ctx.control.channels.definition(name);
await ctx.control.channels.reload();
await ctx.control.channels.reload(name);
```

通常情况下，启用/禁用插件或频道应通过配置变更完成：

```ts
await ctx.config.global.set('plugins.exec.enabled', false);
await ctx.config.global.set('channels.desktop.enabled', true);
```

配置系统会触发热重载，插件/频道管理器会自动 stop/start/restart。`reload()` 更适合“重新加载当前已启用扩展”的管理操作。

### 会话

```ts
await ctx.control.sessions.list();
await ctx.control.sessions.getMessages(sessionId);
await ctx.control.sessions.clear(sessionId);
await ctx.control.sessions.delete(sessionId);
await ctx.control.sessions.setModel(sessionId, modelId);
await ctx.control.sessions.setRole(sessionId, roleId);
```

### 角色

```ts
await ctx.control.roles.list();
await ctx.control.roles.get(id);
await ctx.control.roles.create(role);
await ctx.control.roles.update(id, patch);
await ctx.control.roles.delete(id);
```

### 定时任务

```ts
await ctx.control.cron.list();
await ctx.control.cron.get(id);
await ctx.control.cron.getRuns(jobId);
await ctx.control.cron.create(job);
await ctx.control.cron.update(id, patch);
await ctx.control.cron.delete(id);
await ctx.control.cron.runNow(id);
await ctx.control.cron.setEnabled(id, enabled);
```

### 日志、用量、状态

```ts
await ctx.control.logs.query({ limit: 200 });
await ctx.control.usage.query({ model, from, to });
await ctx.control.usage.today();
await ctx.control.usage.tools({ from, to });
await ctx.control.status.get();
```

### 工具与技能

```ts
await ctx.control.tools.list();
await ctx.control.skills.list();
await ctx.control.skills.reload();
await ctx.control.skills.getContent(name);
```

---

## WebUI 插件配置示例

内置 WebUI 由 `plugin_webui` 提供，配置位于 `plugins.webui`：

```jsonc
{
  "plugins": {
    "webui": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 3000,
      "enabledServer": true,
      "authToken": "...",
    },
  },
}
```

WebUI 需要读写多段全局配置，因此声明了配置权限：

```ts
permissions: {
  config: {
    read: ['providers', 'channels', 'agent', 'mcp', 'plugins'],
    write: [
      'providers',
      'channels',
      'channels.*.enabled',
      'agent',
      'mcp',
      'plugins',
      'plugins.*.enabled',
    ],
  },
}
```

核心配置不再包含旧的 `server.*` 段；全局日志级别位于 `agent.logLevel`。

---

## 最佳实践

- 只从 `@aesyclaw/sdk` 导入公共 API。
- 为工具和命令使用带插件名前缀的名称，避免冲突，例如 `myplugin_search`。
- 在 `configSchema` 中声明默认值，不要使用旧的 `defaultConfig`。
- 多段配置保存优先使用 `ctx.config.global.update()`。
- 需要修改自身配置时优先使用 `ctx.config.self`。
- 插件自己创建的 server、timer、WebSocket、文件句柄等必须在 `destroy(ctx)` 中释放。
- 工具参数是 `unknown`，务必做运行时校验。
- 不要记录 API key、auth token 等敏感信息。需要提示时只记录脱敏片段。
- 插件卸载时工具、命令、Hooks 会由框架自动清理；自持资源仍需插件自己关闭。

---

## 已有插件参考

| 插件                | 用途                 | 关键能力                            |
| ------------------- | -------------------- | ----------------------------------- |
| `plugin_example`    | 插件 API 示例        | 工具、命令、Hooks、自身配置         |
| `plugin_exec`       | Shell 命令执行工具   | 工具注册、子进程、workspace         |
| `plugin_md2img`     | Markdown/HTML 转图片 | `pipeline:send` Hook、静态资源      |
| `plugin_multimodal` | 图片理解、语音转文本 | 模型解析、媒体处理工具              |
| `plugin_webui`      | Web 管理后台         | RuntimeControl、全局配置、WebSocket |

源码位于 `extensions/plugin_*`。
