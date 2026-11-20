import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeRpc(child) {
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const queue = [];
  const waiters = [];

  lines.on('line', (line) => {
    if (!line.trim()) return;
    const value = JSON.parse(line);
    if (waiters.length) waiters.shift()(value);
    else queue.push(value);
  });

  return (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for MCP response')), 5000);
      waiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  };
}

test('MCP server initializes, lists tools and calls TickTick', async (t) => {
  let authHeader = '';
  const api = createServer((req, res) => {
    authHeader = req.headers.authorization || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 'p1', name: 'Work', kind: 'TASK' }]));
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => api.close());

  const { port } = api.address();
  const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TICKTICK_API_TOKEN: 'test-token',
      TICKTICK_API_BASE: `http://127.0.0.1:${port}/open/v1`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  const rpc = makeRpc(child);

  const initialized = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'node-test', version: '1.0.0' },
    },
  });
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.equal(initialized.result.serverInfo.name, 'ticktick-connector');

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );

  const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('list_projects'));
  assert.ok(names.includes('create_task'));
  assert.ok(names.includes('delete_project'));
  assert.ok(listed.result.tools.every((tool) => tool.inputSchema.type === 'object'));
  assert.ok(names.length >= 16, `expected at least 16 tools, got ${names.length}`);

  const called = await rpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_projects', arguments: {} },
  });
  assert.equal(called.result.isError, false);
  const payload = JSON.parse(called.result.content[0].text);
  assert.equal(payload.count, 2);
  assert.equal(payload.projects[0].id, 'inbox');
  assert.equal(payload.projects[1].name, 'Work');
  assert.equal(authHeader, 'Bearer test-token');
});

test('MCP protocol negotiation and error branches answer instead of hanging', async (t) => {
  const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TICKTICK_API_TOKEN: 'test-token',
      TICKTICK_API_BASE: 'http://127.0.0.1:1/open/v1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const rpc = makeRpc(child);

  const unknownVersion = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  });
  assert.equal(unknownVersion.result.protocolVersion, '2025-06-18');

  const invalid = await rpc({ jsonrpc: '2.0', id: 2, method: 'nope' });
  assert.equal(invalid.error.code, -32601);

  const badLine = await rpc({ jsonrpc: '1.0', id: 3, method: 'ping' });
  assert.equal(badLine.error.code, -32600);

  const rejected = await rpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'create_task', arguments: { projectId: 'p1', title: 'X', dueDAte: '2026-05-01' } },
  });
  assert.equal(rejected.result.isError, true);
  assert.match(rejected.result.content[0].text, /unknown key dueDAte/);

  const notFound = await rpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'no_such_tool', arguments: {} },
  });
  assert.equal(notFound.result.isError, true);
  assert.match(notFound.result.content[0].text, /Unknown TickTick tool/);
});

test('logout reports whether a token file was actually removed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ticktick-logout-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'oauth.json');
  await writeFile(tokenFile, '{"access_token":"a"}\n');

  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs', ...args], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, TICKTICK_OAUTH_FILE: tokenFile, TICKTICK_API_TOKEN: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
      });
      child.on('exit', (code) => resolve({ code, out }));
    });

  const first = await run(['logout']);
  assert.equal(first.code, 0);
  assert.match(first.out, /removed/);

  const second = await run(['logout']);
  assert.equal(second.code, 0);
  assert.match(second.out, /No saved TickTick OAuth token/);
});
