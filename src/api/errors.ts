export class ApiNotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id?: string
  ) {
    super(id ? `${resource} with id "${id}" not found` : `${resource} not found`);
    this.name = 'ApiNotFoundError';
  }
}

export function normalizeApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

export function createErrorResponse(error: unknown): { error: string } {
  return { error: normalizeApiError(error) };
}

export function createValidationErrorResponse(
  message: string,
  field?: string
): { success: false; error: string; field?: string } {
  return {
    success: false,
    error: message,
    ...(field ? { field } : {})
  };
}

export function createNotFoundErrorResponse(resource: string, id?: string): { error: string } {
  return createErrorResponse(new ApiNotFoundError(resource, id));
}
