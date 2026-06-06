import { describe, expect, it } from 'vitest';
import { createWebuiAuthManager } from '../../../extensions/plugin_webui/auth';
import { createApp } from '../../../extensions/plugin_webui/server';

function makeApp(authToken = 'secret-token') {
  const auth = createWebuiAuthManager(() => authToken);
  return createApp({ webDistDir: '/missing-web-dist', auth });
}

describe('plugin_webui server auth', () => {
  it('creates an HttpOnly session cookie for the configured auth token', async () => {
    const app = makeApp();

    const response = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'secret-token' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('aesyclaw_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('accepts a valid session cookie on auth check', async () => {
    const app = makeApp();
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'secret-token' }),
    });
    const cookie = login.headers.get('set-cookie') ?? '';

    const response = await app.request('/api/auth/check', {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects stale or invalid sessions after token rotation', async () => {
    let currentToken = 'old-token';
    const auth = createWebuiAuthManager(() => currentToken);
    const app = createApp({ webDistDir: '/missing-web-dist', auth });
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'old-token' }),
    });
    const cookie = login.headers.get('set-cookie') ?? '';

    currentToken = 'new-token';
    const response = await app.request('/api/auth/check', {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' });
  });

  it('handles malformed cookie values as unauthorized instead of throwing', async () => {
    const app = makeApp();

    const response = await app.request('/api/auth/check', {
      headers: { Cookie: 'aesyclaw_session=%E0%A4%A' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' });
  });

  it('does not rate limit missing-cookie checks for fresh visitors', async () => {
    const app = makeApp();
    let response = new Response();

    for (let i = 0; i < 11; i++) {
      response = await app.request('/api/auth/check', {
        headers: { 'X-Real-IP': '203.0.113.20' },
      });
    }

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' });
  });

  it('rate limits repeated invalid login attempts', async () => {
    const app = makeApp();
    let response = new Response();

    for (let i = 0; i < 11; i++) {
      response = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Real-IP': '203.0.113.10',
        },
        body: JSON.stringify({ token: 'wrong-token' }),
      });
    }

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Too many authentication failures',
    });
  });
});
