# AGENTS.md - AesyClaw 开发指南

## 概述

AesyClaw 是一个轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成（OneBot 等）。

## 项目结构

```
/                    # 根目录 - 后端 TypeScript
├── src/             # 源代码
│   ├── agent/       # Agent 循环逻辑
│   ├── api/         # REST API 服务
│   ├── bus/        # 事件总线
│   ├── channels/   # 渠道实现（OneBot 等）
│   ├── config/     # 配置加载器
│   ├── constants/  # 常量
│   ├── cron/       # 定时任务服务
│   ├── db/         # SQLite 数据库
│   ├── logger/     # 自定义日志
│   ├── mcp/        # MCP 客户端
│   ├── plugins/    # 插件管理器
│   ├── providers/  # LLM 提供商
│   ├── session/    # 会话管理
│   ├── tools/      # 工具注册表
│   └── types.ts    # TypeScript 类型定义
├── webui/          # 前端 Vue 3 应用
│   ├── src/       # Vue 源码
│   └── dist/      # 构建产物
├── plugins/        # 插件目录（用户插件）
├── dist/           # 编译后的后端 JS
└── config.yaml     # 运行时配置
```

## 构建、运行和测试命令

### 后端（主项目）

```bash
# 编译 TypeScript
npm run build

# 开发模式（热重载）
npm run dev

# 运行网关服务
npm run gateway

# 使用启动脚本运行
npm run launcher
```

### 前端（WebUI）

```bash
# 构建前端
cd webui && npm run build

# 开发模式（热重载）
cd webui && npm run dev
```

### 运行测试

目前没有正式的测试框架。手动测试方法：
1. 运行 `npm run build` 验证 TypeScript 编译
2. 运行 `npm run dev` 启动网关
3. 通过 Web UI 或 API 测试功能

## 代码风格指南

### TypeScript 配置

- 目标版本：ES2022（后端），ES2020（前端）
- 启用严格模式（`strict: true`）
- ESM 模块（`"type": "module"`）
- 导入时使用 `.js` 后缀：`import { x } from './file.js'`

### 导入语句

```typescript
// 优先使用命名导入
import { join } from 'path';
import { randomUUID } from 'crypto';

// 类型导入使用 type 关键字
import type { ToolDefinition } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';

// 类的默认导入
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';
```

### 命名规范

- 类名：PascalCase（如 `SessionManager`、`ToolRegistry`）
- 接口名：PascalCase（如 `InboundMessage`、`ToolDefinition`）
- 变量/函数：camelCase（如 `createSessionKey`、`maxSessions`）
- 常量：UPPER_SNAKE_CASE（如 `DEFAULT_TIMEOUT`）
- 私有类成员：camelCase，可选加 `_` 前缀

### 类型定义

- 公开类型和对象使用 `interface`
- 联合类型、交叉类型和原始类型使用 `type`
- 尽量避免 `any`，使用 `Record<string, unknown>` 或具体类型

```typescript
// 推荐
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: Record<string, any>, context?: ToolContext) => Promise<string>;
}

// 动态参数类型可使用 any
parameters: Record<string, any>;
```

### 类结构

```typescript
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private log = logger.child({ prefix: 'ToolRegistry' });

  constructor(storageDir: string, maxSessions: number = CONSTANTS.DEFAULT_MAX_SESSIONS) {
    // 初始化
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.log.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * 根据名称获取工具
   * @param name - 工具名称
   * @returns 工具或 undefined
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }
}
```

### 错误处理

```typescript
// 使用 try/catch 进行正确的错误传播
try {
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  // 正确检查错误类型
  if (error instanceof Error && error.name === 'AbortError') {
    throw new Error(`操作已中止: ${operationName}`);
  }
  // 重新抛出并附带上下文
  throw error;
}

// 事件处理器中的未知错误
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`处理失败: ${message}`);
}
```

### 日志记录

- 使用 `src/logger/index.ts` 中的自定义 `Logger` 类
- 为类创建子日志记录器：`private log = logger.child({ prefix: '类名' })`
- 日志级别：`debug`、`info`、`warn`、`error`

```typescript
import { logger } from '../logger/index.js';

const log = logger.child({ prefix: 'MyClass' });
log.debug('详细信息');
log.info('重要操作');
log.warn('潜在问题');
log.error('发生错误:', error);
```

### JSDoc 注释

为公开方法添加 JSDoc 文档：

```typescript
/**
 * 获取现有会话或创建新会话
 * @param key - 会话键（格式：channel:chatId 或 channel:chatId:uuid）
 * @returns 现有或新创建的会话
 * @throws 如果键格式无效则抛出错误
 */
async getOrCreate(key: string): Promise<Session> {
  // 实现
}
```

### 代码格式

- 2 空格缩进
- 对象/数组使用尾随逗号
- 字符串使用单引号
- 语句末尾不加分号
- 类成员之间空一行

### Vue/前端约定

WebUI 使用 Vue 3 + PrimeVue + TailwindCSS：

- 使用 `<script setup lang="ts">` 编写 Vue 组件
- 启用 TypeScript 严格模式
- 遵循 Vue 3 Composition API 规范

## 插件开发

详见 `PLUGIN_DEV.md` 插件开发指南。重点：

- 插件放在 `plugins/<插件名>/main.js`
- 导出默认插件对象，包含 `name`、`version`、`description`、hooks、tools 等
- 使用 `aesyclaw` 的 `Plugin` 类型
- 在 `config.yaml` 的 `plugins:` 下配置

## 配置

- 主配置：`config.yaml`
- SQLite 数据库：`.aesyclaw/sessions/sessions.db`
- 定时任务：`.aesyclaw/cron-jobs.json`

## API 端点

- 网关 API：端口 18792（默认）
- WebUI：端口 5173（开发）或由后端提供

## 常见开发任务

### 添加新渠道

1. 在 `src/channels/` 中继承 `BaseChannel`
2. 实现 `send()`、`start()`、`stop()` 方法
3. 在 `ChannelManager` 中注册
4. 在 `types.ts` 中添加配置 schema

### 添加新工具

1. 在 `cli.ts` 或通过插件注册
2. 使用 JSON Schema 定义参数
3. 实现验证和异步执行
4. 返回 JSON 字符串结果

### 添加新提供商

1. 在 `src/providers/` 中创建类
2. 实现 `createCompletion()`、`createChat()`
3. 在 `src/providers/index.ts` 中注册
4. 在 `types.ts` 和 `config.yaml` 中添加配置
