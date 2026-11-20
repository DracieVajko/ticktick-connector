# TickTick for Cindy

Manage TickTick tasks, projects, tags and comments without leaving Cindy.

## Setup

1. Open this plugin’s settings in Cindy.
2. Click **Connect TickTick**.
3. Sign in to TickTick in the browser and approve access.

No API token needs to be copied. Cindy stores the OAuth token in its encrypted vault and refreshes it automatically.

## Try it

```text
$ticktick show my open tasks
$ticktick add "Send the quarterly report" to Work, due Friday, high priority
$ticktick what is due this week?
$ticktick mark "Send the quarterly report" complete
```

Ask naturally too; the plugin is discovered when you mention TickTick, tasks, projects, tags, due dates or your agenda.

## Notes

- Task and project IDs come from the list tools. The assistant resolves names to IDs before writing.
- `list_projects` includes the Inbox as `projectId: "inbox"`.
- Dates accept `YYYY-MM-DD` or ISO 8601.
- Deleting tasks, projects or comments requires explicit confirmation.
- v1 covers tasks, projects, tags and comments. Habits, focus sessions and countdowns are not included.

This plugin is not affiliated with TickTick. TickTick and its logo are trademarks of their owner. The icon is the official app icon from TickTick’s website.

Full documentation, MCP setup for Claude/Codex/Cursor and source: [github.com/DracieVajko/ticktick-connector](https://github.com/DracieVajko/ticktick-connector).
