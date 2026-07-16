# mdbase-tasknotes-jx

A fork of [mdbase-tasknotes](https://github.com/callumalpass/mdbase-tasknotes) with improved project name handling and output directory control. CLI command: `mtnj`.

Standalone CLI for managing markdown tasks via [mdbase](https://mdbase.dev). Create, query, and manage tasks directly on markdown files using natural language.

Works on the same vault and `_types/task.md` schema that the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin generates, or can initialize its own standalone collection.

## What's different from upstream

- **Project names with spaces** — `+[[My Project Name]]` works natively without double-wrapping wikilinks. No sed post-processing needed.
- **`--folder` option on `create`** — control which directory the created file is saved to (e.g. `--folder projects`, `--folder tasks`).
- **Compact filenames** — task and project paths use stable `YYYY-MM-DD-T/P-<slug>` basenames while the full title stays in frontmatter.
- **Optional LLM naming** — OpenAI, Anthropic, and Google model IDs are entered manually; an offline first-words fallback always works.
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
| `mtnj names [task]` | Audit names, `--preview` generated names, or `--apply` them (`--concurrency` controls parallel generation) |
| `mtnj llm configure\|status\|test` | Configure and validate optional semantic filename generation |
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

## Compact filenames and optional LLM naming

New tasks keep their complete human title in `title` but use a short physical filename such as `2026-06-24-T-dual-net-initial.md`. Each note stores `file_slug`, `filename_schema: compact-v1`, and `file_slug_source` (`llm`, `fallback`, or `manual`). Title edits do not automatically rename an established file.

Without LLM configuration, `mtnj` deterministically uses the first three sanitized title words when they fit, otherwise the first two or one. Task capture therefore remains offline-safe.

```powershell
# Optional semantic naming; model names are intentionally free-form
mtnj llm configure --provider openai --model <model-name>
# Enter the API key at the masked prompt. For non-interactive setup:
mtnj llm configure --provider openai --model <model-name> --api-key "..."
mtnj llm test

# Inspect the active credential source or remove the saved OpenAI key
mtnj llm status
mtnj llm configure --provider openai --model <model-name> --clear-api-key

# Audit and migrate existing or Obsidian-created notes
mtnj names -p "C:\path\to\vault"
mtnj names -p "C:\path\to\vault" --preview --concurrency 4
mtnj names -p "C:\path\to\vault" --apply
```

Provider credentials are stored by provider in `~/.config/mdbase-tasknotes/credentials.json` (or the directory selected by `MDBASE_TASKNOTES_CONFIG_DIR`). This plaintext file is separate from `config.json`, is never shown by `mtnj config`, and uses owner-only file permissions on platforms that support them. The interactive prompt is recommended because `--api-key` values may remain in shell history.

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` remain supported and take precedence over saved keys, which makes temporary overrides and existing automation backward compatible. `mtnj llm status` reports the active source as `environment`, `saved`, or `not set` without printing the credential.

`names --preview` makes provider calls for notes that need generation (or all selected notes with `--refresh`) and feeds the proposed slugs into the same hierarchy planner used by `--apply`. Its move plan shows compact project folders, parent-task folders, leaf filenames, and linked attachment destinations together, without writing metadata or moving files. `names --apply` scans links while the old hierarchy still exists, then serializes frontmatter updates, link-aware note moves, and attachment moves for safety. Attachment migration is automatic and attachment basenames are preserved. The default generation concurrency is 4 and the allowed range is 1–16. Because preview does not persist generated slugs, a later apply makes fresh provider calls and may produce slightly different semantic wording.

Repeated `names --apply` runs reuse stored slugs, skip unchanged metadata writes, and still verify the physical hierarchy. After successful moves, obsolete source folders are removed only when they are empty.

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
  2026-03-07-P-pis-score/
    2026-03-07-P-pis-score.md
    2026-03-07-T-yale-cardio-onc/
      2026-03-07-T-yale-cardio-onc.md
      2026-03-08-T-deploy-block-matching.md
      2026-03-08-T-deploy-deepstrain.md
    2026-03-07-T-yale-cardio-t1/
      2026-03-07-T-yale-cardio-t1.md
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

**Binary attachments** retain their original filenames and move to shallow project-level storage. A single-owner file goes to `<project>/_assets/<task-stem>/`, files shared inside a project go to `<project>/_assets/_shared/`, and cross-project files go to vault-level `_assets/_shared/`. Targets longer than 220 characters and filename collisions are skipped with warnings.

```
projects/
  my-project/
    my-project.md
    task-a.md
    _assets/
      task-a/
        photo.png                 ← sole attachment of task-a
      _shared/
        report.pdf                ← shared by task-a and task-b
```

**Owned notes** (`task-card` and `prompt-note` types) are moved next to the task that references them via `collection.rename(update_refs: true)`, so all wikilinks update automatically.

Binary ownership no longer promotes a leaf task into its own folder. Owned Markdown note types keep their existing placement and promotion behavior.

Markdown-style links and wikilinks are updated to the binary file's final path after a move.

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

## Creating Tasks With Custom Paths

`match.path_glob` and `path_pattern` do different jobs in `_types/task.md`:

- `match.path_glob` tells mdbase which existing files should be treated as tasks.
- `path_pattern` tells `mtn create` where to write a new task file.

If your task type only has `match.path_glob`, listing existing tasks can work, but creating a new task without an explicit path cannot choose a filename. Add `path_pattern` for creation:

```yaml
path_pattern: "calendar/{{year}}/{{month}}-{{monthNameShort}}/{{titleKebab}}.md"

match:
  path_glob: "calendar/**/*.md"
```

## License

MIT
