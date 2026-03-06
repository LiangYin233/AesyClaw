import { describe, it, expect } from 'vitest';
import {
  normalizeError,
  createErrorResponse,
  createValidationErrorResponse,
  AppError,
  ValidationError,
  NotFoundError
} from '../../src/utils/errors';

describe('normalizeError', () => {
  it('should extract message from Error instance', () => {
    expect(normalizeError(new Error('test error'))).toBe('test error');
  });

  it('should return string as-is', () => {
    expect(normalizeError('plain string')).toBe('plain string');
  });

  it('should extract message from object with message property', () => {
    expect(normalizeError({ message: 'object error' })).toBe('object error');
  });

  it('should stringify other types', () => {
    expect(normalizeError(42)).toBe('42');
    expect(normalizeError(null)).toBe('null');
    expect(normalizeError(undefined)).toBe('undefined');
    expect(normalizeError(true)).toBe('true');
  });
});

describe('createErrorResponse', () => {
  it('should wrap Error into { error: string }', () => {
    expect(createErrorResponse(new Error('fail'))).toEqual({ error: 'fail' });
  });

  it('should wrap string into { error: string }', () => {
    expect(createErrorResponse('fail')).toEqual({ error: 'fail' });
  });
});

describe('createValidationErrorResponse', () => {
  it('should return response without field', () => {
    expect(createValidationErrorResponse('bad input')).toEqual({
      success: false,
      error: 'bad input'
    });
  });

  it('should include field when provided', () => {
    expect(createValidationErrorResponse('required', 'name')).toEqual({
      success: false,
      error: 'required',
      field: 'name'
    });
  });
});

describe('AppError', () => {
  it('should set message, code, statusCode', () => {
    const err = new AppError('bad', 'BAD_REQUEST', 400);
    expect(err.message).toBe('bad');
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('should default statusCode to 500', () => {
    const err = new AppError('internal', 'INTERNAL');
    expect(err.statusCode).toBe(500);
  });

  it('should include details in toJSON when present', () => {
    const err = new AppError('fail', 'FAIL', 500, { extra: 'info' });
    expect(err.toJSON()).toEqual({
      error: 'fail',
      code: 'FAIL',
      statusCode: 500,
      details: { extra: 'info' }
    });
  });

  it('should omit details from toJSON when absent', () => {
    const err = new AppError('fail', 'FAIL', 500);
    const json = err.toJSON();
    expect(json).toEqual({ error: 'fail', code: 'FAIL', statusCode: 500 });
    expect('details' in json).toBe(false);
  });
});

describe('ValidationError', () => {
  it('should have statusCode 400 and code VALIDATION_ERROR', () => {
    const err = new ValidationError('invalid email');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
    expect(err).toBeInstanceOf(AppError);
  });

  it('should include details when provided', () => {
    const err = new ValidationError('fail', { fields: ['a'] });
    expect(err.details).toEqual({ fields: ['a'] });
  });
});

describe('NotFoundError', () => {
  it('should format message with resource and id', () => {
    const err = new NotFoundError('User', '123');
    expect(err.message).toBe('User with id "123" not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.name).toBe('NotFoundError');
  });

  it('should format message without id', () => {
    const err = new NotFoundError('Session');
    expect(err.message).toBe('Session not found');
  });
});
