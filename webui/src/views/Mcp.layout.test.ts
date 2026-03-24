import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('MCP page reserves viewport height for split layout', () => {
  const source = readFileSync(new URL('./Mcp.vue', import.meta.url), 'utf8');

  assert.match(source, /min-h-\[calc\(100vh-8rem\)\]/);
});
