import {
    DEFAULT_CONFIG,
    validateConfig,
    type ChannelsConfig,
    type FullConfig,
    type MCPServerConfig,
    type ProvidersConfig,
} from './schema.js';

interface ParsedConfig {
    providers?: Record<string, unknown>;
    mcp?: { servers?: unknown[] };
    channels?: Record<string, unknown>;
    [key: string]: unknown;
}

interface ExampleDefaultsStatus {
    hasProviders: boolean;
    hasMCPServers: boolean;
    hasChannels: boolean;
}

export interface ConfigParseResult {
    config: FullConfig | null;
    shouldWriteBack: boolean;
}

interface ConfigParserOptions {
    onValidationFailure: (errors: Array<{ path: string; message: string }>) => void;
    onParseError: (error: unknown) => void;
    onPartialMergeFailure: () => void;
    logNoProviders: () => void;
    logNoMcpServers: () => void;
    logNoChannels: (mergedWithDefaults: boolean) => void;
    logMergedDefaults: () => void;
}

function hasObjectEntries(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0
    );
}

function hasArrayEntries(value: unknown): value is unknown[] {
    return Array.isArray(value) && value.length > 0;
}

function getExampleProviderConfig(): ProvidersConfig {
    return {
        openai: {
            type: 'openai_responses',
            api_key: 'your-api-key',
            base_url: 'https://api.openai.com/v1',
            models: {
                default: {
                    modelname: 'gpt-4o',
                    contextWindow: 128000,
                    reasoning: false,
                },
            },
        },
    };
}

function getExampleMcpServers(): MCPServerConfig[] {
    return [
        {
            name: 'example',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', './skills'],
            enabled: false,
        },
    ];
}

function getExampleDefaultsStatus(parsed: ParsedConfig): ExampleDefaultsStatus {
    return {
        hasProviders: hasObjectEntries(parsed.providers),
        hasMCPServers: hasArrayEntries(parsed.mcp?.servers),
        hasChannels: parsed.channels !== undefined,
    };
}

function mergeMissingSections(
    parsed: ParsedConfig,
    defaultsStatus: ExampleDefaultsStatus,
): FullConfig {
    return {
        ...DEFAULT_CONFIG,
        ...(parsed as Record<string, unknown>),
        providers: defaultsStatus.hasProviders
            ? (parsed.providers as ProvidersConfig)
            : getExampleProviderConfig(),
        mcp: {
            servers: defaultsStatus.hasMCPServers
                ? (parsed.mcp?.servers as MCPServerConfig[])
                : getExampleMcpServers(),
        },
        channels: defaultsStatus.hasChannels ? (parsed.channels as ChannelsConfig) : {},
    } as FullConfig;
}

function finalizeParsedConfig(
    config: FullConfig,
    defaultsStatus: ExampleDefaultsStatus,
    options: ConfigParserOptions,
    mergedWithDefaults = false,
): ConfigParseResult {
    let shouldWriteBack = mergedWithDefaults;

    if (!defaultsStatus.hasProviders) {
        config.providers = getExampleProviderConfig();
        shouldWriteBack = true;
        options.logNoProviders();
    }

    if (!defaultsStatus.hasMCPServers) {
        config.mcp = { servers: getExampleMcpServers() };
        shouldWriteBack = true;
        options.logNoMcpServers();
    }

    if (!defaultsStatus.hasChannels) {
        config.channels = {};
        shouldWriteBack = true;
        options.logNoChannels(mergedWithDefaults);
    }

    if (
        mergedWithDefaults &&
        (defaultsStatus.hasProviders || defaultsStatus.hasMCPServers || defaultsStatus.hasChannels)
    ) {
        options.logMergedDefaults();
    }

    return { config, shouldWriteBack };
}

export function parseConfigFromRaw(raw: unknown, options: ConfigParserOptions): ConfigParseResult {
    try {
        const parsed = raw as ParsedConfig;
        const result = validateConfig(parsed);

        if (result.success) {
            return finalizeParsedConfig(result.data, getExampleDefaultsStatus(parsed), options);
        }

        options.onValidationFailure(result.errors);

        const defaultsStatus = getExampleDefaultsStatus(parsed);
        const mergedResult = validateConfig(mergeMissingSections(parsed, defaultsStatus));
        if (mergedResult.success) {
            return finalizeParsedConfig(mergedResult.data, defaultsStatus, options, true);
        }

        options.onPartialMergeFailure();
        return { config: null, shouldWriteBack: false };
    } catch (error) {
        options.onParseError(error);
        return { config: null, shouldWriteBack: false };
    }
}
