import { OAUTH } from './oauth-config.mjs';
import { TickTickError } from './core.mjs';

// The TickTick OAuth handshake is one protocol with two callers: the standalone
// MCP login (node:crypto + a localhost listener) and the Cindy plugin sandbox
// (WebCrypto-free PKCE + a pasted callback). Everything that does not depend on
// the runtime lives here so a scope, URL or parsing fix lands once.

export function callbackRedirectUri(port = OAUTH.redirectPort) {
  return `http://127.0.0.1:${port}/callback`;
}

export function authorizeUrlFor({ state, challenge, redirectUri, clientId, authorizeUrl, scopes }) {
  const url = new URL(authorizeUrl || OAUTH.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: clientId || OAUTH.clientId,
    scope: (scopes || OAUTH.scopes).join(' '),
    state,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export function tokenRequestBody({ code, verifier, redirectUri, clientId, scopes }) {
  return new URLSearchParams({
    code,
    client_id: clientId || OAUTH.clientId,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    scope: (scopes || OAUTH.scopes).join(' '),
    redirect_uri: redirectUri,
  }).toString();
}

export function refreshRequestBody({ refreshToken, clientId }) {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId || OAUTH.clientId,
  }).toString();
}

/**
 * One parser for the token endpoint, returning the normalised shape both
 * callers work with. `expiresAt` is null when the provider gave no lifetime.
 */
export function parseTokenJson(text, status = 200) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TickTickError('TickTick returned a non-JSON token response.', {
      code: 'TICKTICK_OAUTH_EXCHANGE',
      status,
    });
  }
  if (!data || typeof data.access_token !== 'string' || !data.access_token) {
    throw new TickTickError('TickTick did not return an access token.', {
      code: 'TICKTICK_OAUTH_EXCHANGE',
      status,
    });
  }
  const expiresIn = Number(data.expires_in);
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    // TickTick issues a long-lived access token and no refresh token, so the
    // expiry is what tells the user when to connect again.
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scope: typeof data.scope === 'string' ? data.scope : null,
  };
}

/** The on-disk shape the MCP login keeps in oauth.json. */
export function tokenFileRecord(parsed) {
  return {
    access_token: parsed.accessToken,
    ...(parsed.refreshToken ? { refresh_token: parsed.refreshToken } : {}),
    ...(parsed.scope ? { scope: parsed.scope } : {}),
    ...(parsed.expiresAt ? { expires_at: parsed.expiresAt } : {}),
  };
}
