export class BoundaryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RequestValidationError extends BoundaryError {
  constructor(message: string, public readonly field?: string, details?: unknown) {
    super(message, 'REQUEST_VALIDATION_ERROR', details);
  }
}
