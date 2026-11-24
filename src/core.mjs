export const DEFAULT_BASE_URL = 'https://api.ticktick.com/open/v1';

export class TickTickError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TickTickError';
    this.code = options.code || 'TICKTICK_ERROR';
    this.status = options.status;
    this.body = options.body;
  }
}

function trimBase(url) {
  return String(url || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Map an HTTP status to the one wording every caller uses. */
export function describeHttpFailure(status, body) {
  // An empty body must not become an excerpt of `""`.
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const excerpt = text && text !== '""' ? text.slice(0, 300) : '';
  if (status === 401 || status === 403) {
    return `TickTick rejected the authorization (HTTP ${status}). Check that the connection or token is still valid and belongs to the intended account, then reconnect if needed.`;
  }
  if (status === 404) {
    return 'TickTick could not find that project, task or comment (HTTP 404). Refresh the IDs and try again.';
  }
  if (status === 429) {
    return 'TickTick rate-limited the request (HTTP 429). Wait a moment and try again.';
  }
  if (status >= 500) {
    return `TickTick had a server error (HTTP ${status}). Try again shortly.`;
  }
  return `TickTick returned HTTP ${status}${excerpt ? `: ${excerpt}` : ''}`;
}

export function describeError(error) {
  if (error instanceof TickTickError) return error.message;
  return `TickTick connector failed: ${error?.message || String(error)}`;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Validate an API base override. Plain http is only allowed on the loopback
 * interface, so a bearer token is never sent over an unencrypted network hop.
 */
export function resolveApiBase(raw) {
  const value = String(raw || '').trim();
  if (!value) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TickTickError(`TICKTICK_API_BASE is not a valid URL: "${value}".`, {
      code: 'TICKTICK_INVALID_CONFIGURATION',
    });
  }
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new TickTickError('TICKTICK_API_BASE must use https, except for localhost.', {
      code: 'TICKTICK_INVALID_CONFIGURATION',
    });
  }
  return value;
}

/**
 * @typedef {Object} TransportResult
 * @property {number} status HTTP status, 0 when the request never happened
 * @property {string} text raw response body
 * @property {Record<string, string>} [headers]
 */

/**
 * Create a TickTick API client over an injected transport.
 * The transport receives { url, method, headers, body } and resolves to a
 * TransportResult. Cindy supplies cindy.fetch here; the MCP server supplies
 * native fetch with a bearer token.
 */
export function createClient({ transport, baseUrl = DEFAULT_BASE_URL } = {}) {
  if (typeof transport !== 'function') {
    throw new TypeError('createClient requires a transport function');
  }
  const root = trimBase(baseUrl);

  async function request(method, path, body, query) {
    const url = `${root}${path}${buildQuery(query)}`;
    const headers = { Accept: 'application/json' };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let response;
    try {
      response = await transport({ url, method, headers, body: payload });
    } catch (error) {
      if (error instanceof TickTickError) throw error;
      throw new TickTickError(`Could not reach TickTick: ${error.message}`, {
        code: 'TICKTICK_NETWORK',
      });
    }

    const text = typeof response.text === 'string' ? response.text : '';
    const data = parseBody(text);
    const status = Number(response.status || 0);
    if (!status) {
      // No status means the request never produced an HTTP answer; saying
      // "HTTP 0" would send the caller looking at TickTick for a local failure.
      throw new TickTickError('The transport returned no HTTP status for the request.', {
        code: 'TICKTICK_NETWORK',
      });
    }

    if (status < 200 || status >= 300) {
      throw new TickTickError(describeHttpFailure(status, data), {
        code: status === 401 || status === 403 ? 'TICKTICK_AUTH' : 'TICKTICK_HTTP',
        status,
        body: data,
      });
    }

    return data;
  }

  return {
    getPreferences() {
      return request('POST', '/preference');
    },

    listProjects({ limit, offset } = {}) {
      return request('GET', '/project', undefined, { limit, offset });
    },

    getProject(projectId) {
      return request('GET', `/project/${encodeURIComponent(projectId)}`);
    },

    getProjectData(projectId) {
      return request('GET', `/project/${encodeURIComponent(projectId)}/data`);
    },

    createProject(project) {
      return request('POST', '/project', project);
    },

    updateProject(projectId, patch) {
      return request('POST', `/project/${encodeURIComponent(projectId)}`, patch);
    },

    deleteProject(projectId) {
      return request('DELETE', `/project/${encodeURIComponent(projectId)}`);
    },

    getTask(projectId, taskId) {
      return request(
        'GET',
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
      );
    },

    createTask(task) {
      return request('POST', '/task', task);
    },

    updateTask(taskId, task) {
      return request('POST', `/task/${encodeURIComponent(taskId)}`, task);
    },

    completeTask(projectId, taskId) {
      return request(
        'POST',
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
      );
    },

    completeTasks({ projectId, taskIds }) {
      const body = { taskIds };
      if (projectId !== undefined) body.projectId = projectId;
      return request('POST', '/task/completeTasks', body);
    },

    deleteTask(projectId, taskId) {
      return request(
        'DELETE',
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
      );
    },

    moveTasks(moves) {
      return request('POST', '/task/move', moves);
    },

    searchTasks(filters) {
      return request('POST', '/task/search', filters);
    },

    filterTasks(filters) {
      return request('POST', '/task/filter', filters);
    },

    listTags() {
      return request('GET', '/tag');
    },

    createTag(tag) {
      return request('POST', '/tag', tag);
    },

    getComments(projectId, taskId) {
      return request(
        'GET',
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/comments`,
      );
    },

    addComment(projectId, taskId, content) {
      return request(
        'POST',
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/comment`,
        { title: content },
      );
    },

    deleteComment(projectId, taskId, commentId) {
      return request(
        'DELETE',
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/comment/${encodeURIComponent(commentId)}`,
      );
    },
  };
}

/**
 * TickTick accepts dates such as 2026-05-01T09:00:00+0000. Accept normal ISO
 * input too and normalize it without silently changing the intended offset.
 */
export function normalizeDate(value, field = 'date') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const input = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ].+)?$/.test(input)) {
    throw new TickTickError(
      `Invalid ${field}: "${input}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+HHMM.`,
      { code: 'TICKTICK_INVALID_ARGUMENTS' },
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T00:00:00+0000`;
  }
  let output = input.replace(' ', 'T');
  output = output.replace(/\.\d{1,3}(?=(?:[+-]\d{2}:?\d{2}|Z)$)/, '');
  output = output.replace(/Z$/, '+0000');
  output = output.replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
  if (Number.isNaN(Date.parse(output))) {
    throw new TickTickError(
      `Invalid ${field}: "${input}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+HHMM.`,
      { code: 'TICKTICK_INVALID_ARGUMENTS' },
    );
  }
  return output;
}

export const PRIORITIES = Object.freeze({
  none: 0,
  low: 1,
  medium: 3,
  high: 5,
});

export function normalizePriority(value, field = 'priority') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return 0;
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    // Own properties only: `'toString' in PRIORITIES` would return a function.
    if (Object.prototype.hasOwnProperty.call(PRIORITIES, key)) return PRIORITIES[key];
  }
  const number = Number(value);
  if ([0, 1, 3, 5].includes(number)) return number;
  throw new TickTickError(
    `Invalid ${field}: ${JSON.stringify(value)}. Use 0, 1, 3, 5 or none/low/medium/high.`,
    { code: 'TICKTICK_INVALID_ARGUMENTS' },
  );
}

export function normalizeStatus(value) {
  if (value === undefined || value === null || value === 'open') return [0];
  if (value === 'completed') return [2];
  if (value === 'all') return [0, 2];
  if (Array.isArray(value)) {
    const allowed = [-1, 0, 2];
    const result = value.map(Number);
    if (result.every((item) => allowed.includes(item))) return result;
  }
  throw new TickTickError(
    'Invalid status. Use "open", "completed", "all", or an array containing -1, 0 or 2.',
    { code: 'TICKTICK_INVALID_ARGUMENTS' },
  );
}
