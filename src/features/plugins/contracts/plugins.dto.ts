/**
 * 插件请求 DTO 解析
 * 
 * 兼容旧接口的 DTO 解析函数
 */

/**
 * 解析切换插件请求
 */
export function parseTogglePlugin(body: unknown): { enabled: boolean } {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体必须是对象');
  }
  
  const { enabled } = body as Record<string, unknown>;
  
  if (typeof enabled !== 'boolean') {
    throw new Error('enabled 必须是布尔值');
  }
  
  return { enabled };
}

/**
 * 解析插件配置更新请求
 */
export function parsePluginConfigUpdate(body: unknown): { settings: Record<string, unknown> } {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体必须是对象');
  }

  const { options } = body as Record<string, unknown>;

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('options 必须是对象');
  }

  return { settings: options as Record<string, unknown> };
}
