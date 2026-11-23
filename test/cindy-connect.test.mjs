import test from 'node:test';
import assert from 'node:assert/strict';

import { CHANNEL_NAME, TOKEN_URL } from '../src/cindy-auth.mjs';

// The connection is driven from the settings page, so the plugin background is
// tested through the same channel the page uses.
const sent = [];
const fetches = [];
let fetchPlan = () => ({ ok: true, status: 200, body: '[]', headers: {} });

globalThis.cindy = {
  onHostMessage() {},
  async send(message) {
    sent.push(message);
  },
  async fetch(request) {
    fetches.push(request);
    return fetchPlan(request);
  },
};

await import('../src/cindy-entry.mjs');

const channel = new BroadcastChannel(CHANNEL_NAME);
if (typeof channel.unref === 'function') channel.unref();

function ask(message, expectedType, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${expectedType} within ${timeoutMs} ms`)), timeoutMs);
    const listener = (event) => {
      if (event.data?.type !== expectedType) return;
      clearTimeout(timer);
      channel.removeEventListener('message', listener);
      resolve(event.data);
    };
    channel.addEventListener('message', listener);
    channel.postMessage(message);
  });
}

test('the sign-in link is prepared and the callback is exchanged once', async () => {
  fetches.length = 0;
  fetchPlan = () => ({
    ok: true,
    status: 200,
    body: JSON.stringify({ access_token: 'at-1', expires_in: 15_552_000, scope: 'tasks:read tasks:write' }),
    headers: {},
  });

  const link = await ask({ type: 'tt-auth-start' }, 'tt-auth-url');
  const authorize = new URL(link.url);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const state = authorize.searchParams.get('state');
  assert.ok(state);

  const callback = `http://127.0.0.1:53682/callback?code=the-code&state=${encodeURIComponent(state)}`;
  const token = await ask({ type: 'tt-auth-finish', callbackUrl: callback }, 'tt-auth-token');
  assert.equal(token.token, 'at-1');
  assert.ok(token.expiresAt > Date.now());

  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, TOKEN_URL);
  assert.equal(fetches[0].method, 'POST');
  assert.match(fetches[0].headers['Content-Type'], /application\/x-www-form-urlencoded/);
  const body = new URLSearchParams(fetches[0].body);
  assert.equal(body.get('code'), 'the-code');
  assert.match(body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body.get('grant_type'), 'authorization_code');

  // The verifier is single use, so replaying the same callback must fail.
  const replay = await ask({ type: 'tt-auth-finish', callbackUrl: callback }, 'tt-auth-error');
  assert.match(replay.message, /not active any more/i);
  assert.equal(fetches.length, 1);
});

test('a callback from another sign-in is refused before any token request', async () => {
  fetches.length = 0;
  await ask({ type: 'tt-auth-start' }, 'tt-auth-url');
  const answer = await ask(
    { type: 'tt-auth-finish', callbackUrl: 'http://127.0.0.1:53682/callback?code=x&state=other' },
    'tt-auth-error',
  );
  assert.match(answer.message, /does not belong to the sign-in/i);
  assert.equal(fetches.length, 0);
});

test('a refused authorization reports what TickTick said', async () => {
  fetches.length = 0;
  const link = await ask({ type: 'tt-auth-start' }, 'tt-auth-url');
  const state = new URL(link.url).searchParams.get('state');
  const answer = await ask(
    {
      type: 'tt-auth-finish',
      callbackUrl: `http://127.0.0.1:53682/callback?error=access_denied&error_description=Nope&state=${state}`,
    },
    'tt-auth-error',
  );
  assert.match(answer.message, /Nope/);
  assert.equal(fetches.length, 0);
});

test('a token endpoint failure does not look like a stored connection', async () => {
  fetchPlan = () => ({ ok: false, status: 400, body: '{"error":"invalid_grant"}', headers: {} });
  const link = await ask({ type: 'tt-auth-start' }, 'tt-auth-url');
  const state = new URL(link.url).searchParams.get('state');
  const answer = await ask(
    { type: 'tt-auth-finish', callbackUrl: `http://127.0.0.1:53682/callback?code=c&state=${state}` },
    'tt-auth-error',
  );
  assert.equal(answer.code, 'TICKTICK_OAUTH_EXCHANGE');
  assert.match(answer.message, /HTTP 400/);
});

test('verification proves the host injects the stored token', async () => {
  fetchPlan = () => ({ ok: true, status: 200, body: '[]', headers: {} });
  const ok = await ask({ type: 'tt-verify' }, 'tt-verify-result');
  assert.equal(ok.ok, true);
  assert.match(fetches.at(-1).url, /api\.ticktick\.com\/open\/v1\/project/);

  fetchPlan = () => ({ ok: false, status: 401, body: '', headers: {} });
  const rejected = await ask({ type: 'tt-verify' }, 'tt-verify-result');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /rejected the authorization/i);
});
