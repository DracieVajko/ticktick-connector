import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('OAuth login exchanges a code and saves the token', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ticktick-oauth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'oauth.json');

  let tokenBody = '';
  const tokenServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      tokenBody = body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'access-123',
          refresh_token: 'refresh-456',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'tasks:read tasks:write',
        }),
      );
    });
  });
  tokenServer.listen(0, '127.0.0.1');
  await once(tokenServer, 'listening');
  t.after(() => tokenServer.close());
  const tokenPort = tokenServer.address().port;

  const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs', 'login'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TICKTICK_OAUTH_AUTHORIZE_URL: 'http://example.test/authorize',
      TICKTICK_OAUTH_TOKEN_URL: `http://127.0.0.1:${tokenPort}/oauth/token`,
      TICKTICK_OAUTH_FILE: tokenFile,
      TICKTICK_NO_BROWSER: '1',
      TICKTICK_REDIRECT_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  let authUrl;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const timeout = setTimeout(() => child.kill(), 10_000);
  t.after(() => clearTimeout(timeout));

  for await (const line of lines) {
    const match = line.match(/https?:\/\/\S+authorize\S*/);
    if (match) {
      authUrl = new URL(match[0]);
      break;
    }
  }
  assert.ok(authUrl, 'login should print the authorization URL');
  const state = authUrl.searchParams.get('state');
  assert.ok(state);
  const redirectUri = authUrl.searchParams.get('redirect_uri');
  assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/, 'login should print its callback URL');

  const callback = await fetch(
    `${redirectUri}?code=test-code&state=${encodeURIComponent(state)}`,
  );
  assert.equal(callback.status, 200);
  const [code] = await once(child, 'exit');
  clearTimeout(timeout);
  assert.equal(code, 0);

  const stored = JSON.parse(await readFile(tokenFile, 'utf8'));
  assert.equal(stored.access_token, 'access-123');
  assert.equal(stored.refresh_token, 'refresh-456');
  assert.ok(stored.expires_at > Date.now());
  assert.match(tokenBody, /grant_type=authorization_code/);
  assert.match(tokenBody, /code=test-code/);
});

test('an expired token is refreshed and saved before the request is sent', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ticktick-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'oauth.json');
  await writeFile(
    tokenFile,
    JSON.stringify({
      access_token: 'stale-token',
      refresh_token: 'refresh-789',
      expires_at: Date.now() - 1000,
    }),
  );

  let refreshBody = '';
  const tokenServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      refreshBody = body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'fresh-token',
          refresh_token: 'refresh-999',
          expires_in: 3600,
          scope: 'tasks:read tasks:write',
        }),
      );
    });
  });
  tokenServer.listen(0, '127.0.0.1');
  await once(tokenServer, 'listening');
  t.after(() => tokenServer.close());

  let authHeader = '';
  const api = createServer((req, res) => {
    authHeader = req.headers.authorization || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ timeZone: 'Europe/London' }));
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => api.close());

  const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs', '--check'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TICKTICK_API_TOKEN: '',
      TICKTICK_TOKEN_FILE: join(dir, 'missing-token'),
      TICKTICK_OAUTH_FILE: tokenFile,
      TICKTICK_OAUTH_TOKEN_URL: `http://127.0.0.1:${tokenServer.address().port}/oauth/token`,
      TICKTICK_API_BASE: `http://127.0.0.1:${api.address().port}/open/v1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `refresh failed: ${stderr}`);
  assert.equal(authHeader, 'Bearer fresh-token');
  assert.match(refreshBody, /grant_type=refresh_token/);
  assert.match(refreshBody, /refresh_token=refresh-789/);

  const stored = JSON.parse(await readFile(tokenFile, 'utf8'));
  assert.equal(stored.access_token, 'fresh-token');
  assert.equal(stored.refresh_token, 'refresh-999');
});

test('a corrupt token file is reported instead of looking unconfigured', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ticktick-broken-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'oauth.json');
  await writeFile(tokenFile, '{ not json');

  const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs', '--check'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TICKTICK_API_TOKEN: '',
      TICKTICK_TOKEN_FILE: join(dir, 'missing-token'),
      TICKTICK_OAUTH_FILE: tokenFile,
      TICKTICK_API_BASE: 'http://127.0.0.1:1/open/v1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(stderr, /not valid JSON/);
});

test('a mismatched OAuth state is rejected and nothing is saved', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ticktick-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'oauth.json');

  const child = spawn(process.execPath, ['bin/ticktick-mcp.mjs', 'login'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TICKTICK_OAUTH_AUTHORIZE_URL: 'http://example.test/authorize',
      TICKTICK_OAUTH_TOKEN_URL: 'http://127.0.0.1:1/oauth/token',
      TICKTICK_OAUTH_FILE: tokenFile,
      TICKTICK_NO_BROWSER: '1',
      TICKTICK_REDIRECT_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let redirectUri = null;
  for await (const line of lines) {
    const match = line.match(/https?:\/\/\S+authorize\S*/);
    if (match) {
      redirectUri = new URL(match[0]).searchParams.get('redirect_uri');
      break;
    }
  }
  assert.ok(redirectUri, 'login printed the authorization URL');

  const callback = await fetch(`${redirectUri}?code=test-code&state=not-the-state`);
  assert.equal(callback.status, 400);

  const [code] = await once(child, 'exit');
  assert.equal(code, 1, 'a state mismatch fails the login');
  await assert.rejects(() => readFile(tokenFile, 'utf8'), /ENOENT/, 'no token is written');
});
