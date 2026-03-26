export async function runBootstrapPhase<T>(args: {
  phase: string;
  log: {
    info(message: string, fields: Record<string, unknown>): void;
    error(message: string, fields: Record<string, unknown>): void;
  };
  task: () => Promise<T>;
}): Promise<{ result: T; durationMs: number }> {
  args.log.info(`${args.phase} 开始`, {});
  const startedAt = Date.now();
  try {
    const result = await args.task();
    const durationMs = Date.now() - startedAt;
    args.log.info(`${args.phase} 完成`, {
      durationMs
    });

    return { result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    args.log.error(`${args.phase} 失败`, {
      durationMs,
      error: error instanceof Error ? error : new Error(String(error))
    });
    throw error;
  }
}
