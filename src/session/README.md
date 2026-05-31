# Session 模块

会话管理模块，负责聊天会话的生命周期、消息历史与并发控制。

## 目录结构

```
src/session/
├── index.ts                    # 统一导出
├── manager.ts                  # SessionManager - 多会话管理入口
├── core.ts                     # Session - 单会话运行时
├── persistence/                # 持久化层
│   ├── file-store.ts          # JSON 文件读写
│   ├── rehydrate.ts           # 持久化格式 → AgentMessage 恢复
│   └── dto.ts                 # AgentMessage → DTO 转换
└── utils/                      # 工具函数
    ├── compactor.ts           # 会话压缩
    └── token-utils.ts         # token 估算
```

## 核心组件

### SessionManager
- 统一 CRUD 入口
- 会话缓存管理
- 数据库 + 文件系统聚合

### Session
- 单会话运行时
- 消息增删改查
- 并发锁控制
- 自动压缩

### 持久化层
- **file-store**: JSON 文件读写
- **rehydrate**: 从持久化格式恢复为 AgentMessage
- **dto**: 转换为前端 DTO 格式

### 工具层
- **compactor**: 会话历史压缩
- **token-utils**: token 数量估算

## 使用示例

```typescript
import { SessionManager, type SessionSummary } from '@aesyclaw/session';

// 获取所有会话
const summaries: SessionSummary[] = await sessionManager.getSummaries();

// 读取消息历史
const messages = await sessionManager.getMessagesById(sessionId);

// 清空会话历史
await sessionManager.clearById(sessionId);

// 删除会话
await sessionManager.deleteById(sessionId);
```
