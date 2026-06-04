import { ErrorCode, ExtensionError } from '@aesyclaw/core/errors';

export type PluginPermission = 'config.read' | 'config.write';

export type PluginPermissionDeniedErrorOptions = {
  pluginName: string;
  permission: PluginPermission;
  path: string;
};

export class PluginPermissionDeniedError extends ExtensionError {
  readonly pluginName: string;
  readonly permission: PluginPermission;
  readonly path: string;

  constructor(options: PluginPermissionDeniedErrorOptions) {
    super(
      ErrorCode.EXTENSION_PERMISSION_DENIED,
      `Plugin "${options.pluginName}" does not have ${options.permission} permission for "${options.path}"`,
      {
        extensionKind: 'plugin',
        extensionName: options.pluginName,
        pluginName: options.pluginName,
        permission: options.permission,
        path: options.path,
      },
    );
    this.name = 'PluginPermissionDeniedError';
    this.pluginName = options.pluginName;
    this.permission = options.permission;
    this.path = options.path;
  }
}
