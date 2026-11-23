import test from 'node:test';
import assert from 'node:assert/strict';

// The Cindy entry talks to the host through one global object. This test drives
// that bridge directly, so the plugin path is covered without a live host.
const handlers = [];
const sent = [];
const fetches = [];
let fetchResponse = { ok: true, status: 200, body: '[]', headers: {} };

globalThis.cindy = {
  onHostMessage(handler) {
    handlers.push(handler);
  },
  async send(message) {
    sent.push(message);
  },
  async fetch(request) {
    fetches.push(request);
    return fetchResponse;
  },
};

await import('../src/cindy-entry.mjs');

function hostMessage(message) {
  return handlers[0](message);
}

test('cindy bridge forwards a tool call and answers with the result', async () => {
  sent.length = 0;
  fetchResponse = {
    ok: true,
    status: 200,
    body: JSON.stringify([{ id: 'p1', name: 'Work', kind: 'TASK' }]),
    headers: {},
  };

  await hostMessage({ type: 'tool-call', callId: 'call-1', tool: 'list_projects', args: {} });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'tool-result');
  assert.equal(sent[0].callId, 'call-1');
  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].result.count, 2);
  assert.equal(sent[0].result.projects[0].id, 'inbox');
});

test('cindy bridge maps an HTTP failure to the same error as the MCP path', async () => {
  sent.length = 0;
  fetchResponse = { ok: false, status: 401, body: '', headers: {} };

  await hostMessage({ type: 'tool-call', callId: 'call-2', tool: 'list_projects', args: {} });

  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'TICKTICK_AUTH');
  assert.match(sent[0].message, /rejected the authorization/i);
});

test('a missing credential is reported as not connected, not as a network error', async () => {
  sent.length = 0;
  fetchResponse = {
    ok: false,
    status: 0,
    message: 'Credential “TickTick access token” is not configured — open the plugin details page.',
  };

  await hostMessage({ type: 'tool-call', callId: 'call-3', tool: 'list_projects', args: {} });

  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'TICKTICK_NOT_CONNECTED');
  assert.match(sent[0].message, /not connected yet/i);
});

test('cindy bridge keeps transport failures distinct from HTTP failures', async () => {
  sent.length = 0;
  fetchResponse = { ok: false, status: 0, message: 'Host network is offline', errorCode: 'TICKTICK_NETWORK' };

  await hostMessage({ type: 'tool-call', callId: 'call-3', tool: 'list_projects', args: {} });

  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'TICKTICK_NETWORK');
  assert.match(sent[0].message, /offline/);
});

test('cindy bridge ignores messages that are not tool calls', async () => {
  sent.length = 0;
  await hostMessage({ type: 'panel-opened' });
  assert.equal(sent.length, 0);
});

test('cindy bridge reports a truncated response instead of an empty success', async () => {
  sent.length = 0;
  fetchResponse = { ok: true, status: 200, body: '[]', headers: {}, truncated: true };

  await hostMessage({ type: 'tool-call', callId: 'call-4', tool: 'list_projects', args: {} });

  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'TICKTICK_RESPONSE_TOO_LARGE');
});

test('the background applies the stored new-task default from /kv', async (t) => {
  const { localDateStamp } = await import('../src/preferences.mjs');
  t.after(() => {
    delete globalThis.fetch;
  });
  globalThis.fetch = async (url) => {
    assert.equal(url, '/kv');
    return { ok: true, json: async () => ({ taskDateDefault: 'today' }) };
  };

  sent.length = 0;
  fetches.length = 0;
  fetchResponse = {
    ok: true,
    status: 200,
    body: JSON.stringify({ id: 't9', projectId: 'p1', title: 'Call the bank' }),
    headers: {},
  };

  await hostMessage({
    type: 'tool-call',
    callId: 'call-kv',
    tool: 'create_task',
    args: { projectId: 'p1', title: 'Call the bank' },
  });

  assert.equal(sent[0].ok, true);
  const body = JSON.parse(fetches[0].body);
  assert.equal(body.dueDate, `${localDateStamp(new Date())}T00:00:00+0000`);
  assert.equal(body.isAllDay, true);
  assert.equal(body.projectId, 'p1');
});

test('an unreadable /kv falls back to explicit dates instead of guessing', async (t) => {
  t.after(() => {
    delete globalThis.fetch;
  });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  sent.length = 0;
  fetches.length = 0;
  fetchResponse = {
    ok: true,
    status: 200,
    body: JSON.stringify({ id: 't10', projectId: 'p1', title: 'No date' }),
    headers: {},
  };

  await hostMessage({
    type: 'tool-call',
    callId: 'call-kv-missing',
    tool: 'create_task',
    args: { projectId: 'p1', title: 'No date' },
  });

  const body = JSON.parse(fetches[0].body);
  assert.equal(body.dueDate, undefined);
  assert.equal(body.isAllDay, undefined);
});
