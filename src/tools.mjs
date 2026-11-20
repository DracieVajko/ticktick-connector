import {
  PRIORITIES,
  TickTickError,
  normalizeDate,
  normalizePriority,
  normalizeStatus,
} from './core.mjs';

const INBOX_PROJECT = Object.freeze({
  id: 'inbox',
  name: 'Inbox',
  kind: 'TASK',
  permission: 'write',
  isInbox: true,
});

function pick(object, fields) {
  const out = {};
  for (const field of fields) {
    if (object[field] !== undefined) out[field] = object[field];
  }
  return out;
}

const idSchema = (description) => ({
  type: 'string',
  minLength: 1,
  description,
});

const dateSchema = (description) => ({
  type: ['string', 'null'],
  description,
});

const tagsSchema = {
  type: ['array', 'null'],
  items: { type: 'string', minLength: 1 },
  maxItems: 50,
  description: 'Replace the task tags with this list. Use [] or null to clear them.',
};

const remindersSchema = {
  type: ['array', 'null'],
  items: { type: 'string', minLength: 1 },
  maxItems: 20,
  description: 'TickTick reminder triggers such as "TRIGGER:PT0S" or "TRIGGER:P0DT9H0M0S".',
};

const itemsSchema = {
  type: ['array', 'null'],
  maxItems: 100,
  description: 'Checklist subtasks. Send the complete list when updating.',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Existing subtask id when updating one.' },
      title: { type: 'string', minLength: 1, description: 'Subtask title.' },
      status: { type: 'integer', enum: [0, 1], description: '0 = open, 1 = completed.' },
      startDate: dateSchema('Subtask start date in YYYY-MM-DD or ISO 8601.'),
      dueDate: dateSchema('Subtask due date in YYYY-MM-DD or ISO 8601.'),
      isAllDay: { type: 'boolean' },
      timeZone: { type: 'string', description: 'IANA time zone, for example Europe/London.' },
      sortOrder: { type: 'integer' },
    },
    additionalProperties: false,
  },
};

const prioritySchema = {
  description: 'TickTick priority: 0/none, 1/low, 3/medium, 5/high.',
  oneOf: [
    { type: 'integer', enum: [...new Set(Object.values(PRIORITIES))] },
    { type: 'string', enum: Object.keys(PRIORITIES) },
  ],
};

const statusSchema = {
  type: 'string',
  enum: ['open', 'completed', 'all'],
  default: 'open',
  description: 'Which task statuses to return: open, completed, or both.',
};

function requireString(args, key, label = key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new TickTickError(`Missing or invalid ${label}. Provide a non-empty string.`, {
      code: 'INVALID_ARGUMENTS',
    });
  }
  return value.trim();
}

function optionalString(args, key) {
  if (args[key] === undefined) return undefined;
  if (args[key] === null) return null;
  if (typeof args[key] !== 'string') {
    throw new TickTickError(`${key} must be a string.`, { code: 'INVALID_ARGUMENTS' });
  }
  return args[key];
}

function optionalBoolean(args, key) {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== 'boolean') {
    throw new TickTickError(`${key} must be true or false.`, { code: 'INVALID_ARGUMENTS' });
  }
  return args[key];
}

function optionalInteger(args, key, min, max) {
  if (args[key] === undefined) return undefined;
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TickTickError(`${key} must be an integer from ${min} to ${max}.`, {
      code: 'INVALID_ARGUMENTS',
    });
  }
  return value;
}

function requireInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TickTickError(`${field} must be an integer.`, { code: 'INVALID_ARGUMENTS' });
  }
  return number;
}

function normalizeStringArray(value, field, { max = 50, allowEmpty = true } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new TickTickError(`${field} must be an array with at most ${max} strings.`, {
      code: 'INVALID_ARGUMENTS',
    });
  }
  if (!allowEmpty && value.length === 0) {
    throw new TickTickError(`${field} must contain at least one item.`, {
      code: 'INVALID_ARGUMENTS',
    });
  }
  const result = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new TickTickError(`${field} must contain non-empty strings.`, {
        code: 'INVALID_ARGUMENTS',
      });
    }
    return item.trim();
  });
  return result;
}

function requireConfirm(args, action) {
  if (args.confirm !== true) {
    throw new TickTickError(
      `${action} is destructive. Ask the user to confirm, then call again with confirm:true.`,
      { code: 'CONFIRM_REQUIRED' },
    );
  }
}

const TASK_FIELDS = [
  'id',
  'projectId',
  'title',
  'content',
  'desc',
  'isAllDay',
  'startDate',
  'dueDate',
  'timeZone',
  'priority',
  'status',
  'completedTime',
  'repeatFlag',
  'repeatFrom',
  'tags',
  'reminders',
  'parentId',
  'assigneeUsername',
  'kind',
];

const SUBTASK_FIELDS = [
  'id',
  'title',
  'status',
  'startDate',
  'dueDate',
  'completedTime',
  'isAllDay',
  'timeZone',
  'sortOrder',
];

const PROJECT_FIELDS = [
  'id',
  'name',
  'color',
  'sortOrder',
  'closed',
  'groupId',
  'viewMode',
  'permission',
  'kind',
  'isInbox',
];

const COMMENT_FIELDS = ['id', 'title', 'createdTime', 'modifiedTime'];

const UPDATE_TASK_FIELDS = [
  'id',
  'projectId',
  'title',
  'content',
  'desc',
  'isAllDay',
  'startDate',
  'dueDate',
  'timeZone',
  'reminders',
  'tags',
  'repeatFlag',
  'repeatFrom',
  'priority',
  'sortOrder',
  'items',
  'parentId',
];

function compactTask(task) {
  if (!task || typeof task !== 'object') return task;
  const out = pick(task, TASK_FIELDS);
  if (Array.isArray(task.items)) {
    out.items = task.items.map((item) => pick(item, SUBTASK_FIELDS));
  }
  return out;
}

function compactProject(project) {
  if (!project || typeof project !== 'object') return project;
  return pick(project, PROJECT_FIELDS);
}

const TAG_FIELDS = ['name', 'label', 'color', 'sortOrder', 'etag'];

function compactTag(tag) {
  if (!tag || typeof tag !== 'object') return tag;
  return pick(tag, TAG_FIELDS);
}

function compactComment(comment) {
  if (!comment || typeof comment !== 'object') return comment;
  return pick(comment, COMMENT_FIELDS);
}


function normalizeItems(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw new TickTickError('items must be an array or null.', { code: 'INVALID_ARGUMENTS' });
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new TickTickError(`items[${index}] must be an object.`, {
        code: 'INVALID_ARGUMENTS',
      });
    }
    const out = {};
    if (item.id !== undefined) out.id = String(item.id);
    if (item.title !== undefined) {
      if (typeof item.title !== 'string' || !item.title.trim()) {
        throw new TickTickError(`items[${index}].title must be a non-empty string.`, {
          code: 'INVALID_ARGUMENTS',
        });
      }
      out.title = item.title.trim();
    }
    if (item.status !== undefined) {
      const status = Number(item.status);
      if (status !== 0 && status !== 1) {
        throw new TickTickError(`items[${index}].status must be 0 or 1.`, {
          code: 'INVALID_ARGUMENTS',
        });
      }
      out.status = status;
    }
    for (const field of ['startDate', 'dueDate']) {
      const normalized = normalizeDate(item[field], `items[${index}].${field}`);
      if (normalized !== undefined) out[field] = normalized;
    }
    if (item.isAllDay !== undefined) {
      if (typeof item.isAllDay !== 'boolean') {
        throw new TickTickError(`items[${index}].isAllDay must be true or false.`, {
          code: 'INVALID_ARGUMENTS',
        });
      }
      out.isAllDay = item.isAllDay;
    }
    if (item.timeZone !== undefined) out.timeZone = String(item.timeZone);
    if (item.sortOrder !== undefined) out.sortOrder = requireInteger(item.sortOrder, `items[${index}].sortOrder`);
    return out;
  });
}

function buildTaskFields(args) {
  const payload = {};
  const title = optionalString(args, 'title');
  if (title !== undefined) {
    if (title === null || !title.trim()) {
      throw new TickTickError('title cannot be empty.', { code: 'INVALID_ARGUMENTS' });
    }
    payload.title = title.trim();
  }
  for (const field of ['content', 'desc', 'timeZone', 'repeatFlag']) {
    const value = optionalString(args, field);
    if (value !== undefined) payload[field] = value;
  }
  for (const field of ['startDate', 'dueDate']) {
    if (args[field] !== undefined) payload[field] = normalizeDate(args[field], field);
  }
  const isAllDay = optionalBoolean(args, 'isAllDay');
  if (isAllDay !== undefined) payload.isAllDay = isAllDay;
  if (args.priority !== undefined) payload.priority = normalizePriority(args.priority);
  if (args.tags !== undefined) payload.tags = normalizeStringArray(args.tags, 'tags');
  if (args.reminders !== undefined) {
    payload.reminders = normalizeStringArray(args.reminders, 'reminders', { max: 20 });
  }
  if (args.repeatFrom !== undefined) {
    if (args.repeatFrom === null) {
      payload.repeatFrom = null;
    } else {
      const repeatFrom = String(args.repeatFrom);
      if (!['0', '1', '2'].includes(repeatFrom)) {
        throw new TickTickError('repeatFrom must be "0", "1" or "2".', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      payload.repeatFrom = repeatFrom;
    }
  }
  if (args.items !== undefined) payload.items = normalizeItems(args.items);
  if (args.parentId !== undefined) {
    payload.parentId = args.parentId === null ? '' : String(args.parentId);
  }
  if (args.sortOrder !== undefined) payload.sortOrder = requireInteger(args.sortOrder, 'sortOrder');
  return payload;
}

function normalizePriorityList(value) {  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TickTickError('priority must be a non-empty array.', { code: 'INVALID_ARGUMENTS' });
  }
  return value.map((item) => normalizePriority(item));
}

function bodyFromFilters(args) {
  const body = {};
  if (args.projectIds !== undefined) {
    body.projectIds = normalizeStringArray(args.projectIds, 'projectIds');
  }
  for (const field of ['startDate', 'endDate', 'dueFrom', 'dueTo']) {
    if (args[field] !== undefined) body[field] = normalizeDate(args[field], field);
  }
  if (args.priority !== undefined) body.priority = normalizePriorityList(args.priority);
  if (args.tags !== undefined) body.tag = normalizeStringArray(args.tags, 'tags');
  if (args.status !== undefined) body.status = normalizeStatus(args.status);
  return body;
}

function projectFields(args) {
  const patch = {};
  for (const field of ['name', 'color', 'viewMode', 'kind']) {
    const value = optionalString(args, field);
    if (value !== undefined) patch[field] = value;
  }
  if (args.sortOrder !== undefined) patch.sortOrder = requireInteger(args.sortOrder, 'sortOrder');
  return patch;
}

function matchesLocalSearch(task, needle, from, to) {
  const text = [task.title, task.content, task.desc]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  if (!text.includes(needle)) return false;
  if (from === null && to === null) return true;
  const due = task.dueDate ? Date.parse(task.dueDate) : NaN;
  if (Number.isNaN(due)) return false;
  if (from !== null && due < from) return false;
  if (to !== null && due > to) return false;
  return true;
}

const readOnly = { readOnlyHint: true, destructiveHint: false };
const writeOnly = { readOnlyHint: false, destructiveHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true };

export const TOOL_DEFS = [
  {
    name: 'list_projects',
    description:
      'List TickTick projects, including the Inbox alias, with their IDs, names, colors and permissions. Use the returned projectId in task tools.',
    annotations: readOnly,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 200 },
        offset: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 },
      },
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projects = await client.listProjects({
        limit: optionalInteger(args, 'limit', 1, 200) ?? 200,
        offset: optionalInteger(args, 'offset', 0, 1000000) ?? 0,
      });
      const list = Array.isArray(projects) ? projects.map(compactProject) : [];
      if (!list.some((project) => project?.id === 'inbox')) {
        list.unshift({ ...INBOX_PROJECT });
      }
      return { count: list.length, projects: list };
    },
  },
  {
    name: 'get_project',
    description:
      'Get one TickTick project. With includeTasks true (default) it also returns the project columns and its open tasks; with false, count, tasks and columns are null.',
    annotations: readOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('TickTick project ID from list_projects, or "inbox".'),
        includeTasks: { type: 'boolean', default: true },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const includeTasks = optionalBoolean(args, 'includeTasks') ?? true;
      if (projectId === 'inbox') {
        const tasks = includeTasks
          ? (await client.filterTasks({ projectIds: ['inbox'], status: [0] })) || []
          : null;
        return {
          project: { ...INBOX_PROJECT },
          count: tasks ? tasks.length : null,
          tasks: tasks ? tasks.map(compactTask) : null,
          columns: tasks ? [] : null,
        };
      }
      if (includeTasks) {
        const data = await client.getProjectData(projectId);
        return {
          project: compactProject(data?.project),
          count: Array.isArray(data?.tasks) ? data.tasks.length : 0,
          tasks: (data?.tasks || []).map(compactTask),
          columns: data?.columns || [],
        };
      }
      return {
        project: compactProject(await client.getProject(projectId)),
        count: null,
        tasks: null,
        columns: null,
      };
    },
  },
  {
    name: 'create_project',
    description: 'Create a TickTick project and return its new ID.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        color: { type: 'string', description: 'Hex color such as #4772FA.' },
        viewMode: { type: 'string', enum: ['list', 'kanban', 'timeline'] },
        kind: { type: 'string', enum: ['TASK', 'NOTE'] },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const project = projectFields(args);
      project.name = requireString(args, 'name', 'project name');
      return { project: compactProject(await client.createProject(project)) };
    },
  },
  {
    name: 'update_project',
    description: 'Rename or change the color, view or kind of an existing TickTick project.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('TickTick project ID.'),
        name: { type: 'string', minLength: 1, maxLength: 200 },
        color: { type: 'string' },
        viewMode: { type: 'string', enum: ['list', 'kanban', 'timeline'] },
        kind: { type: 'string', enum: ['TASK', 'NOTE'] },
        sortOrder: { type: 'integer' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const patch = projectFields(args);
      if (Object.keys(patch).length === 0) {
        throw new TickTickError('Provide at least one project field to update.', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      return { project: compactProject(await client.updateProject(projectId, patch)) };
    },
  },
  {
    name: 'delete_project',
    description:
      'Permanently delete a TickTick project. Requires confirm:true; ask the user first. Prefer closing tasks or moving them when unsure.',
    annotations: destructive,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('TickTick project ID.'),
        confirm: { type: 'boolean', description: 'Must be true after the user agrees to delete.' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      requireConfirm(args, 'Deleting a project');
      await client.deleteProject(projectId);
      return { deleted: true, projectId };
    },
  },
  {
    name: 'list_tasks',
    description:
      'List TickTick tasks, optionally limited to one project or "inbox". Status can be open, completed or all; results are capped at 200.',
    annotations: readOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID, or "inbox". Omit to search all accessible projects.',
        },
        status: statusSchema,
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const status = normalizeStatus(args.status);
      const limit = optionalInteger(args, 'limit', 1, 200) ?? 100;
      const filters = { status };
      const projectId = optionalString(args, 'projectId');
      if (projectId) filters.projectIds = [projectId];
      const tasks = await client.filterTasks(filters);
      const list = (tasks || []).slice(0, limit).map(compactTask);
      return { count: list.length, status: args.status || 'open', tasks: list };
    },
  },
  {
    name: 'filter_tasks',
    description:
      'Find TickTick tasks by project, date range, priority, tags or status. Use this for agendas and due-date queries; results are capped at 200.',
    annotations: readOnly,
    parameters: {
      type: 'object',
      properties: {
        projectIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        startDate: dateSchema('Only tasks starting on or after this date.'),
        endDate: dateSchema('Only tasks starting on or before this date.'),
        priority: {
          type: 'array',
          items: prioritySchema,
          minItems: 1,
          maxItems: 4,
          description: 'Match any of these priorities.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 50,
          description: 'Tasks must contain all of these tags.',
        },
        status: statusSchema,
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const body = bodyFromFilters(args);
      const start = body.startDate ? Date.parse(body.startDate) : null;
      const end = body.endDate ? Date.parse(body.endDate) : null;
      if (start !== null && end !== null && start > end) {
        throw new TickTickError('startDate must be on or before endDate.', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      const limit = optionalInteger(args, 'limit', 1, 200) ?? 100;
      const tasks = await client.filterTasks(body);
      const list = (tasks || []).slice(0, limit).map(compactTask);
      return { count: list.length, tasks: list };
    },
  },
  {
    name: 'search_tasks',
    description:
      'Search TickTick tasks by keyword, with optional project, tag, status and due-date filters. Results are capped at 200.',
    annotations: readOnly,
    parameters: {
      type: 'object',
      properties: {
        keywords: { type: 'string', minLength: 1, description: 'Words to search for in task titles and content.' },
        projectIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        status: statusSchema,
        dueFrom: dateSchema('Only tasks due on or after this date.'),
        dueTo: dateSchema('Only tasks due on or before this date.'),
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
      required: ['keywords'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const body = { keywords: requireString(args, 'keywords', 'search keywords') };
      if (args.projectIds !== undefined) body.projectIds = normalizeStringArray(args.projectIds, 'projectIds');
      if (args.tags !== undefined) body.tags = normalizeStringArray(args.tags, 'tags');
      body.status = normalizeStatus(args.status);
      for (const field of ['dueFrom', 'dueTo']) {
        if (args[field] !== undefined) body[field] = normalizeDate(args[field], field);
      }
      const limit = optionalInteger(args, 'limit', 1, 200) ?? 100;
      const apiTasks = await client.searchTasks(body);
      let tasks = Array.isArray(apiTasks) ? apiTasks : [];
      let searchMode = 'api';

      // TickTick's search endpoint can return an empty array on accounts where
      // the same tasks are visible through filter. Fall back to filtering
      // locally so an empty search does not look like a missing task.
      if (tasks.length === 0) {
        searchMode = 'local';
        const filters = bodyFromFilters(args);
        delete filters.startDate;
        delete filters.endDate;
        const candidates = await client.filterTasks(filters);
        const needle = body.keywords.toLocaleLowerCase();
        const from = body.dueFrom ? Date.parse(body.dueFrom) : null;
        const to = body.dueTo ? Date.parse(body.dueTo) : null;
        tasks = (candidates || []).filter((task) => matchesLocalSearch(task, needle, from, to));
      }

      const list = tasks.slice(0, limit).map(compactTask);
      return { count: list.length, keywords: body.keywords, searchMode, tasks: list };
    },
  },
  {
    name: 'get_task',
    description: 'Get one TickTick task by projectId and taskId, including its checklist and recurrence.',
    annotations: readOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('TickTick project ID.'),
        taskId: idSchema('TickTick task ID.'),
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const taskId = requireString(args, 'taskId');
      return { task: compactTask(await client.getTask(projectId, taskId)) };
    },
  },
  {
    name: 'create_task',
    description:
      'Create a TickTick task in a project. Dates accept YYYY-MM-DD or ISO 8601; priority accepts none/low/medium/high or 0/1/3/5.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('TickTick project ID from list_projects; use "inbox" for the Inbox.'),
        title: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: 'string', description: 'Task notes/body.' },
        desc: { type: 'string', description: 'Checklist description.' },
        startDate: dateSchema('Start date/time.'),
        dueDate: dateSchema('Due date/time.'),
        timeZone: { type: 'string', description: 'IANA time zone, for example Europe/London.' },
        isAllDay: { type: 'boolean' },
        priority: prioritySchema,
        tags: tagsSchema,
        reminders: remindersSchema,
        repeatFlag: {
          type: 'string',
          description: 'RFC 5545 recurrence rule, for example RRULE:FREQ=WEEKLY;INTERVAL=1.',
        },
        repeatFrom: {
          type: 'string',
          enum: ['0', '1', '2'],
          description: 'Recurrence base: 0 original date, 1 completion date, 2 next calendar occurrence.',
        },
        items: itemsSchema,
        parentId: { type: 'string', description: 'Parent task ID to create a subtask.' },
      },
      required: ['projectId', 'title'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const title = requireString(args, 'title', 'task title');
      const payload = { projectId, title, ...buildTaskFields(args) };
      return { task: compactTask(await client.createTask(payload)) };
    },
  },
  {
    name: 'update_task',
    description:
      'Update fields on an existing TickTick task. Omitted fields stay unchanged. Use complete_task to mark it done or move_tasks to move it.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('Current TickTick project ID.'),
        taskId: idSchema('TickTick task ID.'),
        title: { type: 'string', minLength: 1, maxLength: 500 },
        content: { type: ['string', 'null'] },
        desc: { type: ['string', 'null'] },
        startDate: dateSchema('New start date/time; null clears it.'),
        dueDate: dateSchema('New due date/time; null clears it.'),
        timeZone: { type: ['string', 'null'] },
        isAllDay: { type: 'boolean' },
        priority: prioritySchema,
        tags: tagsSchema,
        reminders: remindersSchema,
        repeatFlag: { type: ['string', 'null'] },
        repeatFrom: {
          type: ['string', 'null'],
          enum: ['0', '1', '2', null],
        },
        items: itemsSchema,
        parentId: { type: ['string', 'null'], description: 'Move under this parent task; null removes the parent.' },
        sortOrder: { type: 'integer' },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const taskId = requireString(args, 'taskId');
      const current = await client.getTask(projectId, taskId);
      if (!current) throw new TickTickError('Task not found.', { code: 'TICKTICK_NOT_FOUND' });
      if (current.projectId && current.projectId !== projectId) {
        throw new TickTickError(
          'The task belongs to a different project. Use move_tasks instead of update_task to move it.',
          { code: 'INVALID_ARGUMENTS' },
        );
      }
      const patch = buildTaskFields(args);
      if (Object.keys(patch).length === 0) {
        throw new TickTickError('Provide at least one task field to update.', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      const merged = { ...current, ...patch, id: taskId, projectId };
      return { task: compactTask(await client.updateTask(taskId, pick(merged, UPDATE_TASK_FIELDS))) };
    },
  },
  {
    name: 'complete_task',
    description:
      'Mark one TickTick task completed, or complete up to 50 tasks in one project by passing taskIds. For taskIds, omit projectId to use the inbox.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          minLength: 1,
          description: 'Project ID. Required for taskId; optional for taskIds means the inbox.',
        },
        taskId: idSchema('TickTick task ID for a single task.'),
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
          description: 'Task IDs to complete in one project.',
        },
      },
      anyOf: [{ required: ['taskId'] }, { required: ['taskIds'] }],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      if (args.taskIds !== undefined) {
        if (args.taskId !== undefined) {
          throw new TickTickError('Pass either taskId or taskIds, not both.', {
            code: 'INVALID_ARGUMENTS',
          });
        }
        const taskIds = normalizeStringArray(args.taskIds, 'taskIds', { max: 50, allowEmpty: false });
        const projectId = optionalString(args, 'projectId');
        const completedIds = await client.completeTasks({
          projectId: projectId || undefined,
          taskIds,
        });
        const result = { requested: taskIds.length, completedIds: completedIds || [] };
        if (projectId) result.projectId = projectId;
        return result;
      }
      const projectId = requireString(args, 'projectId');
      const taskId = requireString(args, 'taskId');
      await client.completeTask(projectId, taskId);
      return { requested: 1, completedIds: [taskId], projectId };
    },
  },
  {
    name: 'delete_task',
    description:
      'Permanently delete a TickTick task. Requires confirm:true; ask the user first.',
    annotations: destructive,
    parameters: {
      type: 'object',
      properties: {
        projectId: idSchema('TickTick project ID.'),
        taskId: idSchema('TickTick task ID.'),
        confirm: { type: 'boolean', description: 'Must be true after the user agrees to delete.' },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const taskId = requireString(args, 'taskId');
      requireConfirm(args, 'Deleting a task');
      await client.deleteTask(projectId, taskId);
      return { deleted: true, projectId, taskId };
    },
  },
  {
    name: 'move_tasks',
    description: 'Move up to 50 TickTick tasks from one project to another.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        fromProjectId: idSchema('Source project ID.'),
        toProjectId: idSchema('Destination project ID.'),
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
        },
      },
      required: ['fromProjectId', 'toProjectId', 'taskIds'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const fromProjectId = requireString(args, 'fromProjectId');
      const toProjectId = requireString(args, 'toProjectId');
      if (fromProjectId === toProjectId) {
        throw new TickTickError('fromProjectId and toProjectId must be different.', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      const taskIds = normalizeStringArray(args.taskIds, 'taskIds', { max: 50, allowEmpty: false });
      const moves = taskIds.map((taskId) => ({ fromProjectId, toProjectId, taskId }));
      const moved = ((await client.moveTasks(moves)) || []).map(compactTask);
      return {
        moved,
        fromProjectId,
        toProjectId,
        requested: taskIds.length,
      };
    },
  },
  {
    name: 'manage_tags',
    description:
      'List TickTick tags, or create one. Use action "list" to see tags, or action "create" with a name.',
    annotations: writeOnly,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create'] },
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description: 'Tag name for create; stored lowercase.',
        },
        label: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description: 'Optional display label; must match name when lowercased.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      if (args.action === 'list') {
        const tags = (await client.listTags()) || [];
        const list = tags.map(compactTag);
        return { count: list.length, tags: list };
      }
      if (args.action !== 'create') {
        throw new TickTickError('action must be "list" or "create".', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      const name = requireString(args, 'name', 'tag name').toLowerCase();
      const label = (optionalString(args, 'label') || name).trim();
      if (label.toLowerCase() !== name) {
        throw new TickTickError('label must match name when lowercased.', {
          code: 'INVALID_ARGUMENTS',
        });
      }
      return { tag: compactTag(await client.createTag({ name, label })) };
    },
  },
  {
    name: 'manage_comments',
    description:
      'List, add or delete comments on a TickTick task. Use action "list", "add" with content, or "delete" with commentId and confirm:true.',
    annotations: destructive,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'delete'] },
        projectId: idSchema('TickTick project ID.'),
        taskId: idSchema('TickTick task ID.'),
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 10000,
          description: 'Comment text for action "add".',
        },
        commentId: {
          type: 'string',
          description: 'Comment ID for action "delete", from a previous list.',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true for action "delete" after the user agrees.',
        },
      },
      required: ['action', 'projectId', 'taskId'],
      additionalProperties: false,
    },
    handler: async (client, args) => {
      const projectId = requireString(args, 'projectId');
      const taskId = requireString(args, 'taskId');
      if (args.action === 'list') {
        const comments = await client.getComments(projectId, taskId);
        const list = (comments || []).map(compactComment);
        return { count: list.length, comments: list };
      }
      if (args.action === 'add') {
        const content = requireString(args, 'content', 'comment text');
        return {
          comment: compactComment(await client.addComment(projectId, taskId, content)),
        };
      }
      if (args.action === 'delete') {
        const commentId = requireString(args, 'commentId');
        requireConfirm(args, 'Deleting a comment');
        await client.deleteComment(projectId, taskId, commentId);
        return { deleted: true, projectId, taskId, commentId };
      }
      throw new TickTickError('action must be "list", "add" or "delete".', {
        code: 'INVALID_ARGUMENTS',
      });
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOL_DEFS.map((tool) => [tool.name, tool]));

const TYPE_CHECKS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  null: (value) => value === null,
};

function schemaError(path, message) {
  return new TickTickError(`${path || 'arguments'} ${message}`, { code: 'INVALID_ARGUMENTS' });
}

/**
 * Small JSON Schema subset validator, so a declared contract (types, enums,
 * limits, required keys) is enforced at call time instead of only being
 * described to the host.
 */
function validateAgainst(schema, value, path) {
  if (!schema || typeof schema !== 'object') return;

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((option) => {
      try {
        validateAgainst(option, value, path);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) throw schemaError(path, 'does not match any of the allowed shapes.');
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((option) => {
      try {
        validateAgainst(option, value, path);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) throw schemaError(path, 'does not satisfy any of the required options.');
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const unknown = types.filter((type) => !TYPE_CHECKS[type]);
    if (unknown.length) {
      throw schemaError(path, `uses an unsupported schema type (${unknown.join(', ')}).`);
    }
    const ok = types.some((type) => TYPE_CHECKS[type](value));
    if (!ok) throw schemaError(path, `must be ${types.join(' or ')}.`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw schemaError(path, `must be one of: ${schema.enum.map(String).join(', ')}.`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw schemaError(path, `must be at least ${schema.minLength} characters.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw schemaError(path, `must be at most ${schema.maxLength} characters.`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw schemaError(path, `must be at least ${schema.minimum}.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw schemaError(path, `must be at most ${schema.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw schemaError(path, `must contain at least ${schema.minItems} item(s).`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw schemaError(path, `must contain at most ${schema.maxItems} item(s).`);
    }
    if (schema.items) {
      value.forEach((entry, index) => validateAgainst(schema.items, entry, `${path}[${index}]`));
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) throw schemaError(path, `is missing the required key ${key}.`);
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties[key]) {
        validateAgainst(schema.properties[key], entry, path ? `${path}.${key}` : key);
      } else if (schema.additionalProperties === false) {
        throw schemaError(
          path,
          `has an unknown key ${key}. Supported: ${Object.keys(schema.properties).join(', ')}.`,
        );
      }
    }
  }
}

export async function callTool(name, args, client) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    throw new TickTickError(`Unknown TickTick tool: ${name}`, { code: 'UNKNOWN_TOOL' });
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TickTickError('Tool arguments must be a JSON object.', {
      code: 'INVALID_ARGUMENTS',
    });
  }
  validateAgainst(tool.parameters, args, '');
  return tool.handler(client, args);
}

export function manifestTools() {
  return TOOL_DEFS.map(({ name, description, parameters, annotations }) => ({
    name,
    description,
    parameters,
    ...(annotations ? { annotations } : {}),
  }));
}

/** The MCP `tools/list` shape, derived from the same projection as ghost.json. */
export function mcpTools() {
  return manifestTools().map(({ name, description, parameters, annotations }) => ({
    name,
    description,
    inputSchema: parameters,
    ...(annotations ? { annotations } : {}),
  }));
}
