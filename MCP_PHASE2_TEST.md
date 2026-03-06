# MCP 阶段 2 测试 - 配置热重载

## 实施内容

### 1. 添加了动态连接/断开方法

**文件**: `src/mcp/MCPClient.ts`

新增方法:
- `connectOne(name, config)` - 动态连接单个服务器
- `disconnectOne(name)` - 断开单个服务器
- `reconnect(name)` - 重新连接服务器

**功能**:
- 支持运行时添加新的 MCP 服务器
- 支持运行时断开 MCP 服务器
- 自动管理工具注册/注销
- 自动更新服务器状态

### 2. 扩展了 ToolRegistry

**文件**: `src/tools/ToolRegistry.ts`

新增方法:
- `unregisterMany(names)` - 批量注销工具
- `list()` - 获取所有工具列表

**功能**:
- 支持批量注销工具
- 支持查询所有工具

### 3. 添加了 MCP 管理 API 端点

**文件**: `src/api/server.ts`

新增端点:

#### GET /api/mcp/servers
获取所有 MCP 服务器状态

**响应**:
```json
{
  "servers": [
    {
      "name": "mcp1",
      "status": "connected",
      "config": { "type": "local", "command": ["node", "server.js"] },
      "connectedAt": "2026-03-06T10:00:00.000Z",
      "toolCount": 5
    }
  ]
}
```

#### GET /api/mcp/servers/:name
获取单个 MCP 服务器状态

**响应**:
```json
{
  "name": "mcp1",
  "status": "connected",
  "config": { "type": "local", "command": ["node", "server.js"] },
  "connectedAt": "2026-03-06T10:00:00.000Z",
  "toolCount": 5
}
```

#### POST /api/mcp/servers/:name
添加/更新 MCP 服务器

**请求体**:
```json
{
  "type": "local",
  "command": ["node", "my-mcp-server.js"],
  "enabled": true
}
```

**响应**:
```json
{
  "success": true,
  "server": {
    "name": "my-mcp",
    "status": "connected",
    "config": { "type": "local", "command": ["node", "my-mcp-server.js"] },
    "connectedAt": "2026-03-06T10:05:00.000Z",
    "toolCount": 3
  },
  "toolsRegistered": 3
}
```

#### DELETE /api/mcp/servers/:name
删除 MCP 服务器

**响应**:
```json
{
  "success": true,
  "message": "MCP server \"my-mcp\" removed",
  "toolsRemoved": 3
}
```

#### POST /api/mcp/servers/:name/reconnect
重新连接 MCP 服务器

**响应**:
```json
{
  "success": true,
  "server": {
    "name": "mcp1",
    "status": "connected",
    "config": { "type": "local", "command": ["node", "server.js"] },
    "connectedAt": "2026-03-06T10:10:00.000Z",
    "toolCount": 5
  }
}
```

#### POST /api/mcp/servers/:name/toggle
启用/禁用 MCP 服务器

**请求体**:
```json
{
  "enabled": false
}
```

**响应**:
```json
{
  "success": true,
  "enabled": false,
  "server": {
    "name": "mcp1",
    "status": "disconnected",
    "config": { "type": "local", "command": ["node", "server.js"], "enabled": false },
    "toolCount": 0
  }
}
```

## 测试步骤

### 测试 1: 运行时添加 MCP 服务器

**目标**: 验证无需重启即可添加新的 MCP 服务器

**步骤**:
1. 启动应用: `npm start`
2. 查询当前 MCP 服务器:
```bash
curl http://localhost:3000/api/mcp/servers
```
3. 添加新的 MCP 服务器:
```bash
curl -X POST http://localhost:3000/api/mcp/servers/my-mcp \
  -H "Content-Type: application/json" \
  -d '{
    "type": "local",
    "command": ["node", "my-mcp-server.js"],
    "enabled": true
  }'
```
4. 再次查询 MCP 服务器列表
5. 查询工具列表: `curl http://localhost:3000/api/tools`

**预期结果**:
- ✅ 新服务器立即连接
- ✅ 新服务器的工具自动注册
- ✅ 配置自动保存到 config.yaml
- ✅ 无需重启应用

### 测试 2: 运行时删除 MCP 服务器

**目标**: 验证无需重启即可删除 MCP 服务器

**步骤**:
1. 删除 MCP 服务器:
```bash
curl -X DELETE http://localhost:3000/api/mcp/servers/my-mcp
```
2. 查询 MCP 服务器列表
3. 查询工具列表

**预期结果**:
- ✅ 服务器立即断开
- ✅ 服务器的工具自动注销
- ✅ 配置自动从 config.yaml 删除
- ✅ 无需重启应用

### 测试 3: 重新连接失败的服务器

**目标**: 验证可以重新连接失败的服务器

**步骤**:
1. 配置一个会失败的 MCP 服务器
2. 启动应用,观察连接失败
3. 修复服务器问题
4. 重新连接:
```bash
curl -X POST http://localhost:3000/api/mcp/servers/mcp1/reconnect
```

**预期结果**:
- ✅ 服务器重新连接成功
- ✅ 工具重新注册
- ✅ 状态更新为 "connected"

### 测试 4: 启用/禁用 MCP 服务器

**目标**: 验证可以动态启用/禁用服务器

**步骤**:
1. 禁用服务器:
```bash
curl -X POST http://localhost:3000/api/mcp/servers/mcp1/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```
2. 查询服务器状态
3. 启用服务器:
```bash
curl -X POST http://localhost:3000/api/mcp/servers/mcp1/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```
4. 查询服务器状态

**预期结果**:
- ✅ 禁用时服务器断开连接
- ✅ 禁用时工具注销
- ✅ 启用时服务器重新连接
- ✅ 启用时工具重新注册
- ✅ 配置自动保存

### 测试 5: 配置持久化

**目标**: 验证配置更改持久化到 config.yaml

**步骤**:
1. 添加新的 MCP 服务器
2. 查看 config.yaml 文件
3. 重启应用
4. 查询 MCP 服务器列表

**预期结果**:
- ✅ 新服务器配置保存到 config.yaml
- ✅ 重启后新服务器自动连接
- ✅ 配置格式正确

### 测试 6: 错误处理

**目标**: 验证错误处理正确

**步骤**:
1. 尝试添加无效配置:
```bash
curl -X POST http://localhost:3000/api/mcp/servers/invalid \
  -H "Content-Type: application/json" \
  -d '{"type": "invalid"}'
```
2. 尝试删除不存在的服务器:
```bash
curl -X DELETE http://localhost:3000/api/mcp/servers/non-existent
```
3. 尝试重连不存在的服务器:
```bash
curl -X POST http://localhost:3000/api/mcp/servers/non-existent/reconnect
```

**预期结果**:
- ✅ 返回 400 错误和清晰的错误信息
- ✅ 返回 404 错误
- ✅ 返回 404 错误
- ✅ 应用继续正常运行

## 完整测试脚本

```bash
#!/bin/bash

API_URL="http://localhost:3000"

echo "=== 测试 1: 查询所有 MCP 服务器 ==="
curl -s "$API_URL/api/mcp/servers" | jq

echo -e "\n=== 测试 2: 添加新的 MCP 服务器 ==="
curl -s -X POST "$API_URL/api/mcp/servers/test-mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "local",
    "command": ["node", "test-server.js"],
    "enabled": true
  }' | jq

echo -e "\n=== 测试 3: 查询新添加的服务器 ==="
curl -s "$API_URL/api/mcp/servers/test-mcp" | jq

echo -e "\n=== 测试 4: 禁用服务器 ==="
curl -s -X POST "$API_URL/api/mcp/servers/test-mcp/toggle" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' | jq

echo -e "\n=== 测试 5: 启用服务器 ==="
curl -s -X POST "$API_URL/api/mcp/servers/test-mcp/toggle" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' | jq

echo -e "\n=== 测试 6: 重新连接服务器 ==="
curl -s -X POST "$API_URL/api/mcp/servers/test-mcp/reconnect" | jq

echo -e "\n=== 测试 7: 删除服务器 ==="
curl -s -X DELETE "$API_URL/api/mcp/servers/test-mcp" | jq

echo -e "\n=== 测试 8: 验证服务器已删除 ==="
curl -s "$API_URL/api/mcp/servers" | jq
```

## 性能影响

### 内存占用
- 每个 MCP 服务器: ~1-5 MB
- 每个工具定义: ~1 KB
- 状态信息: ~500 bytes/server

### 响应时间
- 查询服务器状态: < 1 ms
- 添加服务器: 取决于连接时间 (通常 100-2000 ms)
- 删除服务器: < 50 ms
- 切换启用/禁用: 取决于连接/断开时间

## 向后兼容性

- ✅ 现有配置文件格式不变
- ✅ 现有 API 端点不受影响
- ✅ 启动流程保持兼容
- ✅ 工具注册机制不变

## 安全考虑

1. **配置验证**: 所有配置在应用前都经过验证
2. **错误隔离**: 单个服务器失败不影响其他服务器
3. **权限控制**: API 端点应配合认证中间件使用 (未来实现)
4. **资源限制**: 建议限制最大 MCP 服务器数量

## 下一步优化建议

1. **批量操作**: 支持批量添加/删除服务器
2. **健康检查**: 定期检查服务器健康状态
3. **自动重连**: 失败的服务器自动重试连接
4. **WebSocket 通知**: 实时推送服务器状态变化
5. **配置模板**: 预定义常用 MCP 服务器配置
6. **权限管理**: 添加 API 认证和授权

## 总结

阶段 2 完成后,AesyClaw 的 MCP 系统具备:

- ✅ **完全动态**: 无需重启即可管理 MCP 服务器
- ✅ **配置持久化**: 所有更改自动保存
- ✅ **工具自动管理**: 工具随服务器自动注册/注销
- ✅ **状态监控**: 实时查看服务器连接状态
- ✅ **错误恢复**: 支持重新连接失败的服务器
- ✅ **灵活控制**: 支持启用/禁用服务器

**用户体验提升**:
- 配置更改从需要重启到立即生效
- 调试和测试更加便捷
- 生产环境可以动态调整 MCP 配置
