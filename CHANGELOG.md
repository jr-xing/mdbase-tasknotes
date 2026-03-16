# Changelog

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
