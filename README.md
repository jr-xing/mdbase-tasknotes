# mdbase-tasknotes-jx

A fork of [mdbase-tasknotes](https://github.com/callumalpass/mdbase-tasknotes) with improved project name handling and output directory control. CLI command: `mtnj`.

Standalone CLI for managing markdown tasks via [mdbase](https://mdbase.dev). Create, query, and manage tasks directly on markdown files using natural language.

Works on the same vault and `_types/task.md` schema that the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin generates, or can initialize its own standalone collection.

## What's different from upstream

- **Project names with spaces** — `+[[My Project Name]]` works natively without double-wrapping wikilinks. No sed post-processing needed.
- **`--folder` option on `create`** — control which directory the created file is saved to (e.g. `--folder projects`, `--folder tasks`).
- **CLI command is `mtnj`** — can be installed alongside the original `mtn` without conflict.

## Install

```
npm install -g jr-xing/mdbase-tasknotes
```

## Quick start

```bash
# Initialize a new collection
mtnj init ~/notes

# Set as default collection
mtnj config --set collectionPath=~/notes

# Create tasks with natural language
mtnj create "Buy groceries tomorrow #shopping @errands"
mtnj create "Write report due friday #work +quarterly-review"
mtnj create "Fix the faucet high priority #home @house"

# Create with project linking and folder control
mtnj create "Review dataset +[[My Research Project]] @data" --folder tasks
mtnj create "New initiative" --folder projects

# List and query
mtnj list
mtnj list --overdue
mtnj list --tag work --status open
mtnj list --json

# Complete a task
mtnj complete "Buy groceries"

# Track time
mtnj timer start "Write report"
mtnj timer status
mtnj timer stop
mtnj timer log --period today
```

## Commands

| Command | Description |
|---|---|
| `mtnj init [path]` | Initialize a new collection with `mdbase.yaml` and `_types/task.md` |
| `mtnj create <text...>` | Create a task from natural language (`--folder <dir>` to control output) |
| `mtnj list` | List tasks with filters (`--status`, `--priority`, `--tag`, `--due`, `--overdue`, `--where`, `--on`, `--json`) |
| `mtnj show <task>` | Show full task detail (`--on YYYY-MM-DD` for recurring instance state) |
| `mtnj complete <task>` | Mark a task as done (`--date YYYY-MM-DD` for recurring instance completion) |
| `mtnj update <task>` | Update fields (`--status`, `--priority`, `--due`, `--title`, `--add-tag`, `--remove-tag`) |
| `mtnj delete <task>` | Delete a task (`--force` to skip backlink check) |
| `mtnj archive <task>` | Add archive tag to a task |
| `mtnj skip <task>` | Skip a recurring instance (`--date YYYY-MM-DD`, default today) |
| `mtnj unskip <task>` | Unskip a recurring instance (`--date YYYY-MM-DD`, default today) |
| `mtnj search <query>` | Full-text search across tasks |
| `mtnj timer start\|stop\|status\|log` | Time tracking |
| `mtnj projects [list\|show]` | List projects and their tasks |
| `mtnj stats` | Aggregate statistics |
| `mtnj interactive` | REPL with live NLP preview |
| `mtnj config` | Manage CLI configuration (`--set`, `--get`, `--list`) |

Tasks can be referenced by file path or title. Titles are matched exactly first, then by substring.

## Natural language parsing

Task text is parsed using [tasknotes-nlp-core](https://github.com/callumalpass/tasknotes-nlp-core). Supported patterns:

- **Dates** — `tomorrow`, `friday`, `next week`, `2026-03-15`
- **Tags** — `#shopping`, `#work`
- **Contexts** — `@home`, `@office`
- **Projects** — `+quarterly-review`, `+[[Project Name With Spaces]]`
- **Priority** — `high priority`, `urgent`
- **Recurrence** — `every day`, `weekly`, `every monday`
- **Estimates** — `~30m`, `~2h`

The parser reads status and priority values from your collection's `_types/task.md`, so customizing the type definition changes what the parser accepts.
For completion semantics, `mtnj` also reads optional `tn_completed_values` on the status field (for example `tn_completed_values: [done, cancelled]`).

## Collection path

Resolved in order:

1. `--path` / `-p` flag
2. `MDBASE_TASKNOTES_PATH` environment variable
3. `collectionPath` in `~/.config/mdbase-tasknotes/config.json`
4. Current working directory

## Using with TaskNotes

If you use the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin with mdbase spec generation enabled, `mtnj` works directly on your vault — point it at your vault root and it will read the same `mdbase.yaml` and `_types/task.md` the plugin generates. Tasks created by either tool are visible to both.

## License

MIT
