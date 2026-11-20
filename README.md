# TickTick connector for Cindy, Claude, Codex and other MCP clients

One TickTick implementation, two ways to use it. **Cindy is the primary target**; the same source also ships a portable MCP server for every other harness.

- **Cindy plugin** — native tools, OAuth token stored in Cindy’s encrypted vault, `$ticktick` command.
- **MCP server** — a dependency-free stdio server for Claude Code, Codex, Claude Desktop, Cursor and any other MCP client, with its own browser OAuth login.

It manages tasks, projects, tags and comments in [TickTick](https://ticktick.com/). Habits, focus sessions and countdowns are intentionally out of scope for v1.

## What it can do

| Area | Actions |
| --- | --- |
| Projects | list (including Inbox), get, create, update, delete |
| Tasks | list, filter, search, get, create, update, complete, complete in bulk, delete, move |
| Tags | list, create |
| Comments | list, add, delete |
| Account | read time zone preferences |

Dates accept `YYYY-MM-DD` or ISO 8601 and are normalized to TickTick’s `yyyy-MM-dd'T'HH:mm:ssZ` format. Priorities accept `none` / `low` / `medium` / `high` or `0` / `1` / `3` / `5`.

## Authentication

No manually copied API token is needed.

- **Cindy plugin:** click **Connect TickTick** and sign in through the browser. Cindy stores and refreshes the OAuth token in its encrypted vault.
- **MCP server:** run `ticktick-mcp login` once. It opens the browser, receives the localhost callback, and stores the token in `~/.config/ticktick-connector/oauth.json` with owner-only permissions.

Both use TickTick’s OAuth PKCE flow with the `tasks:read` and `tasks:write` scopes. The OAuth callback is `http://127.0.0.1:53682/callback`.

## Use it in Cindy

Install the plugin from the Cindy marketplace, or import the `.cindy` package. Then click **Connect TickTick** in the plugin settings and approve access in the browser.

```text
$ticktick show my open tasks
$ticktick add "Send the quarterly report" to Work, due Friday, high priority
$ticktick what is due this week?
```

## Use it with Claude Code

```bash
# One-time browser login
npx -y github:DracieVajko/ticktick-connector login

# Register the MCP server
claude mcp add ticktick -- npx -y github:DracieVajko/ticktick-connector
```

## Use it with Codex

Log in once:

```bash
npx -y github:DracieVajko/ticktick-connector login
```

Then add this to `~/.codex/config.toml`:

```toml
[mcp_servers.ticktick]
command = "npx"
args = ["-y", "github:DracieVajko/ticktick-connector"]
```

## Use it with Claude Desktop

Log in once, then edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ticktick": {
      "command": "npx",
      "args": ["-y", "github:DracieVajko/ticktick-connector"]
    }
  }
}
```

## Use it with Cursor or another MCP client

Use stdio with:

- Command: `npx`
- Arguments: `-y github:DracieVajko/ticktick-connector`

Run the login command once before starting the client. The server has **no runtime dependencies** and requires Node.js 18 or newer.

## Commands

```bash
ticktick-mcp login     # browser OAuth login
ticktick-mcp logout    # remove the saved OAuth token
ticktick-mcp --check   # verify the connection
ticktick-mcp --version
ticktick-mcp --help
```

## Token fallback

If your environment cannot open a browser, you can still use a TickTick personal API token:

```bash
export TICKTICK_API_TOKEN=your_token
```

Or put the token in `TICKTICK_TOKEN_FILE`, `~/.config/ticktick-connector/token`, or `~/.ticktick-connector/token`. The environment variable takes precedence over the OAuth file.

## Tools

`list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`,
`list_tasks`, `filter_tasks`, `search_tasks`, `get_task`, `create_task`, `update_task`,
`complete_task`, `delete_task`, `move_tasks`, `manage_tags`, `manage_comments`.

`list_projects` includes a synthetic `inbox` project. Use `projectId: "inbox"` to create an Inbox task.

Destructive tools require `confirm: true`. Tool descriptions tell the model to ask first.

Every read tool returns a projection of the fields the user needs, so a raw TickTick payload (with `etag`, `focusSummaries` and vendor extras) never reaches the model.

Arguments that a tool does not declare are rejected instead of being dropped, so a typo such as `dueDAte` fails loudly.

## Error codes

Failures come back as a `TickTickError` with one of these codes:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENTS` | The arguments failed validation (bad date, unknown field, out-of-range value). |
| `INVALID_CONFIGURATION` | An environment override is unusable, for example a plain-http `TICKTICK_API_BASE`. |
| `CONFIRM_REQUIRED` | A destructive tool was called without `confirm: true`. |
| `UNKNOWN_TOOL` | The tool name does not exist. |
| `TICKTICK_AUTH` | TickTick rejected the authorization (HTTP 401/403). |
| `TICKTICK_TOKEN_MISSING` | No OAuth token or personal token is configured. |
| `TICKTICK_AUTH_EXPIRED` | The saved authorization expired and there is no refresh token. |
| `TICKTICK_OAUTH` | The browser sign-in failed (state mismatch, cancelled, or missing code). |
| `TICKTICK_OAUTH_LISTEN` | The OAuth callback port is busy. |
| `TICKTICK_OAUTH_TIMEOUT` | The browser sign-in was not completed in time. |
| `TICKTICK_TOKEN_STORE` | The token file could not be read or removed. |
| `TICKTICK_OAUTH_EXCHANGE` | The OAuth code or refresh-token call failed. |
| `TICKTICK_HTTP` | Any other non-2xx answer from the API. |
| `TICKTICK_NOT_FOUND` | The requested task does not exist. |
| `TICKTICK_CONNECTOR_ERROR` | An unexpected failure inside the connector. |
| `TICKTICK_NETWORK` | The request never reached TickTick. |
| `TICKTICK_TIMEOUT` | The request exceeded `TICKTICK_TIMEOUT_MS`. |
| `TICKTICK_RESPONSE_TOO_LARGE` | Cindy truncated the response. |

## Environment

| Variable | Purpose |
| --- | --- |
| `TICKTICK_API_TOKEN` | Personal API token, used instead of OAuth. |
| `TICKTICK_TOKEN_FILE` | File containing a personal API token. |
| `TICKTICK_OAUTH_FILE` | OAuth token storage (default `~/.config/ticktick-connector/oauth.json`). |
| `TICKTICK_API_BASE` | API base override. Must be `https`, except on localhost. |
| `TICKTICK_TIMEOUT_MS` | Request timeout, default `30000`. |
| `TICKTICK_REDIRECT_PORT` | OAuth callback port, default `53682`; `0` picks a free port. |
| `TICKTICK_OAUTH_CLIENT_ID` | OAuth client id override. |
| `TICKTICK_OAUTH_AUTHORIZE_URL` | OAuth authorize URL override. |
| `TICKTICK_OAUTH_TOKEN_URL` | OAuth token URL override. |
| `TICKTICK_NO_BROWSER` | Do not open a browser during `login`. |
| `TICKTICK_DEBUG` | Log stack traces to stderr. |

## Security notes

- OAuth tokens are stored in `~/.config/ticktick-connector/oauth.json` with mode `0600`; refresh tokens never leave your machine except to TickTick’s token endpoint.
- The Cindy plugin never exposes the OAuth token to plugin JavaScript; Cindy injects it at request time.
- The MCP server only sends the token to `api.ticktick.com` unless you override `TICKTICK_API_BASE`, and plain http is refused outside localhost.
- This project is not affiliated with TickTick. TickTick and its logo are trademarks of their owner. The icon is the official app icon from TickTick’s website.

## Development

```bash
npm install
npm run build     # regenerate cindy-plugin/ from src/: ghost.json, main.js, settings.js, settings.html
npm test
```

The entire plugin source lives in `src/`. `cindy-plugin/` contains only what ships: files generated by the build, the shipped READMEs and the icon. The MCP server runs directly from `src/mcp-server.mjs`.

## License

MIT. See [LICENSE](LICENSE).
