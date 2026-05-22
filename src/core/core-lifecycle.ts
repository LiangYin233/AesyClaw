/**
 * @deprecated 已迁移到 src/runtime/lifecycle.ts
 *
 * RuntimeLifecycle 管理所有子系统的启动与关闭顺序。
 * 请从 @aesyclaw/runtime/lifecycle 导入。
 *
 * 此文件将在后续清理阶段完全删除。
 */

export { RuntimeLifecycle as CoreLifecycle, type RuntimeLifecycleDependencies as CoreLifecycleDependencies } from '@aesyclaw/runtime/lifecycle';
