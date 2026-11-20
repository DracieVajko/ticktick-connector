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
    'Follow-up to 1.2.0. The token store has one error code for reads, writes and removal, so a permission problem no longer looks like a missing connection; an unknown schema type is refused instead of accepting any value; manage_tags and move_tasks return the same projections as every other read; a batch complete_task no longer serialises an undefined projectId; and the tool list and the manifest are one projection. New tests cover a mismatched OAuth state, a truncated response and logout.',
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
        key: 'ticktick_account',
        label: 'TickTick account',
        source: 'oauth',
        hint: 'Connect your TickTick account in the browser. No API token is needed.',
        inject: {
          header: 'Authorization',
          format: 'Bearer {value}',
          hosts: ['api.ticktick.com'],
        },
        oauth: {
          authorizeUrl: 'https://ticktick.com/oauth/authorize',
          tokenUrl: 'https://api.ticktick.com/oauth/token',
          clientId: '4OO7Zzir01YsqCXfo6',
          scopes: ['tasks:read', 'tasks:write'],
          pkce: true,
          redirectPort: 53682,
        },
      },
    ],
  },
  setup: {
    requires: [{ anyOf: ['secret:ticktick_account'] }],
  },
};
