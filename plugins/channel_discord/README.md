# Discord Channel Plugin for AesyClaw

Discord 通道插件，支持通过 Discord Bot 接收和发送消息。

## 功能特性

- 接收 Discord 消息（支持私聊和群聊）
- 支持文本、图片、文件、音频、视频等多种消息类型
- 支持提及(@)和引用回复
- 自动将插件指令注册为 Discord 斜杠命令
- 支持频道访问控制

## 快速开始

### 1. 配置 Discord Bot

在 `config.toml` 中添加：

```toml
[channel.discord]
botToken = "your-discord-bot-token"
autoRegisterSlashCommands = true
friendAllowFrom = []  # 允许私聊的用户ID列表，为空表示允许所有
groupAllowFrom = []   # 允许群聊的频道ID列表，为空表示允许所有
```

### 2. 创建 Discord Bot

1. 访问 [Discord Developer Portal](https://discord.com/developers/applications)
2. 点击 "New Application" 创建新应用
3. 进入 Bot 页面：
   - 点击 "Reset Token" 获取 Bot Token
   - 关闭 "Public Bot"（可选）
   - **必须启用** "Message Content Intent"（在 Privileged Gateway Intents 中）
4. 进入 OAuth2 -> URL Generator：
   - 勾选 `bot` 和 `applications.commands`
   - Bot Permissions 选择：Send Messages, Read Messages/View Channels, Attach Files, Read Message History
   - 复制生成的 URL，在浏览器中打开并邀请 Bot 加入你的服务器

### 3. 启动 AesyClaw

```bash
npm install  # 安装 discord.js 依赖
npm run start:all
```

## 配置项说明

### 配置说明

- **botToken** (必需): Discord Bot Token
  - 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用
  - 在 Bot 页面获取 Token
  - 启用以下权限：Send Messages, Read Messages/View Channels, Attach Files, Read Message History

- **autoRegisterSlashCommands** (可选，默认 false): 
  - 是否自动将 AesyClaw 插件中的指令注册为 Discord 斜杠命令
  - 启用后，用户可以使用 `/commandname` 格式触发插件指令
  - 插件指令的名称会被自动转换为 Discord 兼容格式（小写、连字符替换特殊字符）

- **friendAllowFrom** (可选): 
  - 允许私聊的用户ID列表
  - 如果为空数组，则允许所有用户私聊
  - 如果需要限制，填入 Discord 用户ID（例如：["123456789", "987654321"]）

- **groupAllowFrom** (可选):
  - 允许群聊的频道ID列表
  - 如果为空数组，则允许所有频道
  - 如果需要限制，填入 Discord 频道ID

## Discord Bot 设置

1. 访问 [Discord Developer Portal](https://discord.com/developers/applications)
2. 创建新应用
3. 在 Bot 页面：
   - 点击 "Reset Token" 获取 Bot Token
   - 关闭 "Public Bot"（如果需要）
   - 启用 "Message Content Intent"
4. 在 OAuth2 -> URL Generator 页面：
   - 勾选 `bot` 和 `applications.commands` 权限
   - 选择所需的 Bot 权限（建议至少包含 Send Messages, Read Messages）
   - 复制生成的 URL，在浏览器中打开并邀请 Bot 加入服务器

## 内置斜杠命令

当 `autoRegisterSlashCommands` 启用时，会自动注册以下基础命令：

- `/ping` - 检查 Bot 是否在线
- `/help` - 显示帮助信息
- 所有已启用插件的命令（例如 `/web_search`, `/transcribe_audio` 等）

## 技术实现

基于 Discord.js v14 实现，使用：
- Gateway Intent: Guilds, GuildMessages, DirectMessages, MessageContent, GuildMembers
- Partials: Channel, Message（支持DM消息）
- REST API v10 用于注册斜杠命令

## 依赖

- discord.js: ^14.18.0
- discord-api-types: ^0.37.83
