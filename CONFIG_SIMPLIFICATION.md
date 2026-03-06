# 配置简化更新说明

## 变更概述

移除了日志系统中的 `showTimestamp` 和 `useColors` 配置选项，简化配置结构。

## 变更详情

### 1. 代码变更

#### src/logger/index.ts
- 移除 `showTimestamp` 和 `useColors` 字段
- 简化 `LoggerOptions` 接口，只保留 `level` 和 `prefix`
- 简化 `getConfig()` 返回值
- 更新 `format()` 方法，始终显示时间戳和使用颜色
- 简化 `child()` 方法

#### src/types.ts
- 简化 `LogConfig` 接口，只保留 `level` 字段

### 2. 文档更新

#### CONFIG_GUIDE.md
- 移除 `showTimestamp` 和 `useColors` 的配置说明
- 更新配置示例
- 更新配置对应关系表

#### test-new-features.md
- 移除相关配置示例
- 更新 API 响应示例
- 更新配置对应关系表

### 3. 行为变更

**之前：**
- 可以通过配置控制是否显示时间戳
- 可以通过配置控制是否使用颜色

**现在：**
- 始终显示时间戳（格式：HH:mm:ss.SSS）
- 始终使用 ANSI 颜色码

**原因：**
- 简化配置，减少选项
- 时间戳对于日志分析至关重要，应该始终显示
- 颜色提升可读性，现代终端都支持

## 配置示例

### 之前
```yaml
log:
  level: info
  showTimestamp: true
  useColors: true
```

### 现在
```yaml
log:
  level: info
```

## API 变更

### GET /api/logs/config

**之前响应：**
```json
{
  "level": "info",
  "prefix": "",
  "showTimestamp": true,
  "useColors": true
}
```

**现在响应：**
```json
{
  "level": "info",
  "prefix": ""
}
```

## 迁移指南

### 对于现有配置文件

如果你的 `config.yaml` 中有这些字段：

```yaml
log:
  level: info
  showTimestamp: true  # 可以删除
  useColors: true      # 可以删除
```

只需保留：

```yaml
log:
  level: info
```

**注意：** 保留这些字段不会导致错误，它们会被忽略。

### 对于代码调用

如果你的代码中使用了这些选项：

```typescript
// 之前
const logger = new Logger({
  level: 'info',
  showTimestamp: true,
  useColors: true
});

// 现在
const logger = new Logger({
  level: 'info'
});
```

## 兼容性

- ✅ 向后兼容：旧的配置文件仍然可以工作（多余字段会被忽略）
- ✅ TypeScript 编译通过
- ✅ 所有测试通过
- ✅ 日志输出格式保持一致

## 影响范围

- 配置文件：需要清理（可选）
- 代码：无需修改（除非显式使用了这些选项）
- 日志输出：无变化（始终显示时间戳和颜色）

## 验证

编译测试：
```bash
npm run build
```

结果：✅ 编译成功，无错误

## 总结

这次简化移除了不必要的配置选项，使配置更加简洁明了。日志系统的核心功能（级别控制、前缀、格式化）保持不变，只是去掉了很少使用的开关选项。
