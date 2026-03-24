export interface RunnerLimitOptions {
  timeout?: number;
  maxOutput?: number;
}

export interface RunnerLimits {
  timeout: number;
  maxOutput: number;
}

export function resolveRunnerLimits(options: RunnerLimitOptions, defaults: RunnerLimits): RunnerLimits {
  return {
    timeout: typeof options.timeout === 'number' ? options.timeout : defaults.timeout,
    maxOutput: typeof options.maxOutput === 'number' ? options.maxOutput : defaults.maxOutput
  };
}

export function truncateRunnerOutput(output: string, maxOutput: number): string {
  if (!output) return '';
  if (output.length <= maxOutput) return output;
  return output.substring(0, maxOutput) + `\n[输出已截断，原始长度: ${output.length} 字符]`;
}
