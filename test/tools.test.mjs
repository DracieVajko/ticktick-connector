import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool, TOOL_DEFS } from '../src/tools.mjs';
import { TickTickError } from '../src/core.mjs';

function mockClient(overrides = {}) {
  const calls = [];
  const record = (name, result) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof result === 'function' ? result(...args) : result;
    };

  return {
    calls,
    client: {
      listProjects: record('listProjects', []),
      getProject: record('getProject', { id: 'p1', name: 'Work' }),
      getProjectData: record('getProjectData', {
        project: { id: 'p1', name: 'Work' },
        tasks: [{ id: 't1', title: 'One', items: [] }],
        columns: [],
      }),
      createProject: record('createProject', { id: 'p2', name: 'New' }),
      updateProject: record('updateProject', { id: 'p1', name: 'Renamed' }),
      deleteProject: record('deleteProject', null),
      getTask: record('getTask', {
        id: 't1',
        projectId: 'p1',
        title: 'One',
        priority: 0,
        tags: ['old'],
      }),
      createTask: record('createTask', { id: 't2', title: 'Two' }),
      updateTask: record('updateTask', { id: 't1', title: 'One updated' }),
      completeTask: record('completeTask', null),
      completeTasks: record('completeTasks', ['t1', 't2']),
      deleteTask: record('deleteTask', null),
      moveTasks: record('moveTasks', [{ id: 't1' }]),
      filterTasks: record('filterTasks', []),
      searchTasks: record('searchTasks', []),
      listTags: record('listTags', []),
      createTag: record('createTag', { name: 'work', label: 'work' }),
      getComments: record('getComments', []),
      addComment: record('addComment', { id: 'c1', title: 'Hello' }),
      deleteComment: record('deleteComment', null),
      getPreferences: record('getPreferences', { timeZone: 'Europe/London' }),
      ...overrides,
    },
  };
}

test('all tool definitions have unique names and valid schemas', () => {
  const names = new Set();
  for (const tool of TOOL_DEFS) {
    assert.match(tool.name, /^[a-z0-9_]{1,64}$/);
    assert.ok(!names.has(tool.name), `duplicate tool ${tool.name}`);
    names.add(tool.name);
    assert.equal(tool.parameters.type, 'object');
    assert.ok(Buffer.byteLength(JSON.stringify(tool.parameters), 'utf8') < 16384);
    assert.equal(typeof tool.handler, 'function');
  }
});

test('list_projects injects the Inbox alias', async () => {
  const { client } = mockClient();
  const result = await callTool('list_projects', {}, client);
  assert.equal(result.count, 1);
  assert.deepEqual(result.projects[0], {
    id: 'inbox',
    name: 'Inbox',
    kind: 'TASK',
    permission: 'write',
    isInbox: true,
  });
});

test('get_project supports the Inbox alias', async () => {
  const { client, calls } = mockClient();
  const result = await callTool('get_project', { projectId: 'inbox' }, client);
  assert.equal(result.project.id, 'inbox');
  assert.deepEqual(calls[0].args[0], { projectIds: ['inbox'], status: [0] });
});

test('create_task normalizes dates and priority', async () => {
  const { client, calls } = mockClient();
  const result = await callTool(
    'create_task',
    {
      projectId: 'p1',
      title: '  Send report  ',
      dueDate: '2026-05-01T17:00:00Z',
      priority: 'high',
      tags: ['work'],
    },
    client,
  );

  assert.equal(result.task.id, 't2');
  assert.equal(calls[0].name, 'createTask');
  assert.deepEqual(calls[0].args[0], {
    projectId: 'p1',
    title: 'Send report',
    dueDate: '2026-05-01T17:00:00+0000',
    priority: 5,
    tags: ['work'],
  });
});

test('update_task merges onto the current task instead of clearing fields', async () => {
  const { client, calls } = mockClient();
  await callTool(
    'update_task',
    { projectId: 'p1', taskId: 't1', title: 'Renamed', priority: 'low' },
    client,
  );

  const body = calls.find((call) => call.name === 'updateTask').args[1];
  assert.equal(body.id, 't1');
  assert.equal(body.projectId, 'p1');
  assert.equal(body.title, 'Renamed');
  assert.equal(body.priority, 1);
  assert.deepEqual(body.tags, ['old']);
});

test('delete tools require confirm:true', async () => {
  const { client } = mockClient();
  await assert.rejects(
    () => callTool('delete_task', { projectId: 'p1', taskId: 't1' }, client),
    (error) => error instanceof TickTickError && error.code === 'CONFIRM_REQUIRED',
  );
  await assert.rejects(
    () => callTool('delete_project', { projectId: 'p1' }, client),
    (error) => error.code === 'CONFIRM_REQUIRED',
  );
});

test('filter_tasks builds TickTick date and status filters', async () => {
  const { client, calls } = mockClient();
  await callTool(
    'filter_tasks',
    {
      projectIds: ['p1'],
      startDate: '2026-05-01',
      endDate: '2026-05-07T23:59:59Z',
      priority: ['high', 1],
      tags: ['work'],
      status: 'all',
      limit: 50,
    },
    client,
  );

  assert.deepEqual(calls[0].args[0], {
    projectIds: ['p1'],
    startDate: '2026-05-01T00:00:00+0000',
    endDate: '2026-05-07T23:59:59+0000',
    priority: [5, 1],
    tag: ['work'],
    status: [0, 2],
  });
});

test('list_tasks supports the inbox alias', async () => {
  const { client, calls } = mockClient();
  await callTool('list_tasks', { projectId: 'inbox', status: 'open' }, client);
  assert.deepEqual(calls[0].args[0], {
    projectIds: ['inbox'],
    status: [0],
  });
});

test('search_tasks falls back to local matching when search returns empty', async () => {
  const { client } = mockClient({
    searchTasks: async () => [],
    filterTasks: async () => [
      { id: 't1', title: 'Cindy connector test — check me', status: 0 },
      { id: 't2', title: 'Unrelated task', status: 0 },
    ],
  });
  const result = await callTool('search_tasks', { keywords: 'connector' }, client);
  assert.equal(result.count, 1);
  assert.equal(result.tasks[0].id, 't1');
  assert.equal(result.searchMode, 'local');
});

test('manage_tags lists and creates tags', async () => {
  const { client, calls } = mockClient();
  const listed = await callTool('manage_tags', { action: 'list' }, client);
  assert.equal(listed.count, 0);

  await callTool('manage_tags', { action: 'create', name: 'Work' }, client);
  assert.deepEqual(calls[1].args[0], { name: 'work', label: 'work' });

  await assert.rejects(
    () => callTool('manage_tags', { action: 'create', name: 'work', label: 'Personal' }, client),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS',
  );
});

test('complete_task supports one task or a batch of 50', async () => {
  const { client, calls } = mockClient();
  await callTool('complete_task', { projectId: 'p1', taskId: 't1' }, client);
  assert.deepEqual(calls[0].args, ['p1', 't1']);

  const tooMany = Array.from({ length: 51 }, (_, index) => `t${index}`);
  await assert.rejects(
    () => callTool('complete_task', { taskIds: tooMany }, client),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS',
  );
});

test('unknown arguments are rejected instead of silently dropped', async () => {
  const { client } = mockClient();
  await assert.rejects(
    () => callTool('create_task', { projectId: 'p1', title: 'X', dueDAte: '2026-05-01' }, client),
    (error) =>
      error instanceof TickTickError &&
      error.code === 'TICKTICK_INVALID_ARGUMENTS' &&
      /dueDAte/.test(error.message),
  );
  await assert.rejects(
    () => callTool('list_nothing', {}, client),
    (error) => error.code === 'TICKTICK_UNKNOWN_TOOL',
  );
});

test('filter_tasks compares dates by instant, not by string order', async () => {
  const { client } = mockClient();
  // 2026-05-01T00:00+0800 is 2026-04-30T16:00Z, so it is before the end date
  // even though the string sorts after it.
  await callTool(
    'filter_tasks',
    { startDate: '2026-05-01T00:00:00+0800', endDate: '2026-04-30T20:00:00+0000' },
    client,
  );
  await assert.rejects(
    () =>
      callTool(
        'filter_tasks',
        { startDate: '2026-04-30T20:00:00+0000', endDate: '2026-05-01T00:00:00+0800' },
        client,
      ),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS',
  );
});

test('complete_task reports completed ids for a batch and a single task', async () => {
  const { client } = mockClient();
  const batch = await callTool('complete_task', { taskIds: ['t1', 't2'] }, client);
  assert.deepEqual(batch, { requested: 2, completedIds: ['t1', 't2'] });
  await assert.rejects(
    () => callTool('complete_task', { taskId: 't1', taskIds: ['t2'] }, client),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS',
  );
  await assert.rejects(
    () => callTool('complete_task', {}, client),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS',
  );
  const single = await callTool('complete_task', { projectId: 'p1', taskId: 't1' }, client);
  assert.deepEqual(single, { requested: 1, completedIds: ['t1'], projectId: 'p1' });
});

test('get_project keeps the same response keys when tasks are skipped', async () => {
  const { client } = mockClient();
  const result = await callTool('get_project', { projectId: 'p1', includeTasks: false }, client);
  assert.deepEqual(Object.keys(result).sort(), ['columns', 'count', 'project', 'tasks']);
  assert.equal(result.tasks, null);
  assert.equal(result.count, null);
});

test('grouped tools carry annotations', () => {
  for (const name of ['manage_tags', 'manage_comments']) {
    const tool = TOOL_DEFS.find((entry) => entry.name === name);
    assert.ok(tool.annotations, `${name} should declare annotations`);
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
  }
});

test('manage_comments requires confirm for delete', async () => {
  const { client } = mockClient();
  await assert.rejects(
    () =>
      callTool(
        'manage_comments',
        { action: 'delete', projectId: 'p1', taskId: 't1', commentId: 'c1' },
        client,
      ),
    (error) => error.code === 'CONFIRM_REQUIRED',
  );
});

test('declared types, limits and required keys are enforced', async () => {
  const { client } = mockClient();
  const reject = (args) =>
    assert.rejects(
      () => callTool('list_tasks', args, client),
      (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS',
    );
  await reject({ limit: '5' });
  await reject({ status: ['open'] });
  await reject({ limit: 0 });
  await assert.rejects(
    () => callTool('create_task', { projectId: 'p1' }, client),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS' && /title/.test(error.message),
  );
  await assert.rejects(
    () => callTool('create_task', { projectId: 'p1', title: 'x'.repeat(501) }, client),
    (error) => error.code === 'TICKTICK_INVALID_ARGUMENTS' && /at most 500/.test(error.message),
  );
});

test('project, task, move and comment handlers send the expected payloads', async () => {
  const { client, calls } = mockClient();

  await callTool('create_project', { name: ' New ', color: '#fff' }, client);
  assert.deepEqual(calls.at(-1).args[0], { name: 'New', color: '#fff' });

  await callTool('update_project', { projectId: 'p1', name: 'Renamed' }, client);
  assert.deepEqual(calls.at(-1).args, ['p1', { name: 'Renamed' }]);

  await callTool('get_task', { projectId: 'p1', taskId: 't1' }, client);
  assert.deepEqual(calls.at(-1).args, ['p1', 't1']);

  await callTool('move_tasks', { fromProjectId: 'p1', toProjectId: 'p2', taskIds: ['t1'] }, client);
  assert.deepEqual(calls.at(-1).args[0], [{ fromProjectId: 'p1', toProjectId: 'p2', taskId: 't1' }]);

  await callTool('manage_comments', { action: 'add', projectId: 'p1', taskId: 't1', content: 'Hi' }, client);
  assert.deepEqual(calls.at(-1).args, ['p1', 't1', 'Hi']);

  await callTool('manage_comments', { action: 'list', projectId: 'p1', taskId: 't1' }, client);
  assert.deepEqual(calls.at(-1).args, ['p1', 't1']);
});

test('update_task accepts repeatFrom null to clear the base', async () => {
  const { client, calls } = mockClient();
  await callTool('update_task', { projectId: 'p1', taskId: 't1', repeatFrom: null }, client);
  const body = calls.find((call) => call.name === 'updateTask').args[1];
  assert.equal(body.repeatFrom, null);
});

test('create_task follows the configured new-task default', async () => {
  const { client, calls } = mockClient();
  const applied = [];
  const now = new Date(2026, 10, 23, 9, 0);

  await callTool(
    'create_task',
    { projectId: 'p1', title: 'Call the bank' },
    client,
    {
      preferences: { taskDateDefault: 'today' },
      now,
      timeZone: 'Europe/Bratislava',
      onDefaultApplied: (entry, description) => applied.push({ entry, description }),
    },
  );

  const payload = calls.find((call) => call.name === 'createTask').args[0];
  assert.equal(payload.dueDate, '2026-11-23T00:00:00+0000');
  assert.equal(payload.isAllDay, true);
  assert.equal(payload.timeZone, 'Europe/Bratislava');
  assert.equal(applied.length, 1);
  assert.match(applied[0].description, /due today/);
});

test('create_task keeps an explicit date whatever the default is', async () => {
  const { client, calls } = mockClient();
  const applied = [];

  await callTool(
    'create_task',
    { projectId: 'p1', title: 'Tax return', dueDate: '2027-03-31', isAllDay: false },
    client,
    {
      preferences: { taskDateDefault: 'today' },
      now: new Date(2026, 10, 23, 9, 0),
      onDefaultApplied: (entry) => applied.push(entry),
    },
  );

  const payload = calls.find((call) => call.name === 'createTask').args[0];
  assert.equal(payload.dueDate, '2027-03-31T00:00:00+0000');
  assert.equal(payload.isAllDay, false);
  assert.equal(applied.length, 0);
});

test('create_task can send an undated task to the Inbox', async () => {
  const { client, calls } = mockClient();

  await callTool(
    'create_task',
    { projectId: 'p1', title: 'Call the bank' },
    client,
    { preferences: { taskDateDefault: 'undated-to-inbox' }, now: new Date(2026, 10, 23, 9, 0) },
  );

  const payload = calls.find((call) => call.name === 'createTask').args[0];
  assert.equal(payload.projectId, 'inbox');
  assert.equal(payload.dueDate, undefined);
  assert.equal(payload.isAllDay, undefined);
});

test('the new-task default never touches tools other than create_task', async () => {
  const { client, calls } = mockClient();

  await callTool('list_projects', {}, client, {
    preferences: { taskDateDefault: 'today' },
    now: new Date(2026, 10, 23, 9, 0),
  });

  assert.equal(calls[0].name, 'listProjects');
  assert.equal(calls[0].args.length, 1);
  assert.deepEqual(calls[0].args[0], { limit: 200, offset: 0 });
});
