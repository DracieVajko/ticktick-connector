import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORIZE_URL,
  CLIENT_ID,
  REDIRECT_URI,
  SCOPES,
  base64urlSha256,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  createPkce,
  parseCallbackInput,
  parseTokenJson,
} from '../src/cindy-auth.mjs';

test('SHA-256 matches the published vectors', () => {
  assert.equal(base64urlSha256('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  assert.equal(base64urlSha256(''), '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
});

test('the PKCE challenge matches the RFC 7636 example', () => {
  // RFC 7636 appendix B.
  assert.equal(
    base64urlSha256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('a generated verifier is url-safe and 43 characters long', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, challenge);
  assert.notEqual(createPkce().verifier, verifier);
});

test('the authorize URL carries PKCE and the fixed redirect', () => {
  const url = new URL(buildAuthorizeUrl({ state: 'state-1', challenge: 'challenge-1' }));
  assert.equal(`${url.origin}${url.pathname}`, AUTHORIZE_URL);
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('scope'), SCOPES.join(' '));
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('the callback parser accepts the whole URL or its query', () => {
  const expected = 'state-9';
  const full = `http://127.0.0.1:53682/callback?code=abc123&state=${expected}`;
  assert.deepEqual(parseCallbackInput(full, expected), { code: 'abc123' });
  assert.deepEqual(parseCallbackInput(`?code=abc123&state=${expected}`, expected), { code: 'abc123' });
  assert.deepEqual(parseCallbackInput(`code=abc123&state=${expected}`, expected), { code: 'abc123' });
});

test('a shape that cannot carry the state is refused before any exchange', () => {
  // Without the state the code cannot be tied to this sign-in.
  assert.throws(() => parseCallbackInput('abc123', 'state-9'), /only the code/i);
  assert.throws(() => parseCallbackInput('abc123', ''), /No sign-in is open/i);
});

test('the callback parser refuses another sign-in, a refusal and junk', () => {
  assert.throws(
    () => parseCallbackInput('http://127.0.0.1:53682/callback?code=abc&state=other', 'state-9'),
    /does not belong to the sign-in/i,
  );
  assert.throws(
    () =>
      parseCallbackInput(
        'http://127.0.0.1:53682/callback?error=access_denied&error_description=User%20said%20no',
        'state-9',
      ),
    /User said no/,
  );
  assert.throws(() => parseCallbackInput('   ', 'state-9'), /Paste the address/i);
  assert.throws(
    () => parseCallbackInput('http://127.0.0.1:53682/callback?state=state-9', 'state-9'),
    /no TickTick authorization code/i,
  );
});

test('the token request is form encoded and repeats the redirect', () => {
  const body = new URLSearchParams(buildTokenRequestBody({ code: 'c1', verifier: 'v1' }));
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'c1');
  assert.equal(body.get('code_verifier'), 'v1');
  assert.equal(body.get('client_id'), CLIENT_ID);
  assert.equal(body.get('scope'), SCOPES.join(' '));
  assert.equal(body.get('redirect_uri'), REDIRECT_URI);
});

test('the token response yields a token and an expiry', () => {
  const before = Date.now();
  const token = parseTokenJson(
    JSON.stringify({
      access_token: 'at-1',
      token_type: 'Bearer',
      expires_in: 15_552_000,
      scope: 'tasks:read tasks:write',
    }),
  );
  assert.equal(token.accessToken, 'at-1');
  assert.equal(token.scope, 'tasks:read tasks:write');
  assert.ok(token.expiresAt >= before + 15_552_000 * 1000);
});

test('a token response without a token or without JSON is refused', () => {
  assert.throws(() => parseTokenJson('{"error":"invalid_grant"}', 400), /access token/i);
  assert.throws(() => parseTokenJson('<html>', 502), /non-JSON/i);
});

test('an unknown expiry is reported as unknown, not as zero', () => {
  assert.equal(parseTokenJson(JSON.stringify({ access_token: 'at-2' })).expiresAt, null);
});
