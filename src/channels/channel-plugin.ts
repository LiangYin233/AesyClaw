/** @file 频道插件接口定义
 *
 * 定义频道插件的合约，所有频道插件（channel_* 目录下的模块）
 * 均需实现 ChannelPlugin 接口。频道插件负责连接外部消息平台
 * （如 OneBot/QQ），将收到的消息注入流水线，并将回复发送回平台。
 */

import type { ChannelPipeline } from '@/agent/pipeline.js';
import type { ScopedLogger } from '@/platform/observability/logger.js';

/** 频道消息发送载荷，包含文本与可选的媒体文件列表 */
export interface ChannelSendPayload {
  text: string;
  mediaFiles?: Array<{ type: string; url: string; filename?: string }>;
}

/** 频道插件专属日志器，自动携带频道名称前缀 */
export type ChannelPluginLogger = ScopedLogger;

/** 频道插件初始化时接收的上下文对象 */
export interface ChannelPluginContext<TOptions = Record<string, unknown>> {
  /** 经 defaultOptions 与用户配置合并后的最终配置 */
  config?: TOptions;
  /** 带频道名称前缀的日志器 */
  logger: ChannelPluginLogger;
  /** 消息处理流水线，用于将收到的消息注入系统 */
  pipeline: ChannelPipeline;
}

/** 频道插件接口
 *
 * 运行时按以下生命周期管理频道插件：
 * 1. 扫描 channel_* 目录并加载入口模块
 * 2. 调用 init() 传入上下文，插件在此建立外部连接
 * 3. 运行期间通过 pipeline.receiveWithSend() 注入收到的消息
 * 4. 卸载时调用 destroy() 断开连接并释放资源
 */
export interface ChannelPlugin<TOptions = Record<string, unknown>> {
  /** 频道唯一标识名称（对应配置中的键名） */
  name: string;
  /** 语义化版本号 */
  version: string;
  /** 频道功能描述 */
  description?: string;
  /** 默认配置项，会与用户配置合并后传入 init() 的 config */
  defaultOptions?: TOptions;
  /** 初始化回调，插件在此建立外部连接、注册消息监听 */
  init(_ctx: ChannelPluginContext<TOptions>): Promise<void>;
  /** 销毁回调，插件卸载时调用以断开连接并释放资源 */
  destroy(): Promise<void>;
}
