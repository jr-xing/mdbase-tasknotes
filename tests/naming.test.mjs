import test from "node:test";
import assert from "node:assert/strict";
import {
  fallbackSlug,
  normalizeLLMSlug,
  compactStem,
  resolveNamingDate,
  generateSlug,
} from "../dist/naming.js";

test("fallback naming uses the first three words when they fit", () => {
  assert.equal(fallbackSlug("Initial attempt on dual-branch network"), "initial-attempt-on");
  assert.equal(fallbackSlug("Budget review"), "budget-review");
  assert.equal(fallbackSlug("Deploy"), "deploy");
});

test("fallback naming drops to two or one words to stay within the limit", () => {
  assert.equal(fallbackSlug("electrocardiographically impossible third"), "electrocardiographically");
  assert.ok(fallbackSlug("alpha extraordinarilylongword third").length <= 28);
});

test("fallback naming sanitizes punctuation, accents, unicode-only, and empty input", () => {
  assert.equal(fallbackSlug("Café / dual-network: rerun"), "cafe-dual-network");
  assert.equal(fallbackSlug("心脏 配准"), "untitled");
  assert.equal(fallbackSlug("<>:*?"), "untitled");
  assert.equal(fallbackSlug("CON"), "con-note");
});

test("LLM slug validation enforces portable 2-4 word output", () => {
  assert.equal(normalizeLLMSlug("`Dual Network Initial`"), "dual-network-initial");
  assert.equal(normalizeLLMSlug("one"), null);
  assert.equal(normalizeLLMSlug("one-two-three-four-five"), null);
  assert.equal(normalizeLLMSlug("a".repeat(29) + "-b"), null);
});

test("compact stems and naming dates are stable", () => {
  assert.equal(compactStem("task", "2026-06-24", "dual-net"), "2026-06-24-T-dual-net");
  assert.equal(compactStem("project", "2026-05-17", "onemorph"), "2026-05-17-P-onemorph");
  assert.equal(resolveNamingDate({ dateCreated: "2026-04-03T12:00:00Z" }, "tasks/x.md"), "2026-04-03");
  assert.equal(resolveNamingDate({}, "tasks/2025-09-02-TASK old.md"), "2025-09-02");
});

test("LLM success is persisted as semantic while provider failure falls back", async () => {
  const settings = { provider: "openai", model: "m", apiKey: "secret" };
  const success = await generateSlug(
    { title: "Initial attempt on dual branch", noteType: "task" },
    { settings, fetchImpl: async () => new Response(JSON.stringify({ output_text: "dual-branch-initial" }), { status: 200 }) },
  );
  assert.deepEqual(success, { slug: "dual-branch-initial", source: "llm" });

  const fallback = await generateSlug(
    { title: "Initial attempt on dual branch", noteType: "task" },
    { settings, fetchImpl: async () => new Response(JSON.stringify({ error: { message: "bad model" } }), { status: 400 }) },
  );
  assert.equal(fallback.slug, "initial-attempt-on");
  assert.equal(fallback.source, "fallback");
  assert.match(fallback.warning, /bad model/);
});
