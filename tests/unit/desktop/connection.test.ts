import { describe, expect, it } from 'vitest';
import {
  normalizeConnectionConfig,
  isValidConnectionHost,
  buildDesktopWsUrl,
  DEFAULT_CONNECTION_CONFIG,
} from '../../../desktop/src/shared/connection';

describe('isValidConnectionHost', () => {
  it('accepts valid hostnames', () => {
    expect(isValidConnectionHost('127.0.0.1')).toBe(true);
    expect(isValidConnectionHost('localhost')).toBe(true);
    expect(isValidConnectionHost('192.168.1.1')).toBe(true);
    expect(isValidConnectionHost('my-host.example.com')).toBe(true);
  });

  it('accepts valid IPv6 addresses in brackets', () => {
    expect(isValidConnectionHost('[::1]')).toBe(true);
    expect(isValidConnectionHost('[2001:db8::1]')).toBe(true);
  });

  it('rejects strings with whitespace', () => {
    expect(isValidConnectionHost(' localhost')).toBe(false);
    expect(isValidConnectionHost('localhost ')).toBe(false);
    expect(isValidConnectionHost('my host')).toBe(false);
  });

  it('rejects strings with scheme or path', () => {
    expect(isValidConnectionHost('http://localhost')).toBe(false);
    expect(isValidConnectionHost('ws://host')).toBe(false);
    expect(isValidConnectionHost('host/path')).toBe(false);
    expect(isValidConnectionHost('host?query=1')).toBe(false);
    expect(isValidConnectionHost('host#frag')).toBe(false);
  });

  it('rejects host with port', () => {
    expect(isValidConnectionHost('host:8080')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isValidConnectionHost('')).toBe(false);
  });
});

describe('normalizeConnectionConfig', () => {
  it('fills missing fields with defaults', () => {
    const result = normalizeConnectionConfig({});
    expect(result).toEqual(DEFAULT_CONNECTION_CONFIG);
  });

  it('normalizes host', () => {
    const result = normalizeConnectionConfig({ host: '  my-host  ' });
    expect(result.host).toBe('my-host');
  });

  it('falls back to default for invalid host in non-strict mode', () => {
    const result = normalizeConnectionConfig({ host: 'http://evil' });
    expect(result.host).toBe(DEFAULT_CONNECTION_CONFIG.host);
  });

  it('throws for invalid host in strict mode', () => {
    expect(() => normalizeConnectionConfig({ host: 'http://evil' }, { strict: true })).toThrow(
      'Host must be a hostname',
    );
  });

  it('normalizes ports', () => {
    const result = normalizeConnectionConfig({ desktopPort: 9731 as unknown as number });
    expect(result.desktopPort).toBe(9731);
  });

  it('falls back to default for invalid port (0)', () => {
    const result = normalizeConnectionConfig({ desktopPort: 0 as unknown as number });
    expect(result.desktopPort).toBe(DEFAULT_CONNECTION_CONFIG.desktopPort);
  });

  it('trims token', () => {
    const result = normalizeConnectionConfig({ token: '  my-token  ' });
    expect(result.token).toBe('my-token');
  });

  it('falls back to default for empty token', () => {
    const result = normalizeConnectionConfig({ token: '' });
    expect(result.token).toBe(DEFAULT_CONNECTION_CONFIG.token);
  });

  it('falls back to default for non-string token', () => {
    const result = normalizeConnectionConfig({ token: null as unknown as string });
    expect(result.token).toBe(DEFAULT_CONNECTION_CONFIG.token);
  });

  it('accepts custom fallback', () => {
    const customFallback = {
      host: '10.0.0.1',
      desktopPort: 9999,
      token: 'custom',
    };
    const result = normalizeConnectionConfig({}, { fallback: customFallback });
    expect(result).toEqual(customFallback);
  });
});

describe('buildDesktopWsUrl', () => {
  it('builds desktop WS URL with token', () => {
    const url = buildDesktopWsUrl(DEFAULT_CONNECTION_CONFIG);
    expect(url).toBe('ws://127.0.0.1:9730/ws?token=desktop-local');
  });

  it('uses custom host and port', () => {
    const url = buildDesktopWsUrl({
      host: '192.168.1.100',
      desktopPort: 9731,
      token: 'secret',
    });
    expect(url).toBe('ws://192.168.1.100:9731/ws?token=secret');
  });
});
