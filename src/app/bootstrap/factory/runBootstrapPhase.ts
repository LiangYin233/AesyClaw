export async function runBootstrapPhase<T>(args: {
  phase: string;
  log: {
    info(message: string, fields: Record<string, unknown>): void;
  };
  task: () => Promise<T>;
}): Promise<{ result: T; durationMs: number }> {
  const startedAt = Date.now();
  const result = await args.task();
  const durationMs = Date.now() - startedAt;

  args.log.info('服务阶段完成', {
    phase: args.phase,
    durationMs
  });

  return { result, durationMs };
}
