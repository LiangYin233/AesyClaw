# MCP 阶段 1 测试 - 非阻塞启动

## 实施内容

### 1. 添加了 MCP 连接状态管理

**文件**: `src/types.ts`

新增类型:
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

### 2. 扩展了 MCPClientManager

**文件**: `src/mcp/MCPClient.ts`

新增属性:
- `serverStatus: Map<string, MCPServerInfo>` - 服务器状态跟踪
- `toolLoadCallbacks: Array<(tools: ToolDefinition[]) => void>` - 工具加载回调

新增方法:
- `connectAsync(config)` - 非阻塞连接所有服务器
- `onToolsLoaded(callback)` - 注册工具加载回调
- `getServerStatus(name?)` - 获取服务器状态
- `notifyToolsLoaded(tools)` - 触发工具加载回调
- `getServerToolCount(serverName)` - 获取服务器工具数量
- `getServerTools(serverName)` - 获取服务器所有工具

### 3. 修改了服务初始化流程

**文件**: `src/bootstrap/ServiceFactory.ts`

**修改前** (阻塞):
```typescript
const mcpManager = new MCPClientManager();
await mcpManager.connect(cfg.mcp);  // ← 阻塞!

const mcpTools = mcpManager.getTools();
for (const tool of mcpTools) {
  toolRegistry.register(tool, 'mcp');
}
```

**修改后** (非阻塞):
```typescript
const mcpManager = new MCPClientManager();
mcpManager.connectAsync(cfg.mcp);  // ← 不阻塞!

// 注册工具加载回调
mcpManager.onToolsLoaded((tools) => {
  for (const tool of tools) {
    toolRegistry.register(tool, 'mcp');
  }
  log.info(`MCP tools registered: ${tools.length}`);
});
```

## 测试步骤

### 测试 1: 快速启动

**目标**: 验证主程序启动不等待 MCP 连接

**步骤**:
1. 在 `config.yaml` 中配置一个 MCP 服务器
2. 启动应用: `npm start`
3. 观察启动日志

**预期结果**:
```
[AesyClaw] Initializing services with DI container...
[MCP] Skipping disabled MCP server: xxx (如果有禁用的)
[AesyClaw] MCP servers connecting in background...
[AesyClaw] All services initialized successfully
[AesyClaw] API server started on port 3000
[MCP] MCP server connected: xxx (5 tools)
[AesyClaw] MCP tools registered: 5
```

**验证点**:
- ✅ "All services initialized successfully" 出现在 MCP 连接完成之前
- ✅ 启动时间 < 5 秒 (即使 MCP 服务器连接较慢)
- ✅ MCP 工具在连接成功后自动注册

### 测试 2: MCP 连接失败不影响启动

**目标**: 验证 MCP 连接失败不阻塞主程序

**步骤**:
1. 在 `config.yaml` 中配置一个无效的 MCP 服务器:
```yaml
mcp:
  invalid-server:
    type: local
    command: ["node", "non-existent-server.js"]
    enabled: true
```
2. 启动应用: `npm start`
3. 观察启动日志

**预期结果**:
```
[AesyClaw] MCP servers connecting in background...
[AesyClaw] All services initialized successfully
[AesyClaw] API server started on port 3000
[MCP] MCP server connection failed: invalid-server
```

**验证点**:
- ✅ 主程序正常启动
- ✅ API 服务器正常运行
- ✅ MCP 连接失败只记录错误日志,不影响其他功能

### 测试 3: 多个 MCP 服务器并行连接

**目标**: 验证多个 MCP 服务器并行连接

**步骤**:
1. 配置多个 MCP 服务器 (如果有的话)
2. 启动应用: `npm start`
3. 观察连接日志

**预期结果**:
```
[MCP] MCP servers connecting in background...
[MCP] MCP server connected: server1 (3 tools)
[MCP] MCP server connected: server2 (5 tools)
[MCP] All MCP server connections completed
[AesyClaw] MCP tools registered: 3
[AesyClaw] MCP tools registered: 5
```

**验证点**:
- ✅ 服务器并行连接 (不是串行)
- ✅ 每个服务器的工具独立注册
- ✅ 总连接时间接近最慢的单个服务器,而不是所有服务器时间之和

### 测试 4: 工具动态注册

**目标**: 验证 MCP 工具在连接成功后自动注册

**步骤**:
1. 启动应用
2. 等待 MCP 连接完成
3. 通过 API 查询工具列表: `curl http://localhost:3000/api/tools`

**预期结果**:
- ✅ 工具列表包含 MCP 工具 (名称格式: `mcp_serverName_toolName`)
- ✅ 工具可以正常调用

## 性能对比

### 修改前 (阻塞启动)

假设配置了 3 个 MCP 服务器:
- server1: 连接时间 2 秒
- server2: 连接时间 3 秒
- server3: 连接失败,超时 120 秒

**总启动时间**: 2 + 3 + 120 = **125 秒**

### 修改后 (非阻塞启动)

**主程序启动时间**: < 5 秒
**MCP 连接时间** (后台): max(2, 3, 120) = 120 秒

**用户感知启动时间**: **< 5 秒** ✅

## 向后兼容性

- ✅ 保留了原有的 `connect()` 方法,现有代码不受影响
- ✅ 新增的 `connectAsync()` 方法是可选的
- ✅ 配置文件格式不变
- ✅ 工具注册机制不变

## 下一步

阶段 1 完成后,可以继续实施阶段 2: 配置热重载

阶段 2 将添加:
- 动态连接/断开单个 MCP 服务器
- API 端点管理 MCP 服务器
- 工具动态注册/注销
