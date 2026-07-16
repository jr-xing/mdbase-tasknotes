# Changelog

## Unreleased

- Added stable compact task/project filenames with persisted slug metadata, deterministic offline fallback naming, and the `mtnj names` audit/backfill command.
- Added no-write `names --preview` output using the full project/parent/leaf hierarchy planner, plus bounded parallel slug generation through `--concurrency` while keeping metadata and filesystem mutations sequential.
- Made repeated naming migrations idempotent by reusing stored slugs, skipping unchanged frontmatter writes, verifying paths on every apply, and pruning only empty obsolete hierarchy folders.
- Integrated attachment scanning into naming preview/apply so binaries are resolved before folder renames, moved into compact project-level `_assets` storage, and relinked from their final note paths.
- Added optional OpenAI, Anthropic, and Google slug generation with free-form model configuration via `mtnj llm` commands.
- Added local, per-provider API-key persistence in a restricted credentials file, with masked entry, key replacement/removal, environment-variable overrides, and source-aware status output.
- Moved binary attachments into shallow project-level `_assets` buckets while preserving original filenames, updating Markdown links and wikilinks, and avoiding binary-driven task promotion.
- Made CLI tests Windows-native and isolated configuration tests from the real user profile.

## 0.1.4 - 2026-03-15

- Added `--attachments` flag to `mtnj organize` to co-locate attachments with the notes that own them.
  - Scans all markdown files for body links (wikilinks and markdown-style) to binary files and owned note types.
  - Moves binary attachments (PDFs, images, etc.) into an `assets/` subfolder at the **Lowest Common Ancestor** directory of all referencing notes — so a solely-owned attachment goes into `task/assets/`, while a shared attachment floats up to the project or collection level.
  - Moves `task-card` and `prompt-note` typed notes alongside the task that references them, using `collection.rename(update_refs: true)` so wikilinks update automatically.
  - Promotes flat task notes into their own subfolder when they become the sole owner of assets (e.g. `task.md` → `task/task.md`).
  - Updates markdown-style body link paths after binary moves; wikilinks are left as-is (Obsidian resolves by filename).
  - Dry-run by default; `--apply` to execute.
- Added `_types/task-card.md` and `_types/prompt-note.md` type definitions; `mtnj init` now creates them along with `task-cards/` and `prompts/` starter folders.

## 0.1.3 - 2026-03-07

- Added `organize` command to reorganize task files into project folders based on hierarchy (dry-run by default, `--apply` to execute). Uses fixed `projects/` root for idempotent path computation.
- Added `tree` command to display tasks in a project/subtask hierarchy with tree-drawing characters; shows empty projects by default, `--hide-empty` to suppress.

## Upstream merge

- Fixed project wikilink mapping so existing wikilinks are not double-wrapped. Thanks @waspeer (#9).
- Fixed `~` expansion for configured collection paths, environment paths, and `--path` values. Thanks @anomatomato (#7).
- Fixed `mtn list --due` so natural-language date expressions like `tomorrow` and `May 13 2026` are resolved before filtering. Thanks @npondel (#11).
- Added hour/minute support for `mtn timer log --from` and `--to` filters, including `YYYY-MM-DD HH:mm` and `YYYY-MM-DDTHH:mm`. Thanks @anomatomato (#8).
- Improved the create error and documentation when a task type has `match.path_glob` but no `path_pattern`. Thanks @tparsons9 (#2).
- Fixed `mtn --version` so it reports the package version instead of a hardcoded stale value. Thanks @plashal (#5) and @anomatomato (#6).

## 0.1.2 - 2026-02-19

- Fixed timer log/stat output to compute duration dynamically and use robust display title fallback.
- Fixed filename-title mode behavior so commands resolve task titles from filename when title frontmatter is absent.
- Added TaskNotes-compatible create fallback for `path_pattern` templates (including TaskNotes-style variables like `{{zettel}}`) when `mdbase` cannot derive a path directly.
- Added create-time compatibility defaults for TaskNotes-style schemas:
  - applies schema defaults before create,
  - applies `match.where` defaults (`eq`, `contains`, `exists`),
  - auto-populates mapped `dateCreated`/`dateModified` fields when present.
- Added warnings when `path_pattern` cannot be resolved, including exact missing template variable names.
- Added regression coverage for filename-title mode and create compatibility flows.
