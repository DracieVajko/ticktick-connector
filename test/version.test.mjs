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

test('the shipped client id and scopes come from the manifest', () => {
  const secret = manifest.network.secrets[0];
  assert.equal(secret.key, 'ticktick_account');
  assert.ok(secret.oauth.clientId);
  assert.deepEqual(secret.oauth.scopes, ['tasks:read', 'tasks:write']);
  assert.equal(secret.oauth.redirectPort, 53682);
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
