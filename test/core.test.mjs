import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createClient,
  resolveApiBase,
  normalizeDate,
  normalizePriority,
  normalizeStatus,
  TickTickError,
} from '../src/core.mjs';

test('normalizeDate accepts date-only and normalizes ISO offsets', () => {
  assert.equal(normalizeDate('2026-05-01'), '2026-05-01T00:00:00+0000');
  assert.equal(
    normalizeDate('2026-05-01T09:30:00.000Z'),
    '2026-05-01T09:30:00+0000',
  );
  assert.equal(
    normalizeDate('2026-05-01T09:30:00+08:00'),
    '2026-05-01T09:30:00+0800',
  );
  assert.equal(normalizeDate(undefined), undefined);
  assert.equal(normalizeDate(null), null);
  assert.throws(() => normalizeDate('tomorrow'), TickTickError);
  assert.throws(() => normalizeDate('2026-05-01Tbanana'), TickTickError);
  assert.throws(() => normalizeDate('2026-05-01T99:99:99+0000'), TickTickError);
});

test('resolveApiBase only accepts https or localhost overrides', () => {
  assert.equal(resolveApiBase(undefined), undefined);
  assert.equal(resolveApiBase('  '), undefined);
  assert.equal(resolveApiBase('https://api.example.test/open/v1'), 'https://api.example.test/open/v1');
  assert.equal(resolveApiBase('http://127.0.0.1:8080/open/v1'), 'http://127.0.0.1:8080/open/v1');
  assert.equal(resolveApiBase('http://localhost:8080/open/v1'), 'http://localhost:8080/open/v1');
  assert.throws(() => resolveApiBase('http://api.example.test/open/v1'), TickTickError);
  assert.throws(() => resolveApiBase('not a url'), TickTickError);
});

test('normalizePriority accepts names and TickTick numeric values', () => {
  assert.equal(normalizePriority('high'), 5);
  assert.equal(normalizePriority('Medium'), 3);
  assert.equal(normalizePriority(1), 1);
  assert.equal(normalizePriority(undefined), undefined);
  assert.throws(() => normalizePriority(2), TickTickError);
});

test('normalizeStatus maps the public status names', () => {
  assert.deepEqual(normalizeStatus(undefined), [0]);
  assert.deepEqual(normalizeStatus('open'), [0]);
  assert.deepEqual(normalizeStatus('completed'), [2]);
  assert.deepEqual(normalizeStatus('all'), [0, 2]);
  assert.throws(() => normalizeStatus('weird'), TickTickError);
});

test('client builds project list requests with pagination', async () => {
  const calls = [];
  const client = createClient({
    transport: async (request) => {
      calls.push(request);
      return {
        status: 200,
        text: JSON.stringify([{ id: 'p1', name: 'Work' }]),
      };
    },
  });

  const projects = await client.listProjects({ limit: 50, offset: 100 });
  assert.deepEqual(projects, [{ id: 'p1', name: 'Work' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.ticktick.com/open/v1/project?limit=50&offset=100');
  assert.equal(calls[0].body, undefined);
});

test('client posts JSON task bodies and returns parsed responses', async () => {
  let captured;
  const client = createClient({
    transport: async (request) => {
      captured = request;
      return { status: 200, text: JSON.stringify({ id: 't1', title: 'Write report' }) };
    },
  });

  const task = await client.createTask({
    projectId: 'p1',
    title: 'Write report',
    priority: 5,
  });

  assert.deepEqual(task, { id: 't1', title: 'Write report' });
  assert.equal(captured.method, 'POST');
  assert.equal(captured.url, 'https://api.ticktick.com/open/v1/task');
  assert.equal(captured.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.body), {
    projectId: 'p1',
    title: 'Write report',
    priority: 5,
  });
});

test('client turns 401 into an auth error with a useful message', async () => {
  const client = createClient({
    transport: async () => ({ status: 401, text: '' }),
  });

  await assert.rejects(
    () => client.listProjects(),
    (error) => {
      assert.equal(error.code, 'TICKTICK_AUTH');
      assert.match(error.message, /authorization/i);
      return true;
    },
  );
});

test('client encodes IDs in paths', async () => {
  let captured;
  const client = createClient({
    transport: async (request) => {
      captured = request;
      return { status: 200, text: '{}' };
    },
  });

  await client.getTask('project/with space', 'task?1');
  assert.equal(
    captured.url,
    'https://api.ticktick.com/open/v1/project/project%2Fwith%20space/task/task%3F1',
  );
});

test('every HTTP status family maps to an actionable message', async () => {
  const cases = [
    [404, /could not find/],
    [429, /rate-limited/],
    [500, /server error/],
    [403, /rejected the authorization/],
  ];
  for (const [status, pattern] of cases) {
    const client = createClient({ transport: async () => ({ status, text: '' }) });
    await assert.rejects(
      () => client.getTask('p1', 't1'),
      (error) => pattern.test(error.message),
    );
  }
});

test('a transport timeout becomes a network error', async () => {
  const client = createClient({
    transport: async () => {
      throw new Error('socket closed');
    },
  });
  await assert.rejects(
    () => client.listProjects(),
    (error) => error.code === 'TICKTICK_NETWORK',
  );
});
