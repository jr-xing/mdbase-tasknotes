import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, runCli, stripAnsi } from "./helpers.mjs";

test("llm configure stores provider/model but never a key", () => {
  const configDir = makeTempDir("mtn-llm-config-");
  const env = { MDBASE_TASKNOTES_CONFIG_DIR: configDir };
  let result = runCli(["llm", "configure", "--provider", "openai", "--model", "user-model"], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const raw = readFileSync(join(configDir, "config.json"), "utf8");
  assert.match(raw, /"llmProvider": "openai"/);
  assert.match(raw, /"llmModel": "user-model"/);
  assert.doesNotMatch(raw, /api.?key|secret/i);

  result = runCli(["llm", "status"], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /OPENAI_API_KEY is not set/);

  result = runCli(["llm", "test"], { env });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout + result.stderr), /OPENAI_API_KEY is not set/);
});
