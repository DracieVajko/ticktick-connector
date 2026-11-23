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
    'The Cindy connection now survives restarts. TickTick issues no refresh token, and the host keeps OAuth access tokens in memory only, so every restart marked the account expired and asked for a new sign-in. The plugin now runs the TickTick authorization-code flow itself and stores the access token as its own credential, which the host persists and injects per request. Connect once in the plugin settings: open the sign-in link, then paste the address the browser lands on. Existing host-OAuth accounts are no longer used; connect again after updating. The standalone MCP server is unchanged.',
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
