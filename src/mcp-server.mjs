#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { createClient, detectApiBase, describeError, TickTickError } from './core.mjs';
import { clearStoredOAuth, loginWithOAuth, oauthFilePath, resolveAccessToken } from './auth.mjs';
import { manifest } from './manifest.mjs';
import { callTool, mcpTools } from './tools.mjs';

const SERVER_NAME = manifest.id;
const SERVER_VERSION = manifest.version;
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

function log(message) {
  process.stderr.write(`[ticktick-mcp] ${message}\n`);
}

function nativeTransport(token, timeoutMs) {
  return async ({ url, method, headers, body }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: controller.signal,
      });
      return {
        status: response.status,
        text: await response.text(),
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new TickTickError(`TickTick did not answer within ${timeoutMs} ms.`, {
          code: 'TICKTICK_TIMEOUT',
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function makeClient() {
  const token = await resolveAccessToken();
  if (!token) {
    throw new TickTickError(
      'No TickTick authorization is configured. Run `ticktick-mcp login` to sign in with OAuth, or set TICKTICK_API_TOKEN.',
      { code: 'TICKTICK_TOKEN_MISSING' },
    );
  }
  const timeoutMs = Math.max(
    1000,
    Math.min(120000, Number(process.env.TICKTICK_TIMEOUT_MS) || 30000),
  );
  return createClient({
    transport: nativeTransport(token, timeoutMs),
    baseUrl: detectApiBase(process.env.TICKTICK_API_BASE),
  });
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolList() {
  return mcpTools();
}

function textResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
}

async function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return reply(id, {
        protocolVersion: negotiateProtocolVersion(requested),
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
        instructions:
          'TickTick task manager. Start with list_projects to get project IDs, then list_tasks or create_task. Destructive tools require confirm:true after the user agrees.',
      });
    }

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: toolList() });

    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (typeof name !== 'string' || !name) {
        return replyError(id, -32602, 'tools/call requires a tool name.');
      }
      try {
        const result = await callTool(name, args, await makeClient());
        return reply(id, {
          ...textResult(result),
          isError: false,
        });
      } catch (error) {
        const messageText = describeError(error);
        if (process.env.TICKTICK_DEBUG) log(error?.stack || messageText);
        return reply(id, {
          ...textResult(messageText),
          isError: true,
        });
      }
    }

    case 'resources/list':
      return reply(id, { resources: [] });

    case 'prompts/list':
      return reply(id, { prompts: [] });

    case 'logging/setLevel':
      return reply(id, {});

    case 'shutdown':
      return reply(id, null);

    default:
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    replyError(null, -32700, 'Parse error: expected one JSON-RPC object per line.');
    return Promise.resolve();
  }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message && message.id !== undefined) {
      replyError(message.id, -32600, 'Invalid JSON-RPC request.');
    }
    return Promise.resolve();
  }
  if (message.id === undefined) {
    // notifications/initialized, notifications/cancelled and similar
    // notifications need no response.
    return Promise.resolve();
  }
  return handleRequest(message).catch((error) => {
    if (process.env.TICKTICK_DEBUG) log(error?.stack || String(error));
    replyError(message.id, -32603, `Internal error: ${error?.message || String(error)}`);
  });
}

export async function runServer() {
  try {
    const token = await resolveAccessToken();
    if (!token) {
      log('No TickTick authorization configured yet. Run `ticktick-mcp login` or set TICKTICK_API_TOKEN.');
    }
  } catch (error) {
    log(`TickTick authorization could not be refreshed: ${describeError(error)}`);
  }

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();

  lines.on('line', (line) => {
    if (!line.trim()) return;
    // Keep one request in flight at a time, but never let a failed write or a
    // closed stdout poison the chain for every later request.
    chain = chain.then(handleLine(line)).catch((error) => {
      if (process.env.TICKTICK_DEBUG) log(error?.stack || String(error));
    });
  });

  await new Promise((resolve) => {
    lines.on('close', resolve);
  });
  // Let the last in-flight request finish before the process exits.
  await chain;
}

export async function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      [
        'TickTick MCP connector',
        '',
        'Usage: ticktick-mcp [command]',
        '',
        'Commands:',
        '  login       Sign in to TickTick with browser OAuth (recommended)',
        '  logout      Remove the saved OAuth token',
        '  --check     Verify the current authorization',
        '  --version   Print version',
        '',
        'Run without a command to speak MCP over stdio.',
        '',
        'Environment:',
        '  TICKTICK_API_TOKEN           Optional personal API token override.',
        '  TICKTICK_TOKEN_FILE          Optional file containing a personal API token.',
        `  TICKTICK_OAUTH_FILE          OAuth token storage (default ${oauthFilePath()}).`,
        '  TICKTICK_API_BASE            Override API base (default https://api.ticktick.com/open/v1; https required except localhost).',
        '  TICKTICK_TIMEOUT_MS          Request timeout, default 30000.',
        '  TICKTICK_REDIRECT_PORT       OAuth callback port, default 53682; 0 picks a free port.',
        '  TICKTICK_OAUTH_CLIENT_ID     Override the OAuth client id.',
        '  TICKTICK_OAUTH_AUTHORIZE_URL Override the OAuth authorize URL.',
        '  TICKTICK_OAUTH_TOKEN_URL     Override the OAuth token URL.',
        '  TICKTICK_NO_BROWSER          Do not open a browser during login.',
        '  TICKTICK_DEBUG               Log stack traces to stderr.',
      ].join('\n') + '\n',
    );
    return;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  if (argv.includes('login')) {
    try {
      await loginWithOAuth();
    } catch (error) {
      process.stderr.write(`${describeError(error)}
`);
      process.exitCode = 1;
    }
    return;
  }

  if (argv.includes('logout')) {
    const removed = clearStoredOAuth();
    process.stdout.write(
      removed ? 'TickTick OAuth token removed.\n' : 'No saved TickTick OAuth token to remove.\n',
    );
    return;
  }

  if (argv.includes('--check')) {
    try {
      const client = await makeClient();
      const preferences = await client.getPreferences();
      process.stdout.write(`${JSON.stringify({ ok: true, preferences }, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${describeError(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  await runServer();
}
