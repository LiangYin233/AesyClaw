# MCP 优化计划

## 概述

优化 AesyClaw 的 MCP (Model Context Protocol) 实现,实现两个核心目标:
1. **非阻塞启动**: MCP 连接不阻塞主程序启动
2. **配置热重载**: 运行时添加/修改 MCP 配置无需重启

## 当前问题分析

### 问题 1: 启动阻塞

**位置**: `src/bootstrap/ServiceFactory.ts:249-275`

**问题**:
```typescript
// 当前实现 - 阻塞启动
container.registerSingleton(TOKENS.MCPClientManager, async (c) => {
  const mcpManager = new MCPClientManager();
  await mcpManager.connect(cfg.mcp);  // ← 阻塞!
  // ...
});
```

**影响**:
- 如果配置了多个 MCP 服务器,每个连接超时 120 秒
- 最坏情况: 3 个服务器全部超时 = 360 秒启动延迟
- 即使只有 1 个服务器失败,也会延迟 120 秒
- 用户体验差,无法快速启动应用

### 问题 2: 无配置热重载

**当前行为**:
- 修改 `config.yaml` 中的 MCP 配置后必须重启应用
- 无法动态添加新的 MCP 服务器
- 无法动态禁用/启用 MCP 服务器
- 调试和测试不便

## 优化方案

### 阶段 1: 非阻塞启动 (1-2 天)

#### 1.1 添加连接状态管理

**修改文件**: `src/mcp/MCPClient.ts`

**新增类型**:
```typescript
export type MCPServerStatus = 'connecting' | 'connected' | 'failed' | 'disconnected';

export interface MCPServerInfo {
  name: string;
  status: MCPServerStatus;
  config: MCPServerConfig;
  connectedAt?: Date;
  error?: string;
  toolCount: number;
}
```

**扩展 MCPClientManager**:
```typescript
export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private serverStatus: Map<string, MCPServerInfo> = new Map();
  private log = logger.child({ prefix: 'MCP' });

  /**
   * 非阻塞连接 - 后台异步连接所有服务器
   */
  async connectAsync(config: MCPServersConfig): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, serverConfig] of Object.entries(config)) {
      if (serverConfig.enabled === false) {
        this.log.info(`Skipping disabled MCP server: ${name}`);
        continue;
      }

      // 初始化状态
      this.serverStatus.set(name, {
        name,
        status: 'connecting',
        config: serverConfig,
        toolCount: 0
      });

      // 后台连接,不阻塞
      const promise = this.connectServer(name, serverConfig)
        .then(() => {
          const info = this.serverStatus.get(name)!;
          info.status = 'connected';
          info.connectedAt = new Date();
          info.toolCount = this.getServerToolCount(name);
          this.log.info(`MCP server connected: ${name} (${info.toolCount} tools)`);
        })
        .catch((error) => {
          const info = this.serverStatus.get(name)!;
          info.status = 'failed';
          info.error = error instanceof Error ? error.message : String(error);
          this.log.error(`MCP server connection failed: ${name}`, error);
        });

      promises.push(promise);
    }

    // 不等待所有连接完成,立即返回
    // 连接在后台继续进行
    Promise.all(promises).then(() => {
      this.log.info('All MCP server connections completed');
    });
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(name?: string): MCPServerInfo | MCPServerInfo[] {
    if (name) {
      return this.serverStatus.get(name) || {
        name,
        status: 'disconnected',
        config: {} as MCPServerConfig,
        toolCount: 0
      };
    }
    return Array.from(this.serverStatus.values());
  }

  /**
   * 获取指定服务器的工具数量
   */
  private getServerToolCount(serverName: string): number {
    let count = 0;
    for (const toolName of this.tools.keys()) {
      if (toolName.startsWith(`mcp_${serverName}_`)) {
        count++;
      }
    }
    return count;
  }
}
```

#### 1.2 修改服务初始化

**修改文件**: `src/bootstrap/ServiceFactory.ts:249-275`

**新实现**:
```typescript
// Register MCPClientManager (optional)
container.registerSingleton(TOKENS.MCPClientManager, async (c) => {
  const cfg = await c.resolve<Config>(TOKENS.Config);
  if (!cfg.mcp || Object.keys(cfg.mcp).length === 0) {
    return null;
  }

  log.debug('Creating MCPClientManager');
  const mcpManager = new MCPClientManager();

  // 非阻塞连接 - 立即返回,后台连接
  mcpManager.connectAsync(cfg.mcp);  // ← 不再 await!

  log.info('MCP servers connecting in background...');

  // 注册工具注册回调
  // 当 MCP 工具加载完成时,动态注册到 ToolRegistry
  const toolRegistry = await c.resolve<ToolRegistry>(TOKENS.ToolRegistry);
  mcpManager.onToolsLoaded((tools) => {
    for (const tool of tools) {
      toolRegistry.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (params: any) => {
          return mcpManager.callTool(tool.name, params);
        },
        source: 'mcp' as ToolSource
      }, 'mcp');
    }
    log.info(`MCP tools registered: ${tools.length}`);
  });

  return mcpManager;
});
```

#### 1.3 添加工具加载回调

**修改文件**: `src/mcp/MCPClient.ts`

**新增方法**:
```typescript
export class MCPClientManager {
  private toolLoadCallbacks: Array<(tools: ToolDefinition[]) => void> = [];

  /**
   * 注册工具加载回调
   */
  onToolsLoaded(callback: (tools: ToolDefinition[]) => void): void {
    this.toolLoadCallbacks.push(callback);
  }

  /**
   * 触发工具加载回调
   */
  private notifyToolsLoaded(tools: ToolDefinition[]): void {
    for (const callback of this.toolLoadCallbacks) {
      try {
        callback(tools);
      } catch (error) {
        this.log.error('Tool load callback error:', error);
      }
    }
  }

  private async loadTools(client: Client, prefix: string): Promise<void> {
    try {
      const response = await client.listTools();
      const newTools: ToolDefinition[] = [];

      for (const tool of response.tools || []) {
        const toolName = `mcp_${prefix}_${tool.name}`;
        const toolDef = {
          name: toolName,
          description: tool.description || '',
          parameters: tool.inputSchema
        };
        this.tools.set(toolName, toolDef);
        newTools.push(toolDef);
      }

      // 通知工具已加载
      if (newTools.length > 0) {
        this.notifyToolsLoaded(newTools);
      }
    } catch (error) {
      this.log.error(`Failed to load tools from ${prefix}:`, error);
    }
  }
}
```

---

### 阶段 2: 配置热重载 (2-3 天)

#### 2.1 添加动态连接/断开方法

**修改文件**: `src/mcp/MCPClient.ts`

**新增方法**:
```typescript
export class MCPClientManager {
  /**
   * 动态连接单个服务器
   */
  async connectOne(name: string, config: MCPServerConfig): Promise<void> {
    // 如果已连接,先断开
    if (this.clients.has(name)) {
      await this.disconnectOne(name);
    }

    // 更新状态
    this.serverStatus.set(name, {
      name,
      status: 'connecting',
      config,
      toolCount: 0
    });

    try {
      await this.connectServer(name, config);

      const info = this.serverStatus.get(name)!;
      info.status = 'connected';
      info.connectedAt = new Date();
      info.toolCount = this.getServerToolCount(name);

      // 通知工具已加载
      const tools = this.getServerTools(name);
      if (tools.length > 0) {
        this.notifyToolsLoaded(tools);
      }

      this.log.info(`MCP server connected: ${name} (${info.toolCount} tools)`);
    } catch (error) {
      const info = this.serverStatus.get(name)!;
      info.status = 'failed';
      info.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 断开单个服务器
   */
  async disconnectOne(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      return;
    }

    // 移除工具
    const toolsToRemove: string[] = [];
    for (const toolName of this.tools.keys()) {
      if (toolName.startsWith(`mcp_${name}_`)) {
        toolsToRemove.push(toolName);
      }
    }

    for (const toolName of toolsToRemove) {
      this.tools.delete(toolName);
    }

    // 关闭客户端
    await client.close();
    this.clients.delete(name);

    // 更新状态
    const info = this.serverStatus.get(name);
    if (info) {
      info.status = 'disconnected';
      info.toolCount = 0;
    }

    this.log.info(`MCP server disconnected: ${name} (removed ${toolsToRemove.length} tools)`);
  }

  /**
   * 获取指定服务器的所有工具
   */
  private getServerTools(serverName: string): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const [toolName, toolDef] of this.tools.entries()) {
      if (toolName.startsWith(`mcp_${serverName}_`)) {
        tools.push(toolDef);
      }
    }
    return tools;
  }

  /**
   * 重新连接服务器
   */
  async reconnect(name: string): Promise<void> {
    const info = this.serverStatus.get(name);
    if (!info) {
      throw new Error(`MCP server not found: ${name}`);
    }

    await this.connectOne(name, info.config);
  }
}
```

#### 2.2 添加 API 端点

**修改文件**: `src/api/server.ts`

**新增端点**:
```typescript
// 获取所有 MCP 服务器状态
this.app.get('/api/mcp/servers', (req, res) => {
  if (!this.mcpManager) {
    return res.json({ servers: [] });
  }

  const servers = this.mcpManager.getServerStatus();
  res.json({ servers });
});

// 获取单个 MCP 服务器状态
this.app.get('/api/mcp/servers/:name', (req, res) => {
  if (!this.mcpManager) {
    return res.status(404).json({ error: 'MCP not configured' });
  }

  const { name } = req.params;
  const server = this.mcpManager.getServerStatus(name);

  if (!server || (server as MCPServerInfo).status === 'disconnected') {
    return res.status(404).json({ error: `MCP server not found: ${name}` });
  }

  res.json(server);
});

// 添加/更新 MCP 服务器
this.app.post('/api/mcp/servers/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const config: MCPServerConfig = req.body;

    // 验证配置
    if (!config.type || !['local', 'http'].includes(config.type)) {
      return res.status(400).json({
        error: 'Invalid config: type must be "local" or "http"'
      });
    }

    if (config.type === 'local' && !config.command) {
      return res.status(400).json({
        error: 'Invalid config: command is required for local type'
      });
    }

    if (config.type === 'http' && !config.url) {
      return res.status(400).json({
        error: 'Invalid config: url is required for http type'
      });
    }

    // 初始化 MCPClientManager (如果不存在)
    if (!this.mcpManager) {
      const { MCPClientManager } = await import('../mcp/index.js');
      this.mcpManager = new MCPClientManager();
    }

    // 连接服务器
    await this.mcpManager.connectOne(name, config);

    // 保存到配置文件
    this.config.mcp = this.config.mcp || {};
    this.config.mcp[name] = config;
    const { ConfigLoader } = await import('../config/loader.js');
    await ConfigLoader.save(this.config);

    // 注册工具到 ToolRegistry
    const tools = this.mcpManager.getTools().filter(t =>
      t.name.startsWith(`mcp_${name}_`)
    );

    for (const tool of tools) {
      this.agent.getToolRegistry().register({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (params: any) => {
          return this.mcpManager!.callTool(tool.name, params);
        },
        source: 'mcp' as any
      }, 'mcp');
    }

    res.json({
      success: true,
      server: this.mcpManager.getServerStatus(name),
      toolsRegistered: tools.length
    });
  } catch (error) {
    res.status(500).json(createErrorResponse(error));
  }
});

// 删除 MCP 服务器
this.app.delete('/api/mcp/servers/:name', async (req, res) => {
  try {
    if (!this.mcpManager) {
      return res.status(404).json({ error: 'MCP not configured' });
    }

    const { name } = req.params;

    // 断开连接
    await this.mcpManager.disconnectOne(name);

    // 从配置文件中删除
    if (this.config.mcp && this.config.mcp[name]) {
      delete this.config.mcp[name];
      const { ConfigLoader } = await import('../config/loader.js');
      await ConfigLoader.save(this.config);
    }

    // 从 ToolRegistry 中注销工具
    const toolRegistry = this.agent.getToolRegistry();
    const toolsToRemove = toolRegistry.list().filter(t =>
      t.name.startsWith(`mcp_${name}_`)
    );

    for (const tool of toolsToRemove) {
      toolRegistry.unregister(tool.name);
    }

    res.json({
      success: true,
      message: `MCP server "${name}" removed`,
      toolsRemoved: toolsToRemove.length
    });
  } catch (error) {
    res.status(500).json(createErrorResponse(error));
  }
});

// 重新连接 MCP 服务器
this.app.post('/api/mcp/servers/:name/reconnect', async (req, res) => {
  try {
    if (!this.mcpManager) {
      return res.status(404).json({ error: 'MCP not configured' });
    }

    const { name } = req.params;
    await this.mcpManager.reconnect(name);

    res.json({
      success: true,
      server: this.mcpManager.getServerStatus(name)
    });
  } catch (error) {
    res.status(500).json(createErrorResponse(error));
  }
});

// 启用/禁用 MCP 服务器
this.app.post('/api/mcp/servers/:name/toggle', async (req, res) => {
  try {
    const { name } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid request: enabled must be a boolean'
      });
    }

    // 更新配置
    if (!this.config.mcp || !this.config.mcp[name]) {
      return res.status(404).json({
        error: `MCP server not found in config: ${name}`
      });
    }

    this.config.mcp[name].enabled = enabled;
    const { ConfigLoader } = await import('../config/loader.js');
    await ConfigLoader.save(this.config);

    // 连接或断开
    if (this.mcpManager) {
      if (enabled) {
        await this.mcpManager.connectOne(name, this.config.mcp[name]);
      } else {
        await this.mcpManager.disconnectOne(name);
      }
    }

    res.json({
      success: true,
      enabled,
      server: this.mcpManager?.getServerStatus(name)
    });
  } catch (error) {
    res.status(500).json(createErrorResponse(error));
  }
});
```

#### 2.3 添加 ToolRegistry.unregister 方法

**修改文件**: `src/tools/ToolRegistry.ts`

**新增方法**:
```typescript
export class ToolRegistry {
  // ... 现有代码

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 批量注销工具
   */
  unregisterMany(names: string[]): number {
    let count = 0;
    for (const name of names) {
      if (this.unregister(name)) {
        count++;
      }
    }
    return count;
  }
}
```

---

## 验证标准

### 阶段 1 验证

- ✅ 主程序启动不等待 MCP 连接
- ✅ MCP 连接在后台异步进行
- ✅ 可查询 MCP 服务器连接状态
- ✅ MCP 工具在连接成功后自动注册
- ✅ 连接失败不影响主程序运行

### 阶段 2 验证

- ✅ 可通过 API 添加新的 MCP 服务器
- ✅ 可通过 API 删除 MCP 服务器
- ✅ 可通过 API 启用/禁用 MCP 服务器
- ✅ 可通过 API 重新连接 MCP 服务器
- ✅ 配置更改自动保存到 config.yaml
- ✅ 工具自动注册/注销

---

## API 测试示例

### 获取所有 MCP 服务器状态
```bash
curl http://localhost:3000/api/mcp/servers
```

预期响应:
```json
{
  "servers": [
    {
      "name": "mcp1",
      "status": "connected",
      "config": { "type": "local", "command": ["node", "server.js"] },
      "connectedAt": "2026-03-06T10:00:00.000Z",
      "toolCount": 5
    },
    {
      "name": "mcp2",
      "status": "failed",
      "config": { "type": "http", "url": "http://localhost:8080" },
      "error": "Connection timeout",
      "toolCount": 0
    }
  ]
}
```

### 添加新的 MCP 服务器
```bash
curl -X POST http://localhost:3000/api/mcp/servers/my-mcp \
  -H "Content-Type: application/json" \
  -d '{
    "type": "local",
    "command": ["node", "my-mcp-server.js"],
    "enabled": true
  }'
```

### 删除 MCP 服务器
```bash
curl -X DELETE http://localhost:3000/api/mcp/servers/my-mcp
```

### 重新连接 MCP 服务器
```bash
curl -X POST http://localhost:3000/api/mcp/servers/mcp1/reconnect
```

### 启用/禁用 MCP 服务器
```bash
curl -X POST http://localhost:3000/api/mcp/servers/mcp1/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

---

## 实施顺序

### Day 1: 非阻塞启动
1. 添加连接状态管理 (1.1)
2. 修改服务初始化 (1.2)
3. 添加工具加载回调 (1.3)
4. 测试启动流程

### Day 2: 动态连接/断开
1. 添加 connectOne/disconnectOne 方法 (2.1)
2. 添加 ToolRegistry.unregister 方法 (2.3)
3. 单元测试

### Day 3: API 端点
1. 添加 API 端点 (2.2)
2. 集成测试
3. 文档更新

---

## 风险评估

### 低风险
- ✅ 非阻塞启动不影响现有功能
- ✅ 新增 API 端点,不修改现有端点
- ✅ 向后兼容,现有配置继续工作

### 回滚计划
- Git revert 到优化前版本
- 重启服务

---

## 预期成果

完成后,AesyClaw 将具备:

- ✅ **快速启动**: MCP 连接不阻塞主程序,启动时间 < 5 秒
- ✅ **配置热重载**: 无需重启即可添加/修改 MCP 服务器
- ✅ **状态监控**: 实时查看 MCP 服务器连接状态
- ✅ **动态工具管理**: 工具自动注册/注销
- ✅ **更好的用户体验**: 快速启动,灵活配置

**质量提升**:
- 启动时间从最坏 360 秒降低到 < 5 秒
- 配置更改从需要重启到立即生效
- 调试和测试更加便捷
