import { VERSION } from './version.mjs';

export const manifest = {
  schemaVersion: 3,
  minCindyVersion: '0.1.139',
  id: 'ticktick-connector',
  name: 'TickTick',
  description:
    'Manage TickTick tasks, projects, tags and comments from Cindy, Claude, Codex, Cursor or any MCP client.',
  whenToUse:
    'Use when the user wants to see, add, edit, complete, delete, move, search or organize TickTick tasks, projects, tags or comments, or asks about their TickTick agenda, inbox, priorities or due dates.',
  version: VERSION,
  releaseNotes:
    'Maintenance release. The JSON Schema validator moved into its own module, response projections now return a documented object or null instead of the raw payload, filter_tasks honours the declared open-status default, and complete_task declares in its schema that a single task needs its project. The settings page connection is split into exchange, store and verify steps. Error codes are one TICKTICK_* namespace, the README error table matches the runtime, and a callback without the OAuth state is refused. New tests cover the schema validator, the new-task time zone and the shared OAuth protocol.',
  icon: 'assets/icon.png',
  readme: {
    en: 'README.md',
    'zh-CN': 'README.zh-CN.md',
  },
  command: 'ticktick',
  entry: 'main.js',
  launch: 'on-demand',
  tools: [],
  settingsHtml: 'settings.html',
  network: {
    hosts: ['api.ticktick.com', 'ticktick.com'],
    secrets: [
      {
        key: 'ticktick_token',
        label: 'TickTick access token',
        source: 'user',
        hint: 'Connect TickTick in this plugin’s settings. The token is issued by TickTick; do not paste one here.',
        inject: {
          header: 'Authorization',
          format: 'Bearer {value}',
          hosts: ['api.ticktick.com'],
        },
      },
    ],
  },
  // The connection is optional at install time: the settings page runs the
  // sign-in, and a missing token answers with a message that points there
  // instead of a password card nobody can fill in.
  setup: {
    requires: [],
  },
};
