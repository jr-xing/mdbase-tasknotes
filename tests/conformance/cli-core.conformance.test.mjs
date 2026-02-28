import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, runCli, stripAnsi } from "../helpers.mjs";

function mutateTaskFrontmatter(taskPath, replacer) {
  const original = readFileSync(taskPath, "utf8");
  const updated = replacer(original);
  writeFileSync(taskPath, updated, "utf8");
}

function createBaseCollectionWithTask(title) {
  const collectionPath = makeTempDir("mtn-cli-conf-");
  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(["create", "--path", collectionPath, title]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  return { collectionPath, taskPath: join(collectionPath, "tasks", `${title}.md`) };
}

test("cli conformance: recurring target date resolution precedence", async (t) => {
  await t.test("complete recurring defaults to scheduled date when explicit date omitted", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("RecurringScheduled");

    mutateTaskFrontmatter(taskPath, (text) =>
      text.replace(
        /^title: RecurringScheduled\n/m,
        "title: RecurringScheduled\nscheduled: '2026-03-10'\nrecurrence: FREQ=DAILY\n",
      ),
    );

    const result = runCli(["complete", "--path", collectionPath, "RecurringScheduled"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = readFileSync(taskPath, "utf8");
    assert.match(raw, /completeInstances:\n  - '2026-03-10'/);
  });

  await t.test("complete recurring falls back to due date when scheduled missing", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("RecurringDueFallback");

    mutateTaskFrontmatter(taskPath, (text) =>
      text.replace(
        /^title: RecurringDueFallback\n/m,
        "title: RecurringDueFallback\ndue: '2026-04-01'\nrecurrence: FREQ=DAILY\n",
      ),
    );

    const result = runCli(["complete", "--path", collectionPath, "RecurringDueFallback"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = readFileSync(taskPath, "utf8");
    assert.match(raw, /completeInstances:\n  - '2026-04-01'/);
  });

  await t.test("complete recurring uses explicit date over scheduled/due", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("RecurringExplicit");

    mutateTaskFrontmatter(taskPath, (text) =>
      text.replace(
        /^title: RecurringExplicit\n/m,
        "title: RecurringExplicit\nscheduled: '2026-05-01'\ndue: '2026-05-02'\nrecurrence: FREQ=DAILY\n",
      ),
    );

    const result = runCli([
      "complete",
      "--path",
      collectionPath,
      "RecurringExplicit",
      "--date",
      "2026-05-10",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = readFileSync(taskPath, "utf8");
    assert.match(raw, /completeInstances:\n  - '2026-05-10'/);
  });

  await t.test("skip recurring defaults to scheduled date when explicit date omitted", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("SkipScheduled");

    mutateTaskFrontmatter(taskPath, (text) =>
      text.replace(
        /^title: SkipScheduled\n/m,
        "title: SkipScheduled\nscheduled: '2026-06-15'\nrecurrence: FREQ=DAILY\n",
      ),
    );

    const result = runCli(["skip", "--path", collectionPath, "SkipScheduled"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = readFileSync(taskPath, "utf8");
    assert.match(raw, /skippedInstances:\n  - '2026-06-15'/);
  });

  await t.test("skip recurring falls back to due date when scheduled missing", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("SkipDueFallback");

    mutateTaskFrontmatter(taskPath, (text) =>
      text.replace(
        /^title: SkipDueFallback\n/m,
        "title: SkipDueFallback\ndue: '2026-07-01'\nrecurrence: FREQ=DAILY\n",
      ),
    );

    const result = runCli(["skip", "--path", collectionPath, "SkipDueFallback"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = readFileSync(taskPath, "utf8");
    assert.match(raw, /skippedInstances:\n  - '2026-07-01'/);
  });

  await t.test("skip recurring uses explicit date over scheduled/due", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("SkipExplicit");

    mutateTaskFrontmatter(taskPath, (text) =>
      text.replace(
        /^title: SkipExplicit\n/m,
        "title: SkipExplicit\nscheduled: '2026-08-01'\ndue: '2026-08-02'\nrecurrence: FREQ=DAILY\n",
      ),
    );

    const result = runCli([
      "skip",
      "--path",
      collectionPath,
      "SkipExplicit",
      "--date",
      "2026-08-10",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = readFileSync(taskPath, "utf8");
    assert.match(raw, /skippedInstances:\n  - '2026-08-10'/);
  });
});

test("cli conformance: title fallback and matching behavior", async (t) => {
  await t.test("show resolves by basename when title field removed", () => {
    const { collectionPath, taskPath } = createBaseCollectionWithTask("FallbackName");
    mutateTaskFrontmatter(taskPath, (text) => text.replace(/^title: FallbackName\n/m, ""));

    const result = runCli(["show", "--path", collectionPath, "FallbackName"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = stripAnsi(result.stdout);
    assert.match(output, /FallbackName/);
  });

  await t.test("complete prefers exact title match over substring", () => {
    const collectionPath = makeTempDir("mtn-cli-match-");
    let result = runCli(["init", collectionPath]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = runCli(["create", "--path", collectionPath, "Deploy app"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = runCli(["create", "--path", collectionPath, "Deploy app release"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = runCli(["complete", "--path", collectionPath, "Deploy app"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = runCli(["list", "--path", collectionPath, "--status", "done", "--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const done = JSON.parse(result.stdout);
    assert.equal(done.some((t) => t.title === "Deploy app"), true);
    assert.equal(done.some((t) => t.title === "Deploy app release"), false);
  });
});
