import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, runCli, stripAnsi } from "./helpers.mjs";

test("llm configure saves a provider key separately from normal config", () => {
  const configDir = makeTempDir("mtn-llm-config-");
  const env = { MDBASE_TASKNOTES_CONFIG_DIR: configDir, OPENAI_API_KEY: "" };
  const result = runCli(
    ["llm", "configure", "--provider", "openai", "--model", "user-model", "--api-key", "local-secret"],
    { env },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const config = readFileSync(join(configDir, "config.json"), "utf8");
  assert.match(config, /"llmProvider": "openai"/);
  assert.match(config, /"llmModel": "user-model"/);
  assert.doesNotMatch(config, /api.?key|local-secret/i);

  const credentials = JSON.parse(readFileSync(join(configDir, "credentials.json"), "utf8"));
  assert.deepEqual(credentials, { openai: "local-secret" });

  const status = runCli(["llm", "status"], { env });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.match(stripAnsi(status.stdout), /Credential: saved/);
  assert.doesNotMatch(status.stdout + status.stderr, /local-secret/);

  const configList = runCli(["config", "--list"], { env });
  assert.equal(configList.status, 0, configList.stderr || configList.stdout);
  assert.doesNotMatch(configList.stdout + configList.stderr, /local-secret|api.?key/i);
});

test("environment credentials override saved credentials", () => {
  const configDir = makeTempDir("mtn-llm-env-");
  const baseEnv = { MDBASE_TASKNOTES_CONFIG_DIR: configDir, OPENAI_API_KEY: "" };
  const configured = runCli(
    ["llm", "configure", "--provider", "openai", "--model", "m", "--api-key", "saved-secret"],
    { env: baseEnv },
  );
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);

  const status = runCli(["llm", "status"], {
    env: { ...baseEnv, OPENAI_API_KEY: "environment-secret" },
  });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.match(stripAnsi(status.stdout), /Credential: environment/);
  assert.doesNotMatch(status.stdout + status.stderr, /saved-secret|environment-secret/);
});

test("saved credentials resolve for LLM calls and environment values take precedence", async () => {
  const configDir = makeTempDir("mtn-llm-resolve-");
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({ llmProvider: "openai", llmModel: "m" }),
  );
  writeFileSync(join(configDir, "credentials.json"), JSON.stringify({ openai: "saved-secret" }));

  const previousConfigDir = process.env.MDBASE_TASKNOTES_CONFIG_DIR;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  process.env.MDBASE_TASKNOTES_CONFIG_DIR = configDir;
  delete process.env.OPENAI_API_KEY;
  try {
    const llm = await import(`../dist/llm.js?credential-test-${Date.now()}`);
    let resolved = llm.resolveLLMSettings();
    assert.equal(resolved.settings.apiKey, "saved-secret");
    assert.equal(resolved.credentialSource, "saved");

    process.env.OPENAI_API_KEY = "environment-secret";
    resolved = llm.resolveLLMSettings();
    assert.equal(resolved.settings.apiKey, "environment-secret");
    assert.equal(resolved.credentialSource, "environment");
  } finally {
    if (previousConfigDir === undefined) delete process.env.MDBASE_TASKNOTES_CONFIG_DIR;
    else process.env.MDBASE_TASKNOTES_CONFIG_DIR = previousConfigDir;
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAIKey;
  }
});

test("provider keys can be replaced and cleared independently", () => {
  const configDir = makeTempDir("mtn-llm-lifecycle-");
  const env = { MDBASE_TASKNOTES_CONFIG_DIR: configDir, OPENAI_API_KEY: "" };
  for (const args of [
    ["llm", "configure", "--provider", "openai", "--model", "o", "--api-key", "openai-one"],
    ["llm", "configure", "--provider", "anthropic", "--model", "a", "--api-key", "anthropic-one"],
    ["llm", "configure", "--provider", "openai", "--model", "o", "--api-key", "openai-two"],
  ]) {
    const result = runCli(args, { env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  let credentials = JSON.parse(readFileSync(join(configDir, "credentials.json"), "utf8"));
  assert.deepEqual(credentials, { openai: "openai-two", anthropic: "anthropic-one" });

  const cleared = runCli(
    ["llm", "configure", "--provider", "openai", "--model", "o", "--clear-api-key"],
    { env },
  );
  assert.equal(cleared.status, 0, cleared.stderr || cleared.stdout);
  credentials = JSON.parse(readFileSync(join(configDir, "credentials.json"), "utf8"));
  assert.deepEqual(credentials, { anthropic: "anthropic-one" });
});

test("credential errors do not overwrite or disclose credential contents", () => {
  const configDir = makeTempDir("mtn-llm-errors-");
  const env = { MDBASE_TASKNOTES_CONFIG_DIR: configDir, OPENAI_API_KEY: "" };
  let result = runCli(
    ["llm", "configure", "--provider", "openai", "--model", "m", "--api-key", "secret", "--clear-api-key"],
    { env },
  );
  assert.equal(result.status, 1);
  assert.match(stripAnsi(result.stdout + result.stderr), /either --api-key or --clear-api-key/);
  assert.equal(existsSync(join(configDir, "credentials.json")), false);

  writeFileSync(join(configDir, "config.json"), JSON.stringify({ llmProvider: "openai", llmModel: "m" }));
  writeFileSync(join(configDir, "credentials.json"), '{"openai":"do-not-print"');
  result = runCli(["llm", "status"], { env });
  assert.equal(result.status, 1);
  assert.match(stripAnsi(result.stdout + result.stderr), /credentials file.*malformed/i);
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-print/);

  result = runCli(
    ["llm", "configure", "--provider", "openai", "--model", "m", "--api-key", "replacement"],
    { env },
  );
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(configDir, "credentials.json"), "utf8"), '{"openai":"do-not-print"');
});

test("missing credentials remain an offline-safe configuration state", () => {
  const configDir = makeTempDir("mtn-llm-missing-");
  const env = { MDBASE_TASKNOTES_CONFIG_DIR: configDir, GEMINI_API_KEY: "" };
  const configured = runCli(["llm", "configure", "--provider", "google", "--model", "m"], { env });
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);

  let result = runCli(["llm", "status"], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /Credential: not set/);

  result = runCli(["llm", "test"], { env });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout + result.stderr), /GEMINI_API_KEY is not set and no saved credential was found/);
});

test("credentials file uses owner-only permissions on POSIX", { skip: process.platform === "win32" }, () => {
  const configDir = makeTempDir("mtn-llm-mode-");
  const result = runCli(
    ["llm", "configure", "--provider", "openai", "--model", "m", "--api-key", "secret"],
    { env: { MDBASE_TASKNOTES_CONFIG_DIR: configDir } },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(statSync(configDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(configDir, "credentials.json")).mode & 0o777, 0o600);
});
