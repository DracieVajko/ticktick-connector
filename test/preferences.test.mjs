import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREFERENCES,
  applyCreateDefaults,
  describeAppliedDefault,
  localDateStamp,
  normalizePreferences,
} from '../src/preferences.mjs';

const NOW = new Date(2026, 10, 23, 15, 40);

test('an unset or unknown preference falls back to explicit dates', () => {
  assert.deepEqual(normalizePreferences(undefined), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ taskDateDefault: 'nonsense' }), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences('today'), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({ taskDateDefault: 'today' }), { taskDateDefault: 'today' });
  assert.deepEqual(normalizePreferences({ taskDateDefault: 'undated-to-inbox' }), {
    taskDateDefault: 'undated-to-inbox',
  });
  assert.deepEqual(normalizePreferences({ taskDateDefault: 'inbox' }), DEFAULT_PREFERENCES);
});

test('today is the local calendar day, including at both ends of it', () => {
  assert.equal(localDateStamp(NOW), '2026-11-23');
  assert.equal(localDateStamp(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.equal(localDateStamp(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('explicit mode never adds anything', () => {
  const args = { projectId: 'p1', title: 'Call' };
  const { args: prepared, applied } = applyCreateDefaults(args, { taskDateDefault: 'explicit' }, { now: NOW });
  assert.equal(prepared, args);
  assert.equal(applied, null);
  assert.equal(describeAppliedDefault(applied), null);
});

test('today mode dates an undated task today, all day', () => {
  const { args, applied } = applyCreateDefaults(
    { projectId: 'p1', title: 'Call' },
    { taskDateDefault: 'today' },
    { now: NOW, timeZone: 'Europe/Bratislava' },
  );
  assert.equal(args.dueDate, '2026-11-23');
  assert.equal(args.isAllDay, true);
  assert.equal(args.timeZone, 'Europe/Bratislava');
  assert.equal(args.projectId, 'p1');
  assert.deepEqual(applied, { mode: 'today', dueDate: '2026-11-23', isAllDay: true });
  assert.match(describeAppliedDefault(applied), /due today \(2026-11-23\)/);
});

test('today mode keeps a date, a zone or an all-day flag the caller gave', () => {
  const dated = { projectId: 'p1', title: 'Call', dueDate: '2026-12-01' };
  assert.equal(
    applyCreateDefaults(dated, { taskDateDefault: 'today' }, { now: NOW }).args,
    dated,
  );
  const started = { projectId: 'p1', title: 'Call', startDate: '2026-12-01' };
  assert.equal(
    applyCreateDefaults(started, { taskDateDefault: 'today' }, { now: NOW }).args,
    started,
  );
  const zoned = applyCreateDefaults(
    { projectId: 'p1', title: 'Call', timeZone: 'America/New_York' },
    { taskDateDefault: 'today' },
    { now: NOW, timeZone: 'Europe/Bratislava' },
  );
  assert.equal(zoned.args.timeZone, 'America/New_York');
  // An empty date is treated as absent, not as "clear the date".
  const empty = applyCreateDefaults(
    { projectId: 'p1', title: 'Call', dueDate: null },
    { taskDateDefault: 'today' },
    { now: NOW },
  );
  assert.equal(empty.args.dueDate, '2026-11-23');
});

test('undated-to-inbox mode moves an undated task to the Inbox and leaves a dated one alone', () => {
  const undated = applyCreateDefaults(
    { projectId: 'p1', title: 'Call' },
    { taskDateDefault: 'undated-to-inbox' },
    { now: NOW },
  );
  assert.equal(undated.args.projectId, 'inbox');
  assert.equal(undated.args.dueDate, undefined);
  assert.deepEqual(undated.applied, { mode: 'undated-to-inbox', projectId: 'inbox' });
  assert.match(describeAppliedDefault(undated.applied), /Inbox/);

  const alreadyInbox = { projectId: 'inbox', title: 'Call' };
  assert.equal(
    applyCreateDefaults(alreadyInbox, { taskDateDefault: 'undated-to-inbox' }, { now: NOW }).args,
    alreadyInbox,
  );

  const dated = { projectId: 'p1', title: 'Call', dueDate: '2026-12-01' };
  assert.equal(
    applyCreateDefaults(dated, { taskDateDefault: 'undated-to-inbox' }, { now: NOW }).args,
    dated,
  );
});
