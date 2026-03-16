# mdbase-tasknotes-jx

A fork of [mdbase-tasknotes](https://github.com/callumalpass/mdbase-tasknotes) with improved project name handling and output directory control. CLI command: `mtnj`.

Standalone CLI for managing markdown tasks via [mdbase](https://mdbase.dev). Create, query, and manage tasks directly on markdown files using natural language.

Works on the same vault and `_types/task.md` schema that the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin generates, or can initialize its own standalone collection.

## What's different from upstream

- **Project names with spaces** — `+[[My Project Name]]` works natively without double-wrapping wikilinks. No sed post-processing needed.
- **`--folder` option on `create`** — control which directory the created file is saved to (e.g. `--folder projects`, `--folder tasks`).
- **`tree` command** — hierarchical project/task/subtask display with tree-drawing characters.
- **`organize` command** — reorganize task files into project folders based on hierarchy (dry-run by default, `--apply` to execute).
- **`organize --attachments`** — co-locate binary attachments and owned notes (`task-card`, `prompt-note`) with the tasks that reference them, using LCA placement for shared files.
- **`type: project` support** — separate type definition for projects (`_types/project.md`), cleanly distinguishing projects from tasks.
- **`task-card` and `prompt-note` type support** — `mtnj init` creates type definitions and starter folders for these owned note types.
- **CLI command is `mtnj`** — can be installed alongside the original `mtn` without conflict.

## Install

```
npm install -g jr-xing/mdbase-tasknotes
```

### From local clone

```bash
git clone https://github.com/jr-xing/mdbase-tasknotes.git
cd mdbase-tasknotes
./scripts/install-global.sh
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

# View project/task hierarchy
mtnj tree
mtnj tree --tag source/yale
mtnj tree --all  # include completed tasks

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
| `mtnj tree` | Display tasks in a project/subtask hierarchy (`--status`, `--priority`, `--tag`, `--overdue`, `--all`) |
| `mtnj organize` | Organize tasks into project folders based on hierarchy (`--apply`, `--orphans skip\|unassigned`, `--attachments`) |
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

## Tree view

The `tree` command displays tasks organized by project, with subtask nesting:

```
+PIS score
├── ☐ Yale Cardio Onc Strain
│   ├── ◐ [high] fix the strain issue...  due:2026-03-08 ~3h
│   ├── ☐ Deploy Block Matching...  due:2026-03-15
│   └── ☐ Deploy DeepStrain...  due:2026-03-15
├── ☐ Yale Cardio Onc T1 data
│   └── ☐ T1 Myocardium Labeling  scheduled:2026-03-15
└── ☐ Yale Cardio Onc T2 data

Orphan tasks
└── ☐ Make a plan for the career plan
```

Subtask relationships are determined by the `projects` field: if a task's `projects` wikilink points to another task (not a project), it becomes a subtask. Tasks with no project affiliation appear under "Orphan tasks".

## Organize

The `organize` command moves task files into project folders to match the logical hierarchy:

```bash
# Preview planned moves (dry-run, default)
mtnj organize

# Execute the moves
mtnj organize --apply

# Also move orphan tasks to _unassigned/
mtnj organize --apply --orphans unassigned
```

Result:

```
projects/
  2026-03-07-PROJECT PIS score/
    2026-03-07-PROJECT PIS score.md
    2026-03-07-TASK Yale Cardio Onc Strain/
      2026-03-07-TASK Yale Cardio Onc Strain.md
      2026-03-08-TASK Deploy Block Matching....md
      2026-03-08-TASK Deploy DeepStrain....md
    2026-03-07-TASK Yale Cardio Onc T1 data/
      2026-03-07-TASK Yale Cardio Onc T1 data.md
      2026-03-07-TASK T1 Myocardium Labeling.md
    2026-03-05-TASK Check status of fetal brain dataset.md
```

Only tasks with children get their own subfolder; leaf tasks stay as plain files. Nesting depth follows the parent chain with no limit. The command uses `collection.rename()` to update all wikilinks automatically.

### Organizing attachments and owned notes

Add `--attachments` to also co-locate binary files and owned note types with the tasks that reference them:

```bash
# Preview (dry-run)
mtnj organize --attachments

# Execute
mtnj organize --attachments --apply

# Combine with standard organize
mtnj organize --attachments --apply --orphans unassigned
```

**Binary attachments** (PDFs, images, spreadsheets, etc.) referenced in note bodies are moved into an `assets/` folder. Placement follows the **Lowest Common Ancestor** rule: an attachment used by exactly one task goes into that task's own subfolder; one shared by multiple tasks in the same project goes into the project folder; cross-project attachments float up further.

```
projects/
  my-project/
    my-project.md
    task-a/                       ← promoted (now owns assets)
      task-a.md
      my-card.md                  ← task-card moved here
      assets/
        photo.png                 ← sole attachment of task-a
    assets/
      report.pdf                  ← shared by task-a and task-b
```

**Owned notes** (`task-card` and `prompt-note` types) are moved next to the task that references them via `collection.rename(update_refs: true)`, so all wikilinks update automatically.

**Note promotion**: a flat task note (`task.md`) that becomes the sole owner of attachments is automatically promoted to its own subfolder (`task/task.md`) to make room for `assets/`.

Markdown-style link paths in note bodies are updated after binary moves. Wikilinks (`![[file.pdf]]`) are left as-is — Obsidian resolves them by filename regardless of location.

#### Setting up owned note types

`mtnj init` now creates `_types/task-card.md` and `_types/prompt-note.md` along with starter folders `task-cards/` and `prompts/`. If you initialized your collection before this version, create the type files manually:

```bash
# _types/task-card.md
---
name: task-card
strict: false
match:
  path_glob: "task-cards/**/*.md"
fields:
  title:
    type: string
    required: true
---
```

Notes must have `type: task-card` or `type: prompt-note` in their frontmatter to be treated as owned notes by `organize --attachments`.

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
