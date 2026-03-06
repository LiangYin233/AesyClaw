# API 代码审查报告

## 概述

对 `src/api/server.ts` 进行全面审查,识别过时设计、潜在问题和改进建议。

## 发现的问题

### 🔴 严重问题

#### 1. MCP 路由重复定义 (行 252-270 和 504-704)

**位置**:
- 旧路由: 252-270 行
- 新路由: 504-704 行

**问题**:
```typescript
// 旧的 MCP 路由 (行 252-270)
if (this.mcpManager) {
  this.app.get('/api/mcp', ...);        // ← 旧端点
  this.app.get('/api/mcp/tools', ...);  // ← 旧端点
}

// 新的 MCP 路由 (行 504-704)
this.app.get('/api/mcp/servers', ...);  // ← 新端点
this.app.post('/api/mcp/servers/:name', ...);
// ... 更多新端点
```

**影响**:
- 旧端点功能有限,只能查询工具
- 新端点功能完整,支持动态管理
- 两套端点共存造成混淆

**建议**: 删除旧的 MCP 路由 (252-270 行),统一使用新的管理端点

---

#### 2. 缺少错误处理的异步操作

**位置**: 多处

**问题示例**:
```typescript
// 行 91-101: 没有 try-catch
this.app.get('/api/sessions/:key', async (req, res) => {
  const session = await this.sessionManager.getOrCreate(req.params.key);
  res.json({ ... });  // ← 如果 getOrCreate 失败会怎样?
});

// 行 103-106: 没有 try-catch
this.app.delete('/api/sessions/:key', async (req, res) => {
  await this.sessionManager.delete(req.params.key);
  res.json({ success: true });  // ← 如果 delete 失败会怎样?
});
```

**影响**: 未捕获的异常会导致服务器崩溃或返回 500 错误但没有错误信息

**建议**: 为所有异步路由添加 try-catch 错误处理

---

#### 3. 配置直接暴露 (行 236-238)

**位置**: 行 236-238

**问题**:
```typescript
this.app.get('/api/config', (req, res) => {
  res.json(this.config);  // ← 直接暴露完整配置
});
```

**安全风险**:
- 暴露 API 密钥 (providers.apiKey)
- 暴露数据库路径
- 暴露内部配置细节
- 暴露环境变量

**建议**: 过滤敏感信息后再返回

---

### 🟡 中等问题

#### 4. 硬编码的版本号 (行 72)

**位置**: 行 72

**问题**:
```typescript
res.json({
  version: '0.1.0',  // ← 硬编码
  uptime: process.uptime(),
  ...
});
```

**影响**: 每次版本更新需要手动修改

**建议**: 从 package.json 读取版本号

---

#### 5. 不一致的错误响应格式

**位置**: 多处

**问题**:
```typescript
// 格式 1: { success: false, error: '...' }
res.status(400).json({ success: false, error: 'Message is required' });

// 格式 2: { error: '...' }
res.status(404).json({ error: 'Channel not found' });

// 格式 3: createErrorResponse(error)
res.status(500).json(createErrorResponse(error));
```

**影响**: 客户端需要处理多种错误格式

**建议**: 统一使用 `createErrorResponse()` 或定义标准错误格式

---

#### 6. 缺少请求验证中间件

**位置**: 全局

**问题**: 每个路由都手动验证参数,代码重复

**示例**:
```typescript
// 重复的验证逻辑
if (!message || typeof message !== 'string') {
  return res.status(400).json({ ... });
}

if (!chatId || typeof chatId !== 'string') {
  return res.status(400).json({ ... });
}
```

**建议**: 使用验证中间件 (如 express-validator 或 zod)

---

#### 7. 缺少认证和授权

**位置**: 全局

**问题**: 所有 API 端点都是公开的,没有任何认证

**安全风险**:
- 任何人都可以访问配置
- 任何人都可以修改插件
- 任何人都可以添加/删除 MCP 服务器
- 任何人都可以发送消息

**建议**: 添加认证中间件 (JWT, API Key, 或 Basic Auth)

---

#### 8. CORS 配置过于宽松 (行 59)

**位置**: 行 59

**问题**:
```typescript
res.header('Access-Control-Allow-Origin', '*');  // ← 允许所有来源
```

**安全风险**: 任何网站都可以调用 API

**建议**: 配置允许的来源列表

---

### 🟢 轻微问题

#### 9. 魔法数字 (行 53, 456)

**位置**: 行 53, 456

**问题**:
```typescript
const MAX_REQUEST_SIZE = 10 * 1024 * 1024;  // ← 应该在配置中
const timeWindow = 60000;  // ← 应该在配置中或常量
```

**建议**: 移到配置文件或常量定义

---

#### 10. 过时的 Date.now() 用法 (行 119)

**位置**: 行 119

**问题**:
```typescript
const key = sessionKey || `api:${Date.now()}`;
```

**问题**:
- 不够唯一 (高并发时可能重复)
- 不是标准的 UUID 格式

**建议**: 使用 `randomUUID()` (已在文件中导入)

---

#### 11. 不必要的非空断言 (行 255, 257, 268)

**位置**: 行 255, 257, 268

**问题**:
```typescript
if (this.mcpManager) {
  const tools = this.mcpManager!.getTools();  // ← 已经检查过了
  const servers = this.mcpManager!.getServerNames();  // ← 不需要 !
}
```

**建议**: 移除非空断言或重构代码

---

#### 12. 缺少速率限制

**位置**: 全局

**问题**: 没有速率限制,容易被滥用

**风险**:
- DoS 攻击
- 资源耗尽
- 成本增加 (LLM API 调用)

**建议**: 添加速率限制中间件 (如 express-rate-limit)

---

#### 13. 缺少请求日志

**位置**: 全局

**问题**: 只有少数端点有日志记录

**影响**: 难以调试和监控

**建议**: 添加请求日志中间件 (如 morgan)

---

#### 14. 动态导入可能导致类型问题 (行 556, 566, 618, 684)

**位置**: 行 556, 566, 618, 684

**问题**:
```typescript
const { MCPClientManager } = await import('../mcp/index.js');
const { ConfigLoader } = await import('../config/loader.js');
```

**问题**:
- 每次都重新导入
- 可能导致类型不一致
- 性能开销

**建议**: 在文件顶部静态导入

---

## 改进建议优先级

### 高优先级 (立即修复)

1. **删除重复的 MCP 路由** (252-270 行)
2. **添加错误处理** 到所有异步路由
3. **过滤敏感配置信息** (行 236-238)
4. **添加基本认证** (至少保护写操作)

### 中优先级 (近期修复)

5. **统一错误响应格式**
6. **添加 CORS 白名单配置**
7. **添加速率限制**
8. **添加请求日志中间件**

### 低优先级 (长期改进)

9. **使用验证中间件**
10. **从 package.json 读取版本号**
11. **使用 randomUUID() 替代 Date.now()**
12. **移除不必要的非空断言**
13. **静态导入替代动态导入**

---

## 具体修复方案

### 修复 1: 删除重复的 MCP 路由

**删除行 252-270**:
```typescript
// 删除这段代码
// MCP routes
if (this.mcpManager) {
  this.app.get('/api/mcp', (req, res) => { ... });
  this.app.get('/api/mcp/tools', (req, res) => { ... });
}
```

**保留行 504-704 的新 MCP 管理端点**

---

### 修复 2: 添加错误处理

**修改前**:
```typescript
this.app.get('/api/sessions/:key', async (req, res) => {
  const session = await this.sessionManager.getOrCreate(req.params.key);
  res.json({ ... });
});
```

**修改后**:
```typescript
this.app.get('/api/sessions/:key', async (req, res) => {
  try {
    const session = await this.sessionManager.getOrCreate(req.params.key);
    res.json({ ... });
  } catch (error) {
    res.status(500).json(createErrorResponse(error));
  }
});
```

---

### 修复 3: 过滤敏感配置

**修改前**:
```typescript
this.app.get('/api/config', (req, res) => {
  res.json(this.config);
});
```

**修改后**:
```typescript
this.app.get('/api/config', (req, res) => {
  const safeConfig = {
    ...this.config,
    providers: Object.fromEntries(
      Object.entries(this.config.providers).map(([key, value]) => [
        key,
        { ...value, apiKey: value.apiKey ? '***' : undefined }
      ])
    )
  };
  res.json(safeConfig);
});
```

---

### 修复 4: 添加基本认证

**新增认证中间件**:
```typescript
private authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== this.config.server.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
```

**应用到写操作**:
```typescript
this.app.put('/api/config', this.authMiddleware.bind(this), async (req, res) => {
  // ...
});

this.app.post('/api/mcp/servers/:name', this.authMiddleware.bind(this), async (req, res) => {
  // ...
});
```

---

### 修复 5: 统一错误响应

**定义标准错误格式**:
```typescript
interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: any;
  };
}
```

**统一使用**:
```typescript
// 所有错误都使用这个格式
res.status(400).json({
  success: false,
  error: {
    message: 'Message is required',
    code: 'INVALID_INPUT'
  }
});
```

---

### 修复 6: 添加速率限制

**安装依赖**:
```bash
npm install express-rate-limit
```

**添加中间件**:
```typescript
import rateLimit from 'express-rate-limit';

private setupMiddleware(): void {
  // 速率限制
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟
    max: 100, // 最多 100 个请求
    message: 'Too many requests, please try again later'
  });

  this.app.use('/api/', limiter);

  // ... 其他中间件
}
```

---

### 修复 7: 添加请求日志

**安装依赖**:
```bash
npm install morgan
```

**添加中间件**:
```typescript
import morgan from 'morgan';

private setupMiddleware(): void {
  // 请求日志
  this.app.use(morgan('combined', {
    stream: {
      write: (message) => this.log.info(message.trim())
    }
  }));

  // ... 其他中间件
}
```

---

## 代码质量评分

| 类别 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | 8/10 | 功能丰富,但有重复路由 |
| 错误处理 | 5/10 | 部分路由缺少错误处理 |
| 安全性 | 3/10 | 缺少认证、CORS 过于宽松、配置暴露 |
| 代码一致性 | 6/10 | 错误格式不统一 |
| 可维护性 | 7/10 | 结构清晰,但有改进空间 |
| 性能 | 7/10 | 基本合理,缺少速率限制 |
| **总分** | **6/10** | **需要改进** |

---

## 总结

API 实现功能完整,但存在以下主要问题:

1. **安全性不足**: 缺少认证、CORS 配置过于宽松、敏感信息暴露
2. **错误处理不完整**: 部分路由缺少 try-catch
3. **代码重复**: MCP 路由重复定义
4. **缺少保护机制**: 无速率限制、无请求日志

**建议**: 优先修复高优先级问题,特别是安全相关的问题,然后逐步改进代码质量。

---

**审查日期**: 2026-03-06
**审查版本**: v0.1.0
**审查人**: Claude Code
