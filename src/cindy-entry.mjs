import { createClient, describeError, TickTickError } from './core.mjs';
import { callTool } from './tools.mjs';
import { DEFAULT_PREFERENCES, normalizePreferences } from './preferences.mjs';
import {
  CHANNEL_NAME,
  TOKEN_URL,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  createPkce,
  parseCallbackInput,
  parseTokenJson,
  randomToken,
} from './cindy-auth.mjs';

const PENDING_TTL_MS = 15 * 60 * 1000;
const PREFERENCES_URL = '/kv';
const NOT_CONNECTED_MESSAGE =
  'TickTick is not connected yet. Connect the account in the plugin details (TickTick → Save connection), then try again.';

// One in-flight sign-in at a time: the verifier must never be reused.
let pending = null;

function cindyTransport(callId) {
  return async ({ url, method, headers, body }) => {
    const response = await cindy.fetch({
      url,
      method,
      headers,
      body,
      callId,
      timeoutMs: 30000,
    });

    const status = Number(response.status || 0);
    if (!status) {
      // No HTTP status means Cindy itself could not complete the call. A host
      // gate failure (missing credential) carries no errorCode; real network
      // failures do, and keep their own code and message.
      if (!response.errorCode) {
        throw new TickTickError(NOT_CONNECTED_MESSAGE, { code: 'TICKTICK_NOT_CONNECTED' });
      }
      throw new TickTickError(response.message || 'Cindy could not reach TickTick.', {
        code: response.errorCode,
      });
    }
    if (response.truncated) {
      throw new TickTickError('TickTick returned a response that was too large to read.', {
        code: 'TICKTICK_RESPONSE_TOO_LARGE',
      });
    }

    // Hand the status back to core so 401/404/429/5xx keep the same wording as
    // the MCP server path instead of collapsing into a network error.
    return {
      status,
      text: response.body,
      headers: response.headers,
    };
  };
}

// The settings page and this sandbox share one origin, so the plugin's own KV
// is reachable here even though nothing else on the network is.
let loggedDefault = null;

async function readPreferences() {
  if (typeof fetch !== 'function') {
    return { preferences: DEFAULT_PREFERENCES, source: 'unavailable' };
  }
  try {
    const response = await fetch(PREFERENCES_URL, { cache: 'no-store' });
    if (!response.ok) {
      return { preferences: DEFAULT_PREFERENCES, source: `kv ${response.status}` };
    }
    return { preferences: normalizePreferences(await response.json()), source: 'kv' };
  } catch (error) {
    console.warn(`[ticktick] could not read plugin settings: ${error?.message || error}`);
    return { preferences: DEFAULT_PREFERENCES, source: 'error' };
  }
}

function noteNewTaskDefault(preferences, source) {
  const mode = preferences.taskDateDefault;
  if (mode === loggedDefault) return;
  loggedDefault = mode;
  console.log(`[ticktick] new-task default: ${mode} (${source})`);
}

function startAuthorization() {
  const { verifier, challenge } = createPkce();
  const state = randomToken(18);
  // A new link replaces the previous one; the older state stops matching.
  pending = { verifier, state, createdAt: Date.now() };
  return { url: buildAuthorizeUrl({ state, challenge }) };
}

async function exchangeCode(callbackUrl) {
  // Consume before the first await: the verifier is single use, and two
  // finishes arriving together must not both redeem the same authorization.
  const active = pending;
  pending = null;
  if (!active) {
    throw new TickTickError(
      'This sign-in is not active any more. Open the TickTick sign-in link again from the plugin settings.',
      { code: 'TICKTICK_OAUTH_STATE' },
    );
  }
  if (Date.now() - active.createdAt > PENDING_TTL_MS) {
    throw new TickTickError('The sign-in expired. Open the TickTick sign-in link again.', {
      code: 'TICKTICK_OAUTH_TIMEOUT',
    });
  }

  const { code } = parseCallbackInput(callbackUrl, active.state);
  const body = buildTokenRequestBody({ code, verifier: active.verifier });
  const response = await cindy.fetch({
    url: TOKEN_URL,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    timeoutMs: 30000,
  });
  const status = Number(response.status || 0);
  if (!status) {
    throw new TickTickError(response.message || 'Cindy could not reach TickTick.', {
      code: response.errorCode || 'TICKTICK_NETWORK',
    });
  }
  if (status < 200 || status >= 300) {
    throw new TickTickError(
      `TickTick rejected the authorization code (HTTP ${status}): ${String(response.body || '').slice(0, 200)}`,
      { code: 'TICKTICK_OAUTH_EXCHANGE', status },
    );
  }

  return parseTokenJson(response.body, status);
}

/**
 * Prove that the host really injects the token it just stored, through the same
 * client every tool uses so the base URL and error wording stay in one place.
 */
async function verifyStoredToken() {
  try {
    await createClient({ transport: cindyTransport(undefined) }).listProjects({ limit: 1 });
    return { ok: true };
  } catch (error) {
    if (error instanceof TickTickError && error.code === 'TICKTICK_AUTH') {
      return { ok: false, message: `${error.message} Connect the account again.` };
    }
    return { ok: false, message: describeError(error) };
  }
}

function authFailure(error) {
  return {
    type: 'tt-auth-error',
    code: error instanceof TickTickError ? error.code : 'TICKTICK_OAUTH',
    message: describeError(error),
  };
}

cindy.onHostMessage(async (msg) => {
  if (msg.type !== 'tool-call') return;

  try {
    const client = createClient({ transport: cindyTransport(msg.callId) });
    const { preferences, source } = await readPreferences();
    noteNewTaskDefault(preferences, source);
    const result = await callTool(msg.tool, msg.args || {}, client, {
      preferences,
      onDefaultApplied: (applied, description) => {
        console.log(`[ticktick] applied default: ${description}`);
      },
    });
    await cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: true,
      result,
    });
  } catch (error) {
    await cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      errorCode: error instanceof TickTickError ? error.code : 'TICKTICK_CONNECTOR_ERROR',
      message: describeError(error),
    });
  }
});

// The settings page manages the connection; it reaches this sandbox over the
// channel every plugin page of this plugin shares. The access token passes
// through the page exactly once, straight into the host vault.
if (typeof BroadcastChannel === 'function') {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  if (typeof channel.unref === 'function') channel.unref();

  channel.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'tt-auth-start') {
      try {
        channel.postMessage({ type: 'tt-auth-url', ...startAuthorization() });
      } catch (error) {
        channel.postMessage(authFailure(error));
      }
      return;
    }

    if (message.type === 'tt-auth-finish') {
      try {
        const token = await exchangeCode(message.callbackUrl);
        channel.postMessage({
          type: 'tt-auth-token',
          token: token.accessToken,
          expiresAt: token.expiresAt,
          scope: token.scope,
        });
      } catch (error) {
        channel.postMessage(authFailure(error));
      }
      return;
    }

    if (message.type === 'tt-auth-cancel') {
      pending = null;
      return;
    }

    if (message.type === 'tt-verify') {
      try {
        channel.postMessage({ type: 'tt-verify-result', ...(await verifyStoredToken()) });
      } catch (error) {
        channel.postMessage({ type: 'tt-verify-result', ok: false, message: describeError(error) });
      }
      return;
    }

    // The settings page shows what this sandbox actually reads, so a broken
    // /kv read is visible instead of silently ignoring the preference.
    if (message.type === 'tt-prefs-get') {
      const { preferences, source } = await readPreferences();
      channel.postMessage({ type: 'tt-prefs', taskDateDefault: preferences.taskDateDefault, source });
      return;
    }

    if (message.type === 'tt-ping') {
      channel.postMessage({ type: 'tt-pong' });
    }
  });
}
