/**
 * Extension 模块
 * 
 * 统一扩展管理，包含：
 * - Channel: 渠道适配器
 * - Plugin: 功能插件
 * 
 * 在 features 内部，channel 和 plugin 两套逻辑统一通过 extension 模块管理
 */

export * from './channel/index.js';
export * from './plugin/index.js';
