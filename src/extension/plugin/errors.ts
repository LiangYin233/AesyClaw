export type PluginPermission = 'config.read' | 'config.write';

export type PluginPermissionDeniedErrorOptions = {
  pluginName: string;
  permission: PluginPermission;
  path: string;
};

export class PluginPermissionDeniedError extends Error {
  readonly pluginName: string;
  readonly permission: PluginPermission;
  readonly path: string;

  constructor(options: PluginPermissionDeniedErrorOptions) {
    super(
      `Plugin "${options.pluginName}" does not have ${options.permission} permission for "${options.path}"`,
    );
    this.name = 'PluginPermissionDeniedError';
    this.pluginName = options.pluginName;
    this.permission = options.permission;
    this.path = options.path;
  }
}
