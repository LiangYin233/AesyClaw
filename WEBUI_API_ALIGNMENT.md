# WebUI 与 API 对齐分析

## 概述

本文档分析 WebUI 前端与后端 API 的对齐情况，识别缺失的功能和不一致的地方。

**最后更新：** 2026-03-06

**状态：** ✅ P0 和 P1 优先级功能已完成

## API 端点对比

### ✅ 已对齐的端点

| 端点 | WebUI 方法 | 状态 |
|------|-----------|------|
| GET /api/status | getStatus() | ✅ |
| GET /api/sessions | getSessions() | ✅ |
| GET /api/sessions/:key | getSession() | ✅ |
| DELETE /api/sessions/:key | deleteSession() | ✅ |
| POST /api/chat | sendMessage() | ✅ |
| GET /api/channels | getChannels() | ✅ |
| GET /api/tools | getTools() | ✅ |
| GET /api/plugins | getPlugins() | ✅ |
| POST /api/plugins/:name/toggle | togglePlugin() | ✅ |
| POST /api/plugins/:name/reload | reloadPlugin() | ✅ |
| PUT /api/plugins/:name/config | updatePluginConfig() | ✅ |
| GET /api/config | getConfig() | ✅ |
| PUT /api/config | saveConfig() | ✅ |
| GET /api/skills | getSkills() | ✅ |
| POST /api/skills/:name/toggle | toggleSkill() | ✅ |
| GET /api/cron | getCronJobs() | ✅ |
| GET /api/cron/:id | getCronJob() | ✅ |
| POST /api/cron | createCronJob() | ✅ |
| PUT /api/cron/:id | updateCronJob() | ✅ |
| DELETE /api/cron/:id | deleteCronJob() | ✅ |
| POST /api/cron/:id/toggle | toggleCronJob() | ✅ |

### ✅ 新增对齐的端点（已完成）

#### MCP 动态管理
| 端点 | WebUI 方法 | 状态 |
|------|-----------|------|
| GET /api/mcp/servers | getMCPServers() | ✅ |
| GET /api/mcp/servers/:name | getMCPServer() | ✅ |
| POST /api/mcp/servers/:name | addMCPServer() | ✅ |
| DELETE /api/mcp/servers/:name | deleteMCPServer() | ✅ |
| POST /api/mcp/servers/:name/reconnect | reconnectMCPServer() | ✅ |
| POST /api/mcp/servers/:name/toggle | toggleMCPServer() | ✅ |

#### Logs 管理
| 端点 | WebUI 方法 | 状态 |
|------|-----------|------|
| GET /api/logs/config | getLogConfig() | ✅ |
| POST /api/logs/level | setLogLevel() | ✅ |

#### Metrics 监控
| 端点 | WebUI 方法 | 状态 |
|------|-----------|------|
| GET /api/metrics/names | getMetricNames() | ✅ |
| GET /api/metrics/stats/:name | getMetricStats() | ✅ |
| GET /api/metrics/export | exportMetrics() | ✅ |
| POST /api/metrics/clear | clearMetrics() | ✅ |
| GET /api/metrics/memory | getMemoryUsage() | ✅ |
| GET /api/metrics/overview | getMetricOverview() | ✅ |
| GET /api/metrics/config | getMetricConfig() | ✅ |
| POST /api/metrics/config | updateMetricConfig() | ✅ |

### ❌ 缺失的端点（API 有但 WebUI 没有）

#### 1. Channel 管理
- **POST /api/channels/:name/send** - 发送消息到指定频道
  - 用途：通过 API 向 OneBot 频道发送消息
  - 影响：无法通过 WebUI 测试消息发送功能

#### 2. Skills 详情
- **GET /api/skills/:name** - 获取单个 Skill 详情
  - 用途：查看 Skill 的文件列表和详细信息
  - 影响：Skills 页面只能显示列表，无法查看详情

#### 3. ~~Logs 管理~~ ✅ 已完成
- ~~GET /api/logs/config - 获取日志配置~~
- ~~POST /api/logs/level - 动态修改日志级别~~

#### 4. ~~Metrics 监控~~ ✅ 已完成
- ~~GET /api/metrics/names - 获取所有指标名称~~
- ~~GET /api/metrics/stats/:name - 获取指定指标统计~~
- ~~GET /api/metrics/export - 导出所有指标~~
- ~~POST /api/metrics/clear - 清空指标数据~~
- ~~GET /api/metrics/memory - 获取内存使用情况~~
- ~~GET /api/metrics/overview - 获取指标概览~~
- ~~GET /api/metrics/config - 获取指标配置~~
- ~~POST /api/metrics/config - 更新指标配置~~

#### 5. ~~MCP 动态管理（新增功能）~~ ✅ 已完成
- ~~GET /api/mcp/servers - 获取所有 MCP 服务器状态~~
- ~~GET /api/mcp/servers/:name - 获取单个 MCP 服务器状态和工具列表~~
- ~~POST /api/mcp/servers/:name - 动态添加 MCP 服务器~~
- ~~DELETE /api/mcp/servers/:name - 动态删除 MCP 服务器~~
- ~~POST /api/mcp/servers/:name/reconnect - 重新连接 MCP 服务器~~
- ~~POST /api/mcp/servers/:name/toggle - 启用/禁用 MCP 服务器~~

## 关键问题

### ~~🔴 P0 - MCP 页面功能不完整~~ ✅ 已完成

**已完成的改进：**
- ✅ 添加服务器状态显示（连接状态、工具数量、连接时间、错误信息）
- ✅ 添加动态管理按钮（重连、删除、启用/禁用）
- ✅ 添加实时状态刷新（每 5 秒）
- ✅ 添加工具列表查看对话框
- ✅ 支持添加新服务器后立即连接（无需重启）
- ✅ 完整的类型定义（MCPServerConfig, MCPServerInfo, MCPTool）

**实现文件：**
- `webui/src/types/api.ts` - 类型定义
- `webui/src/composables/useApi.ts` - API 方法
- `webui/src/views/Mcp.vue` - 动态管理界面

### ~~🟡 P1 - 缺少监控和调试功能~~ ✅ 已完成

**已完成的改进：**
- ✅ 添加 Logs 页面（`webui/src/views/Logs.vue`）
  - 查看当前日志配置
  - 动态修改日志级别（error/warn/info/debug/trace）
  - 实时生效，无需重启
- ✅ 添加 Metrics 页面（`webui/src/views/Metrics.vue`）
  - 概览卡片（指标总数、数据点总数、内存使用）
  - 内存使用详情（堆内存、RSS、外部内存等）
  - 指标列表（支持搜索）
  - 指标详情对话框（统计数据、百分位数）
  - 导出功能（JSON 格式）
  - 清空功能
  - 自动刷新（每 10 秒）
- ✅ 更新路由配置（`webui/src/router/index.ts`）
- ✅ 更新导航菜单（`webui/src/components/AppLayout.vue`）

### 🟡 P1 - Channel 消息发送测试缺失

**问题描述：**
- 无 Metrics 监控页面，无法查看性能指标
- 无 Logs 管理页面，无法动态调整日志级别
- 无法通过 WebUI 测试消息发送功能

**建议：**
1. 添加 Metrics 页面显示性能指标
2. 添加 Logs 页面管理日志级别
3. 在 Channels 页面添加消息发送测试功能

### 🟢 P2 - Skills 详情页缺失

**问题描述：**
- Skills 页面只显示列表，无法查看文件结构
- API 已提供 `GET /api/skills/:name` 端点

**建议：**
- 添加 Skills 详情对话框或页面

## 类型定义问题

### Config 类型不完整

```typescript
// webui/src/types/api.ts
export interface Config {
  // ...
  mcp?: any  // ❌ 使用 any 类型
}
```

**建议：**
```typescript
export interface MCPServerConfig {
  type: 'local' | 'http'
  command?: string | string[]
  url?: string
  environment?: string | Record<string, string>
  enabled?: boolean
  timeout?: number
}

export interface Config {
  // ...
  mcp?: Record<string, MCPServerConfig>
}
```

### 缺少 MCP 相关类型

需要添加：
```typescript
export type MCPServerStatus = 'connecting' | 'connected' | 'failed' | 'disconnected'

export interface MCPServerInfo {
  name: string
  status: MCPServerStatus
  config: MCPServerConfig
  connectedAt?: string
  error?: string
  toolCount: number
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}
```

## 优先级建议

### 立即修复（P0）
1. **升级 MCP 页面** - 使用新的 MCP 管理 API
   - 显示服务器实时状态
   - 支持动态添加/删除/重连
   - 显示工具列表
   - 无需重启即可生效

### 短期改进（P1）
2. **添加 Metrics 页面** - 性能监控
3. **添加 Logs 管理** - 动态调整日志级别
4. **完善 Channels 页面** - 添加消息发送测试

### 长期优化（P2）
5. **添加 Skills 详情页** - 查看文件结构
6. **完善类型定义** - 移除 any 类型

## 实施建议

### 阶段 1：MCP 页面升级（2-3 天）

**文件修改：**
- `webui/src/types/api.ts` - 添加 MCP 类型定义
- `webui/src/composables/useApi.ts` - 添加 MCP 管理方法
- `webui/src/views/Mcp.vue` - 重构为动态管理界面

**新增功能：**
- 服务器状态卡片（状态徽章、工具数量、连接时间）
- 操作按钮（重连、删除、启用/禁用）
- 添加服务器对话框（添加后立即连接）
- 工具列表查看
- 自动刷新状态

### 阶段 2：监控和调试（1-2 天）

**新增页面：**
- `webui/src/views/Metrics.vue` - 性能监控
- `webui/src/views/Logs.vue` - 日志管理

**路由更新：**
- 添加 /metrics 和 /logs 路由

### 阶段 3：其他改进（1 天）

- Skills 详情对话框
- Channels 消息发送测试
- 类型定义完善

## 总结

**当前状态：**
- 基础功能已对齐（20/26 端点）
- MCP 页面功能严重落后于后端实现
- 缺少监控和调试功能

**关键问题：**
- MCP 页面只是配置编辑器，无法利用新的动态管理功能
- 无法查看 MCP 服务器实时状态
- 缺少性能监控和日志管理界面

**建议优先级：**
1. **立即升级 MCP 页面**（P0）- 利用已实现的动态管理 API
2. 添加 Metrics 和 Logs 页面（P1）
3. 完善其他功能（P2）
