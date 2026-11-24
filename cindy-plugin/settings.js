const KEY = 'ticktick_token';
const CHANNEL = 'ticktick-connector';
const $ = (selector) => document.querySelector(selector);

const statusDot = $('#dot');
const statusText = $('#statusText');
const summary = $('#summary');
const signIn = $('#signIn');
const signInHint = $('#signInHint');
const prepareButton = $('#prepare');
const callbackBox = $('#callback');
const saveButton = $('#save');
const disconnectButton = $('#disconnect');
const messageBox = $('#message');
const taskDateDefault = $('#taskDateDefault');
const defaultsHint = $('#defaultsHint');

let channel = null;
let waiting = new Map();
let connected = false;
let kvState = {};
let backgroundReady = false;

const DATE_DEFAULT_HINTS = {
  today: 'Every task created without a date is due today, all day. A date you state still wins.',
  'undated-to-inbox':
    'Tasks created without a date are treated as unclassified and land in the Inbox with no date.',
  explicit: 'Nothing is added: a task without a date stays undated in the project it was created in.',
};

function setMessage(text, tone = '') {
  messageBox.textContent = text;
  messageBox.className = `message${tone ? ` ${tone}` : ''}`;
}

function setBusy(busy) {
  saveButton.disabled = busy;
  prepareButton.disabled = busy;
  disconnectButton.disabled = busy;
  callbackBox.disabled = busy;
}

/** /kv is one object per plugin, so every write merges instead of replacing. */
async function putKv(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete kvState[key];
    else kvState[key] = value;
  }
  const response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(kvState) });
  if (!response.ok) throw new Error(`Cindy could not save the setting (HTTP ${response.status}).`);
}

function renderDateDefault(appliedByPlugin) {
  const mode = DATE_DEFAULT_HINTS[kvState.taskDateDefault] ? kvState.taskDateDefault : 'explicit';
  taskDateDefault.value = mode;
  let text = DATE_DEFAULT_HINTS[mode];
  if (appliedByPlugin && appliedByPlugin.taskDateDefault !== mode) {
    text += ` The plugin background currently reads “${appliedByPlugin.taskDateDefault}” (${appliedByPlugin.source}) — reopen this page or restart the plugin.`;
  }
  defaultsHint.textContent = text;
}

/** Ask the background what it actually reads, so a broken /kv read cannot hide. */
async function confirmAppliedDefault() {
  const reply = waitFor('tt-prefs', 4000);
  send({ type: 'tt-prefs-get' });
  const answer = await reply;
  if (!answer) return;
  renderDateDefault(answer);
  if (answer.source !== 'kv') {
    setMessage(
      'The plugin background cannot read the plugin settings, so new tasks get no default date. Reopen Cindy and try again.',
      'error',
    );
  }
}

function setStatus(kind, text) {
  statusDot.className = `dot ${kind}`;
  statusText.textContent = text;
}

/** The settings page talks to the plugin's sandbox over the channel all its pages share. */
function openChannel() {
  if (channel || typeof BroadcastChannel !== 'function') return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    const resolver = waiting.get(message.type);
    if (!resolver) return;
    waiting.delete(message.type);
    resolver(message);
  });
  return channel;
}

function waitFor(type, timeoutMs) {
  return waitForAny([type], timeoutMs);
}

/** Resolve on the first of several replies, so a failure answer is not mistaken for silence. */
function waitForAny(types, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const type of types) waiting.delete(type);
      resolve(message);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    for (const type of types) waiting.set(type, finish);
  });
}

function send(message) {
  const open = openChannel();
  if (!open) {
    setMessage('This Cindy build cannot reach the plugin background, so the connection cannot be set up.', 'error');
    return false;
  }
  open.postMessage(message);
  return true;
}

/**
 * The plugin background only runs while something is using it. Opening the
 * settings page does not start it, so ask the host to wake it and wait for it
 * to answer on the channel before asking for a sign-in link.
 */
async function ensureBackground() {
  if (backgroundReady) return true;
  try {
    await fetch('/wake', { cache: 'no-store' });
  } catch {
    // Older hosts may not have /wake; the ping loop below still tries.
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const delay = attempt === 0 ? 150 : 700;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const reply = waitFor('tt-pong', 1200);
    if (!send({ type: 'tt-ping' })) return false;
    if (await reply) {
      backgroundReady = true;
      return true;
    }
  }
  return false;
}

function describeError(message) {
  return message?.message || message?.code || 'The TickTick sign-in did not finish.';
}

async function requestSignInLink({ quiet = false } = {}) {
  openChannel();
  const alive = await ensureBackground();
  if (!alive) {
    signIn.classList.add('hidden');
    prepareButton.classList.remove('hidden');
    signInHint.textContent =
      'Cindy did not start the plugin background. Use any TickTick task once (or reopen this page), then try again.';
    if (!quiet) setMessage('The TickTick background is not running yet.', 'error');
    return false;
  }
  const reply = waitForAny(['tt-auth-url', 'tt-auth-error'], 8000);
  send({ type: 'tt-auth-start' });
  const answer = await reply;

  if (answer?.url) {
    signIn.href = answer.url;
    signIn.textContent = 'Open TickTick sign-in ↗';
    signIn.classList.remove('hidden');
    prepareButton.classList.add('hidden');
    signInHint.textContent = 'This opens your browser. Approve access for TickTick tasks.';
    return true;
  }

  signIn.classList.add('hidden');
  prepareButton.classList.remove('hidden');
  signInHint.textContent =
    'The sign-in link is not ready. Open this plugin in Cindy once (so its background starts), then try again.';
  if (answer?.type === 'tt-auth-error') {
    setMessage(describeError(answer), 'error');
  } else if (!quiet) {
    setMessage('The sign-in link could not be prepared.', 'error');
  }
  return false;
}

function showExpiry(expiresAt) {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    summary.textContent =
      'The token TickTick returns is stored in Cindy’s encrypted vault, so the connection keeps working after Cindy or the computer restarts.';
    return;
  }
  const date = new Date(expiresAt);
  const days = Math.round((expiresAt - Date.now()) / 86_400_000);
  summary.textContent =
    days > 0
      ? `Connected to TickTick. The token is valid until ${date.toLocaleDateString()} (about ${days} days). Reconnect here when TickTick stops accepting it.`
      : `The stored token expired on ${date.toLocaleDateString()}. Connect again below.`;
}

async function refresh() {
  try {
    const secretsResponse = await fetch('/secrets');
    if (!secretsResponse.ok) throw new Error(`HTTP ${secretsResponse.status}`);
    const secrets = await secretsResponse.json();
    const entry = Array.isArray(secrets) ? secrets.find((item) => item.key === KEY) : null;
    connected = Boolean(entry?.saved);

    let state = {};
    try {
      const kvResponse = await fetch('/kv');
      if (kvResponse.ok) state = (await kvResponse.json()) || {};
    } catch {
      state = {};
    }
    kvState = state;
    renderDateDefault();

    setStatus(connected ? 'ok' : 'bad', connected ? 'Connected' : 'Not connected');
    showExpiry(state.expiresAt);
    disconnectButton.classList.toggle('hidden', !connected);
    if (connected && entry?.tail) {
      signInHint.textContent = `A token ending in …${entry.tail} is stored. Use the link below to replace it.`;
    }
  } catch (error) {
    setStatus('bad', 'Unavailable');
    setMessage(`Could not read the connection state: ${error.message}`, 'error');
  }
}

/** Trade the pasted callback for a token, through the plugin background. */
async function requestToken(pasted) {
  openChannel();
  const reply = waitForAny(['tt-auth-token', 'tt-auth-error'], 45_000);
  send({ type: 'tt-auth-finish', callbackUrl: pasted });
  const answer = await reply;
  if (!answer) {
    throw new Error(
      'The TickTick background did not answer. Keep this window open, wake the plugin, and try again.',
    );
  }
  if (!answer.token) throw new Error(describeError(answer));
  return answer;
}

/** Hand the token to the vault; only its metadata goes to /kv. */
async function storeToken(answer) {
  // The token goes straight into the host vault: it is not kept in /kv, in
  // localStorage or in a variable after this call.
  let token = answer.token;
  answer.token = null;
  const response = await fetch(`/secrets/${KEY}`, {
    method: 'PUT',
    body: JSON.stringify({ value: token }),
  });
  token = null;
  if (response.status !== 204) {
    throw new Error(`Cindy could not store the token (HTTP ${response.status}).`);
  }
  await putKv({
    connectedAt: Date.now(),
    ...(Number.isFinite(answer.expiresAt) ? { expiresAt: answer.expiresAt } : {}),
  });
}

/** Ask the background to prove the host injects the saved token. */
async function verifyConnection() {
  const reply = waitFor('tt-verify-result', 25_000);
  send({ type: 'tt-verify' });
  return reply;
}

async function saveConnection() {
  const pasted = callbackBox.value.trim();
  if (!pasted) {
    setMessage('Paste the address from the browser first.', 'error');
    return;
  }
  setBusy(true);
  setMessage('Checking the address with TickTick…');
  try {
    const answer = await requestToken(pasted);
    await storeToken(answer);
    callbackBox.value = '';
    const verify = await verifyConnection();
    await refresh();
    if (verify?.ok) {
      setMessage('TickTick connected. The token now survives restarts.', 'ok');
    } else {
      setMessage(
        `The token was stored, but TickTick did not confirm it: ${verify?.message || 'no answer from the plugin'}. Connect again if tasks still fail.`,
        'error',
      );
    }
  } catch (error) {
    setMessage(`Could not finish the connection: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function disconnect() {
  if (!window.confirm('Remove the stored TickTick token from this plugin?')) return;
  setBusy(true);
  try {
    const response = await fetch(`/secrets/${KEY}`, { method: 'DELETE' });
    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    await putKv({ connectedAt: undefined, expiresAt: undefined });
    send({ type: 'tt-auth-cancel' });
    callbackBox.value = '';
    await refresh();
    setMessage('Disconnected. TickTick tasks will ask you to connect again.', 'ok');
  } catch (error) {
    setMessage(`Could not disconnect: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

taskDateDefault.addEventListener('change', async () => {
  const previous = taskDateDefault.value;
  defaultsHint.textContent = DATE_DEFAULT_HINTS[previous] || '';
  try {
    await putKv({ taskDateDefault: previous });
    setMessage('New-task default saved.', 'ok');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

saveButton.addEventListener('click', saveConnection);
disconnectButton.addEventListener('click', disconnect);
prepareButton.addEventListener('click', () => requestSignInLink());

openChannel();
refresh().then(async () => {
  await ensureBackground();
  await requestSignInLink({ quiet: true });
  await confirmAppliedDefault();
});
