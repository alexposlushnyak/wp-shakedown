import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root, testHome } from './env.ts';
import { makePlugin, tmp } from './helpers.ts';

test('the official client talks to wp-shakedown mcp', { timeout: 60000 }, async (t) => {
  const plugin = makePlugin(path.join(tmp(t), 'p'));
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['src/cli.ts', 'mcp'],
      cwd: root,
      env: { ...(process.env as Record<string, string>), WP_SHAKEDOWN_HOME: testHome },
    }),
  );
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((x) => x.name), ['detect_target', 'list_engines', 'run_checks', 'list_findings', 'list_presets', 'list_runs', 'get_run', 'get_assistant_checks']);
    const text = (r: any): string => r.content[0].text;
    const detect = await client.callTool({ name: 'detect_target', arguments: { path: plugin } });
    assert.match(text(detect), /plugin/);
    const run = await client.callTool({ name: 'run_checks', arguments: { path: plugin, engines: ['wp-json'] } });
    assert.ok(!run.isError, text(run));
    assert.match(text(run), /No findings\./);
    const list = await client.callTool({ name: 'list_findings', arguments: { path: plugin } });
    assert.equal(JSON.parse(text(list)).total, 0);
  } finally {
    await client.close();
  }
});
