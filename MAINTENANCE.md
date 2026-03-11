# Maintenance Guide

How to rebuild, reinstall, and keep the skill docs in sync.

## 1. Reinstall the package globally

After making code changes to `src/`:

```bash
cd C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-FORK

# Option A: Use the install script (builds + installs)
./scripts/install-global.sh

# Option B: Manual steps
npm run build
npm install -g .
```

**If `npm install -g .` fails** with `Cannot read properties of null (reading 'location')`:

```bash
# Remove the old global install directory first, then retry
rm -rf "C:\Users\remus\AppData\Roaming\npm\node_modules\mdbase-tasknotes-jx"
npm install -g .
```

**Important:** On Windows, never use `del` on the npm global symlink directory — it follows the junction and deletes files from the actual project. Use `rm -rf` in Git Bash instead.

Verify:

```bash
mtnj --version
mtnj tree -p "C:\Users\remus\Documents\Obsidian\ResearchKelan"
```

## 2. Update the skill repo

The skill source lives in a separate repo:

```
C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-PUBLISH\tasknote-skill\
```

Files to update when CLI commands or features change:

| File | What it covers |
|------|---------------|
| `skills/tasknote/SKILL.md` | Main skill — note types, lifecycle, querying table |
| `skills/tasknote-quick/SKILL.md` | Quick skill — create/list/search/tree commands |
| `skills/tasknote/references/mtn-commands.md` | Full CLI command reference |
| `skills/tasknote/references/templates.md` | Frontmatter templates for each note type |
| `skills/tasknote/references/property-types.md` | Property names, types, and formats |
| `skills/tasknote/references/taxonomy.md` | Tag hierarchy and context values |

After editing:

```bash
cd C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-PUBLISH\tasknote-skill
git add -A
git commit -m "docs: <describe changes>"
git push
```

## 3. Update Claude cached skills

Claude Code loads skills from a plugin cache directory. After pushing skill changes, copy the updated files into the cache so the current installation picks them up:

```bash
# Source
SRC="C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-PUBLISH\tasknote-skill\skills"

# Cache destination
DST="C:\Users\remus\.claude\plugins\cache\tasknote-skill\tasknote\0.1.8\skills"

# Copy all skill files
cp "$SRC/tasknote/SKILL.md"                      "$DST/tasknote/SKILL.md"
cp "$SRC/tasknote-quick/SKILL.md"                 "$DST/tasknote-quick/SKILL.md"
cp "$SRC/tasknote/references/mtn-commands.md"     "$DST/tasknote/references/mtn-commands.md"
cp "$SRC/tasknote/references/templates.md"        "$DST/tasknote/references/templates.md"
cp "$SRC/tasknote/references/property-types.md"   "$DST/tasknote/references/property-types.md"
cp "$SRC/tasknote/references/taxonomy.md"         "$DST/tasknote/references/taxonomy.md"
```

**Note:** The cache version path (`0.1.8`) may change if the plugin version is bumped in `plugin.json`. Check `ls ~/.claude/plugins/cache/tasknote-skill/tasknote/` to find the current version directory.

New Claude Code sessions will use the updated skills immediately. Existing sessions keep the old version until restarted.

## All-in-one after a code + skill change

```bash
# 1. Build and install CLI
cd C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-FORK
npm run build && npm install -g .

# 2. Commit and push CLI changes
git add <files>
git commit -m "feat: ..."
git push

# 3. Update skill docs
cd C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-PUBLISH\tasknote-skill
# ... edit files ...
git add -A && git commit -m "docs: ..." && git push

# 4. Sync cache
SRC="C:\Users\remus\Documents\Projects\2026-03-TASKNOTE-PUBLISH\tasknote-skill\skills"
DST="C:\Users\remus\.claude\plugins\cache\tasknote-skill\tasknote\0.1.8\skills"
cp "$SRC/tasknote/SKILL.md"                      "$DST/tasknote/SKILL.md"
cp "$SRC/tasknote-quick/SKILL.md"                 "$DST/tasknote-quick/SKILL.md"
cp "$SRC/tasknote/references/mtn-commands.md"     "$DST/tasknote/references/mtn-commands.md"
cp "$SRC/tasknote/references/templates.md"        "$DST/tasknote/references/templates.md"
cp "$SRC/tasknote/references/property-types.md"   "$DST/tasknote/references/property-types.md"
cp "$SRC/tasknote/references/taxonomy.md"         "$DST/tasknote/references/taxonomy.md"
```
