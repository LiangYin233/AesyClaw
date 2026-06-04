/**
 * Extension 错误测试
 */

import { describe, expect, it } from 'vitest';
import { ErrorCode, ExtensionError } from '@aesyclaw/core/errors';
import { PluginPermissionDeniedError } from '@aesyclaw/extension/plugin/errors';

describe('ExtensionError', () => {
  it('应该创建扩展未找到错误', () => {
    const error = ExtensionError.notFound('plugin', 'alpha');

    expect(error).toBeInstanceOf(ExtensionError);
    expect(error.code).toBe(ErrorCode.EXTENSION_NOT_FOUND);
    expect(error.message).toContain('alpha');
    expect(error.extensionKind).toBe('plugin');
    expect(error.extensionName).toBe('alpha');
  });

  it('应该创建扩展权限拒绝错误', () => {
    const error = ExtensionError.permissionDenied(
      'plugin',
      'alpha',
      'config.read',
      'agent.defaultModel',
    );

    expect(error.code).toBe(ErrorCode.EXTENSION_PERMISSION_DENIED);
    expect(error.extensionKind).toBe('plugin');
    expect(error.extensionName).toBe('alpha');
    expect(error.permission).toBe('config.read');
    expect(error.path).toBe('agent.defaultModel');
  });

  it('应该让插件权限错误接入统一错误基类', () => {
    const error = new PluginPermissionDeniedError({
      pluginName: 'alpha',
      permission: 'config.write',
      path: 'plugins.beta.enabled',
    });

    expect(error).toBeInstanceOf(ExtensionError);
    expect(error.code).toBe(ErrorCode.EXTENSION_PERMISSION_DENIED);
    expect(error.name).toBe('PluginPermissionDeniedError');
    expect(error.pluginName).toBe('alpha');
    expect(error.extensionName).toBe('alpha');
    expect(error.permission).toBe('config.write');
    expect(error.path).toBe('plugins.beta.enabled');
    expect(error.details).toMatchObject({
      extensionKind: 'plugin',
      extensionName: 'alpha',
      pluginName: 'alpha',
      permission: 'config.write',
      path: 'plugins.beta.enabled',
    });
  });
});
