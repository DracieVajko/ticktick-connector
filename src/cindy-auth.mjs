import { TickTickError } from './core.mjs';
import { OAUTH } from './oauth-config.mjs';
import { authorizeUrlFor, callbackRedirectUri, tokenRequestBody } from './oauth-protocol.mjs';

export { parseTokenJson } from './oauth-protocol.mjs';

// The Cindy host keeps only refresh tokens for OAuth-declared credentials and
// keeps access tokens in memory, so an account whose provider issues no refresh
// token (TickTick) is marked expired at every host restart. The plugin therefore
// runs the authorization-code flow itself and stores the resulting access token
// as one of its own credentials, which the host persists and injects per request.
//
// Everything in this module is pure so it can be unit tested without a host.

export const AUTHORIZE_URL = OAUTH.authorizeUrl;
export const TOKEN_URL = OAUTH.cindyTokenUrl;
export const CLIENT_ID = OAUTH.clientId;
export const SCOPES = OAUTH.scopes;
export const REDIRECT_URI = callbackRedirectUri(OAUTH.redirectPort);
export const CHANNEL_NAME = 'ticktick-connector';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 over ASCII input, as 32 bytes. Pure JS so the sandbox needs no crypto.subtle. */
export function sha256Bytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) {
      throw new TickTickError('The PKCE verifier must be ASCII.', { code: 'TICKTICK_OAUTH_CONFIG' });
    }
    bytes.push(code);
  }

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) {
    bytes.push((bitLength / 2 ** shift) % 256 >>> 0);
  }

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = [];
  for (const word of hash) {
    digest.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return digest;
}

function base64urlFromBytes(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : null;
    const third = index + 2 < bytes.length ? bytes[index + 2] : null;
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL_ALPHABET[(triple >>> 18) & 63];
    output += BASE64URL_ALPHABET[(triple >>> 12) & 63];
    if (second === null) break;
    output += BASE64URL_ALPHABET[(triple >>> 6) & 63];
    if (third === null) break;
    output += BASE64URL_ALPHABET[triple & 63];
  }
  return output;
}

export function base64urlSha256(text) {
  return base64urlFromBytes(sha256Bytes(text));
}

/** A random base64url token of `length` bytes of entropy. Predictability would weaken PKCE. */
export function randomToken(length) {
  const source = globalThis.crypto;
  if (!source?.getRandomValues) {
    throw new TickTickError(
      'This Cindy build cannot generate secure random bytes, so TickTick sign-in cannot start. Update Cindy and try again.',
      { code: 'TICKTICK_NO_CRYPTO' },
    );
  }
  const bytes = new Uint8Array(length);
  source.getRandomValues(bytes);
  return base64urlFromBytes(bytes);
}

export function createPkce() {
  const verifier = randomToken(32);
  return { verifier, challenge: base64urlSha256(verifier) };
}

export function buildAuthorizeUrl({ state, challenge }) {
  return authorizeUrlFor({
    state,
    challenge,
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
    authorizeUrl: AUTHORIZE_URL,
    scopes: SCOPES,
  });
}

export function buildTokenRequestBody({ code, verifier }) {
  return tokenRequestBody({
    code,
    verifier,
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
    scopes: SCOPES,
  });
}

function invalidCallback(message) {
  return new TickTickError(message, { code: 'TICKTICK_OAUTH_CALLBACK' });
}

/**
 * Accept what the browser left in the address bar after the refused redirect:
 * the whole callback URL or its query string. A bare code is refused: without
 * the state it cannot be tied to this sign-in, and an unverified code must not
 * be exchanged.
 */
export function parseCallbackInput(input, expectedState) {
  const raw = String(input ?? '').trim();
  if (!raw) throw invalidCallback('Paste the address of the page that failed to load, then try again.');
  if (!expectedState) {
    throw new TickTickError('No sign-in is open, so a callback cannot be checked. Start the sign-in again.', {
      code: 'TICKTICK_OAUTH_STATE',
    });
  }

  let params;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw invalidCallback('That address could not be read. Copy the whole address from the browser.');
    }
    params = url.searchParams;
  } else {
    if (/^[^=&\s]+$/.test(raw)) {
      throw invalidCallback(
        'That is only the code. Copy the whole address from the browser so the sign-in can be checked.',
      );
    }
    params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  }

  const error = params.get('error');
  if (error) {
    throw new TickTickError(
      `TickTick refused the authorization: ${params.get('error_description') || error}`,
      { code: 'TICKTICK_OAUTH_DENIED' },
    );
  }
  const state = params.get('state');
  if (state !== expectedState) {
    throw invalidCallback('This address does not belong to the sign-in that is open. Open the link again.');
  }
  const code = params.get('code');
  if (!code) throw invalidCallback('That address has no TickTick authorization code. Copy it from the browser again.');
  return { code };
}
