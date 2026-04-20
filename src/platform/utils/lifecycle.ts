import { logger } from '@/platform/observability/logger.js';

interface RunDestroyOptions {
  destroy?: (() => Promise<void>) | null;
  errorContext: Record<string, unknown>;
  errorMessage: string;
  rethrow?: boolean;
}

export async function runDestroy(
  { destroy, errorContext, errorMessage, rethrow = false }: RunDestroyOptions
): Promise<boolean> {
  if (!destroy) {
    return true;
  }

  try {
    await destroy();
    return true;
  } catch (error) {
    logger.error({ ...errorContext, error }, errorMessage);
    if (rethrow) {
      throw error;
    }

    return false;
  }
}
