/**
 * Custom error classes for AesyClaw.
 *
 * Startup failures cascade to shutdown; runtime failures are contained and logged.
 * See error-handling.md for the full strategy.
 */

/** Base application error — all AesyClaw errors extend this */
class AesyClawError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AesyClawError';
    this.code = code;
  }
}

/** Configuration validation error — thrown during config load/reload */
class ConfigValidationError extends AesyClawError {
  public readonly details: unknown;

  constructor(message: string, details: unknown) {
    super(message, 'CONFIG_VALIDATION_ERROR');
    this.name = 'ConfigValidationError';
    this.details = details;
  }
}

/** Plugin initialization error — should be caught and skipped */
class PluginInitError extends AesyClawError {
  constructor(pluginName: string, cause: Error) {
    super(`Plugin "${pluginName}" failed to initialize: ${cause.message}`, 'PLUGIN_INIT_ERROR');
    this.name = 'PluginInitError';
  }
}

/** Channel initialization error — should be caught and skipped */
class ChannelInitError extends AesyClawError {
  constructor(channelName: string, cause: Error) {
    super(`Channel "${channelName}" failed to initialize: ${cause.message}`, 'CHANNEL_INIT_ERROR');
    this.name = 'ChannelInitError';
  }
}

/** MCP server connection error — should be caught and skipped */
class McpConnectionError extends AesyClawError {
  constructor(serverName: string, cause: Error) {
    super(`MCP server "${serverName}" connection failed: ${cause.message}`, 'MCP_CONNECTION_ERROR');
    this.name = 'McpConnectionError';
  }
}

export {
  AesyClawError,
  ConfigValidationError,
  PluginInitError,
  ChannelInitError,
  McpConnectionError,
};
