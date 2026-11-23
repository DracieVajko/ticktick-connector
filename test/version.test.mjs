import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manifest } from '../src/manifest.mjs';
import { manifestTools } from '../src/tools.mjs';
import { VERSION } from '../src/version.mjs';

const root = new URL('..', import.meta.url);

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8'));
}

test('the version is declared once and copied everywhere', () => {
  const pkg = readJson('package.json');
  const ghost = readJson('cindy-plugin/ghost.json');
  assert.equal(manifest.version, VERSION);
  assert.equal(pkg.version, VERSION);
  assert.equal(ghost.version, VERSION);
});

test('the shipped credential injects the TickTick bearer token', () => {
  const secret = manifest.network.secrets[0];
  assert.equal(secret.key, 'ticktick_token');
  assert.equal(secret.source, 'user');
  assert.equal(secret.inject.header, 'Authorization');
  assert.equal(secret.inject.format, 'Bearer {value}');
  assert.deepEqual(secret.inject.hosts, ['api.ticktick.com']);
  // The plugin runs its own sign-in, so no host-managed OAuth account survives
  // a restart and none is declared here.
  assert.equal(secret.oauth, undefined);
  assert.deepEqual(manifest.setup.requires, []);
});

test('the plugin sign-in only touches hosts the manifest declares', async () => {
  const { AUTHORIZE_URL, TOKEN_URL, REDIRECT_URI, SCOPES } = await import('../src/cindy-auth.mjs');
  for (const endpoint of [AUTHORIZE_URL, TOKEN_URL]) {
    assert.ok(
      manifest.network.hosts.includes(new URL(endpoint).hostname),
      `${endpoint} is not covered by network.hosts`,
    );
  }
  assert.deepEqual(SCOPES, ['tasks:read', 'tasks:write']);
  // The code exchange happens before any credential exists, so it must not go
  // to a host the host injects into.
  const injected = manifest.network.secrets.flatMap((secret) => secret.inject.hosts ?? []);
  assert.ok(!injected.includes(new URL(TOKEN_URL).hostname), 'the token exchange used an injected host');
  const redirect = new URL(REDIRECT_URI);
  assert.equal(redirect.hostname, '127.0.0.1');
  assert.equal(redirect.port, '53682');
  assert.equal(redirect.pathname, '/callback');
});

test('ghost.json ships exactly the tool surface the code defines', () => {
  const ghost = readJson('cindy-plugin/ghost.json');
  const expected = manifestTools();
  assert.equal(ghost.tools.length, expected.length);
  assert.deepEqual(
    ghost.tools.map((tool) => tool.name),
    expected.map((tool) => tool.name),
  );
  assert.ok(ghost.tools.every((tool) => tool.annotations));
});

test('the built settings page carries the manifest secret key', () => {
  const built = readFileSync(new URL('cindy-plugin/settings.js', root), 'utf8');
  const key = manifest.network.secrets[0].key;
  assert.match(built, new RegExp(`const KEY = '${key}';`));
  assert.doesNotMatch(built, /__TICKTICK_SECRET_KEY__/);
});
