import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, runCli, stripAnsi } from "./helpers.mjs";

test("create uses compact fallback naming and persists metadata", () => {
  const collectionPath = makeTempDir("mtn-compact-create-");
  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCli(["create", "--path", collectionPath, "Initial attempt on dual-branch network"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const file = readdirSync(join(collectionPath, "tasks")).find((name) => name.endsWith(".md"));
  assert.match(file, /^\d{4}-\d{2}-\d{2}-T-initial-attempt-on\.md$/);
  const text = readFileSync(join(collectionPath, "tasks", file), "utf8");
  assert.match(text, /file_slug: initial-attempt-on/);
  assert.match(text, /filename_schema: compact-v1/);
  assert.match(text, /file_slug_source: fallback/);
  assert.match(text, /title: Initial attempt on dual-branch network/);
});

test("names apply backfills and renames an externally created orphan task", () => {
  const collectionPath = makeTempDir("mtn-compact-backfill-");
  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  writeFileSync(join(collectionPath, "tasks", "2026-06-24-TASK Legacy long title.md"), [
    "---",
    "title: Legacy long title for migration",
    "status: open",
    "dateCreated: 2026-06-24T12:00:00Z",
    "---",
    "",
  ].join("\n"));

  result = runCli(["names", "--path", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /missing/);

  result = runCli(["names", "--path", collectionPath, "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const files = readdirSync(join(collectionPath, "tasks")).filter((name) => name.endsWith(".md"));
  assert.deepEqual(files, ["2026-06-24-T-legacy-long-title.md"]);
  assert.match(readFileSync(join(collectionPath, "tasks", files[0]), "utf8"), /file_slug_source: fallback/);
});

test("names apply builds compact project, parent-task, and leaf-task hierarchy", () => {
  const collectionPath = makeTempDir("mtn-compact-tree-");
  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  writeFileSync(join(collectionPath, "_types", "project.md"), [
    "---", "name: project", "strict: false", "match:", "  where:", "    type:", "      eq: project",
    "fields:", "  title:", "    type: string", "---", "",
  ].join("\n"));
  writeFileSync(join(collectionPath, "_types", "task.md"), [
    "---", "name: task", "strict: false", "match:", "  where:", "    type:", "      eq: task",
    "fields:", "  title:", "    type: string", "---", "",
  ].join("\n"));
  const oldProject = "2026-05-17-PROJECT OneMorph";
  const oldParent = "2026-06-03-TASK Mask-guided Atlas Building";
  const oldProjectDir = join(collectionPath, "projects", oldProject);
  const oldParentDir = join(oldProjectDir, oldParent);
  mkdirSync(oldParentDir, { recursive: true });
  writeFileSync(join(oldProjectDir, `${oldProject}.md`), [
    "---", "title: OneMorph", "type: project", "dateCreated: 2026-05-17T12:00:00Z", "---", "",
  ].join("\n"));
  mkdirSync(join(oldParentDir, "assets"), { recursive: true });
  writeFileSync(join(oldParentDir, "assets", "atlas-source.png"), "binary-image-data");
  writeFileSync(join(oldParentDir, `${oldParent}.md`), [
    "---", "title: Mask-guided Atlas Building", "type: task", "dateCreated: 2026-06-03T12:00:00Z", "projects:",
    `  - '[[projects/${oldProject}/${oldProject}]]'`, "---", "", "![atlas](assets/atlas-source.png)", "",
  ].join("\n"));
  writeFileSync(join(oldParentDir, "2026-06-09-TASK branch 1 dual network.md"), [
    "---", "title: branch 1 dual network", "type: task", "dateCreated: 2026-06-09T12:00:00Z", "projects:",
    `  - '[[projects/${oldProject}/${oldParent}/${oldParent}]]'`, "---", "",
  ].join("\n"));

  result = runCli(["names", "--path", collectionPath, "--preview"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const preview = stripAnsi(result.stdout);
  assert.match(preview, /projects\/2026-05-17-P-onemorph\/2026-05-17-P-onemorph\.md/);
  assert.match(preview, /projects\/2026-05-17-P-onemorph\/2026-06-03-T-mask-guided-atlas\/2026-06-03-T-mask-guided-atlas\.md/);
  assert.match(preview, /projects\/2026-05-17-P-onemorph\/2026-06-03-T-mask-guided-atlas\/2026-06-09-T-branch-1-dual\.md/);
  assert.match(preview, /projects\/2026-05-17-P-onemorph\/_assets\/2026-06-03-T-mask-guided-atlas\/atlas-source\.png/);
  assert.equal(existsSync(oldParentDir), true);

  result = runCli(["names", "--path", collectionPath, "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const root = join(collectionPath, "projects", "2026-05-17-P-onemorph");
  assert.equal(existsSync(join(root, "2026-05-17-P-onemorph.md")), true);
  const parent = join(root, "2026-06-03-T-mask-guided-atlas");
  assert.equal(existsSync(join(parent, "2026-06-03-T-mask-guided-atlas.md")), true);
  assert.equal(existsSync(join(parent, "2026-06-09-T-branch-1-dual.md")), true);
  const movedAttachment = join(root, "_assets", "2026-06-03-T-mask-guided-atlas", "atlas-source.png");
  assert.equal(existsSync(movedAttachment), true);
  assert.equal(readFileSync(movedAttachment, "utf8"), "binary-image-data");
  assert.match(
    readFileSync(join(parent, "2026-06-03-T-mask-guided-atlas.md"), "utf8"),
    /!\[atlas\]\(\.\.\/_assets\/2026-06-03-T-mask-guided-atlas\/atlas-source\.png\)/,
  );
  assert.equal(existsSync(oldProjectDir), false);

  result = runCli(["names", "--path", collectionPath, "--apply"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /0\/3 naming records updated/);
  assert.match(stripAnsi(result.stdout), /All files are already organized/);
});

test("names preview generates proposed paths without changing files or frontmatter", () => {
  const collectionPath = makeTempDir("mtn-compact-preview-");
  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const originalName = "2026-06-24-TASK Preview this legacy task.md";
  const originalPath = join(collectionPath, "tasks", originalName);
  const originalText = [
    "---", "title: Preview this legacy task", "status: open", "dateCreated: 2026-06-24T12:00:00Z", "---", "",
  ].join("\n");
  writeFileSync(originalPath, originalText);

  result = runCli(["names", "--path", collectionPath, "--preview", "--concurrency", "2"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = stripAnsi(result.stdout);
  assert.match(output, /Compact filename preview \(2 parallel generator\(s\)\)/);
  assert.match(output, /tasks\/2026-06-24-T-preview-this-legacy\.md/);
  assert.match(output, /no files or frontmatter were changed/);
  assert.equal(existsSync(originalPath), true);
  assert.equal(readFileSync(originalPath, "utf8"), originalText);
});

test("names rejects invalid concurrency and preview/apply combinations", () => {
  const collectionPath = makeTempDir("mtn-compact-preview-options-");
  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCli(["create", "--path", collectionPath, "Option validation task"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(["names", "--path", collectionPath, "--preview", "--concurrency", "0"]);
  assert.equal(result.status, 1);
  assert.match(stripAnsi(result.stdout + result.stderr), /integer from 1 to 16/);

  result = runCli(["names", "--path", collectionPath, "--preview", "--apply"]);
  assert.equal(result.status, 1);
  assert.match(stripAnsi(result.stdout + result.stderr), /either --preview or --apply/);
});
