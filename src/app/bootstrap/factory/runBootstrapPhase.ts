import type { BootstrapPhaseOptions } from './service-interfaces.js';

export async function runBootstrapPhase<T>(options: BootstrapPhaseOptions<T>): Promise<{ result: T }> {
  const { phase, log, task } = options;
  log.info(`开始: ${phase}`);
  const startTime = Date.now();
  try {
    const result = await task();
    log.info(`完成: ${phase} (${Date.now() - startTime}ms)`);
    return { result };
  } catch (error) {
    log.error(`失败: ${phase}`, { error });
    throw error;
  }
}
