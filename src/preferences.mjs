// Preferences live in the host /kv store, which the settings page writes and
// the plugin background reads on every tool call. The MCP server has no host
// store, so it always runs with `explicit` and never gains a hidden default.

// `undated-to-inbox` is deliberately not called "inbox": the mode does not just
// pick a project, it sends a task with no date there.
export const TASK_DATE_DEFAULTS = Object.freeze(['explicit', 'today', 'undated-to-inbox']);

export const DEFAULT_PREFERENCES = Object.freeze({ taskDateDefault: 'explicit' });

export function normalizePreferences(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = TASK_DATE_DEFAULTS.includes(source.taskDateDefault)
    ? source.taskDateDefault
    : DEFAULT_PREFERENCES.taskDateDefault;
  return { taskDateDefault: mode };
}

/** Local calendar date, because "today" means the day the user is living in. */
export function localDateStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function resolveLocalTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

function hasDate(args, field) {
  return args[field] !== undefined && args[field] !== null && args[field] !== '';
}

/**
 * Apply the configured default to a create_task call.
 *
 * - `today`: a task without any date is due today, all day.
 * - `undated-to-inbox`: a task without any date is unclassified, so it goes to
 *   the Inbox without a date.
 * - `explicit`: nothing is added.
 *
 * A date the caller gave always wins, in every mode.
 */
export function applyCreateDefaults(args, preferences, options = {}) {
  const { taskDateDefault: mode } = normalizePreferences(preferences);
  if (mode === 'explicit') return { args, applied: null };
  if (hasDate(args, 'dueDate') || hasDate(args, 'startDate')) return { args, applied: null };

  if (mode === 'undated-to-inbox') {
    if (args.projectId === 'inbox') return { args, applied: null };
    return {
      args: { ...args, projectId: 'inbox' },
      applied: { mode, projectId: 'inbox' },
    };
  }

  const dueDate = localDateStamp(options.now ?? new Date());
  // A zone the caller stated wins over this machine's zone; null means "send
  // none". An undefined option never suppresses the machine's own zone.
  const callerZone = typeof args.timeZone === 'string' && args.timeZone ? args.timeZone : undefined;
  const timeZone = callerZone ?? (options.timeZone !== undefined ? options.timeZone : resolveLocalTimeZone());
  return {
    args: {
      ...args,
      dueDate,
      isAllDay: true,
      ...(timeZone ? { timeZone } : {}),
    },
    applied: { mode, dueDate, isAllDay: true },
  };
}

/** One short line for the host log, so a silent preference is visible. */
export function describeAppliedDefault(applied) {
  if (!applied) return null;
  if (applied.mode === 'undated-to-inbox') return 'undated tasks go to the Inbox';
  return `undated tasks are due today (${applied.dueDate}), all day`;
}
