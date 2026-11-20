import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { describeError, TickTickError } from './core.mjs';
import { manifest } from './manifest.mjs';

const OAUTH_SECRET_KEY = 'ticktick_account';

function oauthConfig() {
  const secret = manifest.network.secrets.find((entry) => entry.key === OAUTH_SECRET_KEY);
  if (!secret?.oauth) {
    throw new TickTickError('The plugin manifest has no TickTick OAuth secret.', {
      code: 'INVALID_CONFIGURATION',
    });
  }
  return secret.oauth;
}

function log(message) {
  process.stderr.write(`[ticktick-mcp] ${message}\n`);
}

export function oauthFilePath() {
  return (
    process.env.TICKTICK_OAUTH_FILE ||
    join(homedir(), '.config', 'ticktick-connector', 'oauth.json')
  );
}

/** Read lazily so a changed TICKTICK_REDIRECT_PORT takes effect without a restart. */
export function oauthRedirectPort() {
  const configured = Number(process.env.TICKTICK_REDIRECT_PORT);
  return Number.isInteger(configured) && configured >= 0
    ? configured
    : oauthConfig().redirectPort;
}

function redirectUri(port) {
  return `http://127.0.0.1:${port}/callback`;
}

function loadStoredOAuth() {
  let text;
  try {
    text = readFileSync(oauthFilePath(), 'utf8');
  } catch (error) {
    // No token file yet: that is a normal "not connected" state. Any other
    // failure (permissions, a broken mount) must not look like it.
    if (error.code === 'ENOENT') return null;
    throw new TickTickError(`Could not read ${oauthFilePath()}: ${error.message}`, {
      code: 'TICKTICK_TOKEN_STORE',
    });
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data.access_token === 'string') return data;
    log('Ignoring the saved OAuth token: it has no access_token. Run `ticktick-mcp login` again.');
  } catch (error) {
    log(
      `Ignoring the saved OAuth token: ${oauthFilePath()} is not valid JSON (${error.message}). Run \`ticktick-mcp login\` again.`,
    );
  }
  return null;
}

function saveStoredOAuth(data) {
  const file = oauthFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function clearStoredOAuth() {
  try {
    unlinkSync(oauthFilePath());
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new TickTickError(`Could not remove ${oauthFilePath()}: ${error.message}`, {
      code: 'TICKTICK_TOKEN_STORE',
    });
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new TickTickError(`TickTick did not answer within ${timeoutMs} ms.`, {
        code: 'TICKTICK_TIMEOUT',
      });
    }
    throw new TickTickError(`Could not reach TickTick: ${error.message}`, {
      code: 'TICKTICK_NETWORK',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseTokenResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new TickTickError(
      `TickTick token request failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
      { code: 'TICKTICK_OAUTH_EXCHANGE', status: response.status },
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TickTickError('TickTick returned a non-JSON token response.', {
      code: 'TICKTICK_OAUTH_EXCHANGE',
    });
  }
  if (!data.access_token) {
    throw new TickTickError('TickTick token response did not include an access token.', {
      code: 'TICKTICK_OAUTH_EXCHANGE',
    });
  }
  const token = { ...data };
  if (data.expires_in) token.expires_at = Date.now() + Number(data.expires_in) * 1000;
  return token;
}

async function refreshStoredOAuth(stored) {
  if (!stored?.refresh_token) {
    throw new TickTickError(
      'TickTick authorization expired and no refresh token is available. Run `ticktick-mcp login` again.',
      { code: 'TICKTICK_AUTH_EXPIRED' },
    );
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
    client_id: process.env.TICKTICK_OAUTH_CLIENT_ID || oauthConfig().clientId,
  });
  const response = await fetchWithTimeout(process.env.TICKTICK_OAUTH_TOKEN_URL || oauthConfig().tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const next = await parseTokenResponse(response);
  const merged = { ...stored, ...next };
  saveStoredOAuth(merged);
  return merged.access_token;
}

async function oauthAccessToken() {
  const stored = loadStoredOAuth();
  if (!stored) return '';
  if (!stored.expires_at || Date.now() < stored.expires_at - 60_000) {
    return stored.access_token;
  }
  return refreshStoredOAuth(stored);
}

/** Resolve a personal API token: env var first, then the usual token files. */
function resolvePersonalToken() {
  if (process.env.TICKTICK_API_TOKEN?.trim()) {
    return process.env.TICKTICK_API_TOKEN.trim();
  }
  const candidates = [];
  if (process.env.TICKTICK_TOKEN_FILE) candidates.push(process.env.TICKTICK_TOKEN_FILE);
  candidates.push(join(homedir(), '.config', 'ticktick-connector', 'token'));
  candidates.push(join(homedir(), '.ticktick-connector', 'token'));
  for (const file of candidates) {
    try {
      const token = readFileSync(file, 'utf8').trim();
      if (token) return token;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new TickTickError(`Could not read ${file}: ${error.message}`, {
          code: 'TICKTICK_TOKEN_STORE',
        });
      }
    }
  }
  return '';
}

export async function resolveAccessToken() {
  return resolvePersonalToken() || (await oauthAccessToken());
}

function oauthFailure(message, code = 'TICKTICK_OAUTH') {
  return new TickTickError(message, { code });
}

function makePkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function openBrowser(url) {
  if (process.env.TICKTICK_NO_BROWSER) return;
  const command =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // The URL is printed as a fallback.
  }
}

function respond(res, status, message, ok) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(callbackPage(message, ok));
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function callbackPage(message, ok) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>TickTick</title>
<style>body{font:16px system-ui;margin:10vh auto;max-width:560px;padding:0 24px;color:#222}
h1{font-size:22px}code{background:#f2f2f2;padding:2px 5px;border-radius:5px}</style></head>
<body><h1>${ok ? 'TickTick connected' : 'TickTick connection failed'}</h1><p>${escapeHtml(message)}</p>
<p>You can close this window and return to your AI client.</p></body></html>`;
}

export async function loginWithOAuth() {
  const state = randomBytes(18).toString('base64url');
  const { verifier, challenge } = makePkce();
  const clientId = process.env.TICKTICK_OAUTH_CLIENT_ID || oauthConfig().clientId;
  const authorizeUrl = process.env.TICKTICK_OAUTH_AUTHORIZE_URL || oauthConfig().authorizeUrl;
  const tokenUrl = process.env.TICKTICK_OAUTH_TOKEN_URL || oauthConfig().tokenUrl;
  const scopes = oauthConfig().scopes.join(' ');
  const requestedPort = oauthRedirectPort();

  const server = createServer();
  let settled = false;
  let timer;
  let redirect = redirectUri(requestedPort);

  const result = await new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn(value);
    };

    server.on('request', async (req, res) => {
      const url = new URL(req.url || '/', redirect);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        const description = url.searchParams.get('error_description') || oauthError;
        respond(res, 400, description, false);
        finish(reject, oauthFailure(description));
        return;
      }
      if (url.searchParams.get('state') !== state) {
        respond(res, 400, 'The OAuth state did not match. Start the login again.', false);
        finish(reject, oauthFailure('The OAuth state did not match. Start the login again.'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        respond(res, 400, 'TickTick did not return an authorization code.', false);
        finish(reject, oauthFailure('TickTick did not return an authorization code.'));
        return;
      }
      try {
        const body = new URLSearchParams({
          code,
          client_id: clientId,
          code_verifier: verifier,
          grant_type: 'authorization_code',
          scope: scopes,
          redirect_uri: redirect,
        });
        const response = await fetchWithTimeout(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const token = await parseTokenResponse(response);
        saveStoredOAuth(token);
        respond(res, 200, 'Your TickTick account is now connected.', true);
        finish(resolve, token);
      } catch (error) {
        respond(res, 502, describeError(error), false);
        finish(reject, error);
      }
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        finish(
          reject,
          oauthFailure(
            `Port ${requestedPort} is already in use. Close the other process, or set TICKTICK_REDIRECT_PORT to a free port and try again.`,
            'TICKTICK_OAUTH_LISTEN',
          ),
        );
      } else {
        finish(reject, error);
      }
    });

    server.listen(requestedPort, '127.0.0.1', () => {
      // Port 0 means "any free port", so the redirect URI must come from the
      // socket rather than from configuration.
      redirect = redirectUri(server.address().port);
      const authUrl = new URL(authorizeUrl);
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        scope: scopes,
        state,
        redirect_uri: redirect,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      process.stdout.write(`Open this URL to authorize TickTick:\n${authUrl.toString()}\n`);
      openBrowser(authUrl.toString());
    });

    timer = setTimeout(() => {
      finish(reject, oauthFailure('Timed out waiting for the TickTick authorization callback.', 'TICKTICK_OAUTH_TIMEOUT'));
    }, 5 * 60 * 1000);
  });

  process.stdout.write(
    `TickTick connected. Token saved to ${oauthFilePath()}\n${JSON.stringify(
      { scope: result.scope, expires_at: result.expires_at },
      null,
      2,
    )}\n`,
  );
}
