export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DomainValidationError extends DomainError {
  constructor(message: string, public readonly field?: string, details?: unknown) {
    super(message, 'DOMAIN_VALIDATION_ERROR', details);
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(public readonly resource: string, public readonly id?: string) {
    super(id ? `${resource} with id "${id}" not found` : `${resource} not found`, 'RESOURCE_NOT_FOUND');
  }
}

export class DomainConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'DOMAIN_CONFLICT', details);
  }
}

export class DependencyUnavailableError extends DomainError {
  constructor(message: string = 'Dependency unavailable', details?: unknown) {
    super(message, 'DEPENDENCY_UNAVAILABLE', details);
  }
}
