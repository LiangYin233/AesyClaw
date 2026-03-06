import { describe, it, expect } from 'vitest';
import { parseInterval } from '../../src/cron/CronTools';

describe('parseInterval', () => {
  it('should parse seconds', () => {
    expect(parseInterval('10s')).toBe(10_000);
    expect(parseInterval('1s')).toBe(1_000);
    expect(parseInterval('0s')).toBe(0);
  });

  it('should parse minutes', () => {
    expect(parseInterval('5m')).toBe(5 * 60 * 1000);
    expect(parseInterval('1m')).toBe(60_000);
  });

  it('should parse hours', () => {
    expect(parseInterval('2h')).toBe(2 * 60 * 60 * 1000);
    expect(parseInterval('1h')).toBe(3_600_000);
  });

  it('should parse days', () => {
    expect(parseInterval('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parseInterval('3d')).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('should return null for invalid formats', () => {
    expect(parseInterval('abc')).toBeNull();
    expect(parseInterval('10x')).toBeNull();
    expect(parseInterval('')).toBeNull();
    expect(parseInterval('m')).toBeNull();
    expect(parseInterval('10')).toBeNull();
    expect(parseInterval('10ms')).toBeNull();
  });
});
