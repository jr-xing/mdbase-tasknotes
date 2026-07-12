import test from "node:test";
import assert from "node:assert/strict";
import { requestSemanticSlug } from "../dist/llm.js";

const context = { title: "Initial attempt on dual-branch network", noteType: "task" };

function mockFetch(json, status = 200, capture = {}) {
  return async (url, init) => {
    capture.url = String(url);
    capture.init = init;
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

test("OpenAI adapter reads Responses API output text", async () => {
  const capture = {};
  const value = await requestSemanticSlug(context, { provider: "openai", model: "model-id", apiKey: "secret" }, mockFetch({
    output: [{ content: [{ type: "output_text", text: "dual-net-initial" }] }],
  }, 200, capture));
  assert.equal(value, "dual-net-initial");
  assert.equal(capture.url, "https://api.openai.com/v1/responses");
  assert.equal(JSON.parse(capture.init.body).model, "model-id");
});

test("Anthropic and Google adapters parse provider responses", async () => {
  assert.equal(await requestSemanticSlug(context, { provider: "anthropic", model: "m", apiKey: "secret" }, mockFetch({
    content: [{ type: "text", text: "dual-net-initial" }],
  })), "dual-net-initial");
  assert.equal(await requestSemanticSlug(context, { provider: "google", model: "m", apiKey: "secret" }, mockFetch({
    candidates: [{ content: { parts: [{ text: "dual-net-initial" }] } }],
  })), "dual-net-initial");
});

test("provider errors are secret-safe", async () => {
  await assert.rejects(
    requestSemanticSlug(context, { provider: "openai", model: "m", apiKey: "do-not-print" }, mockFetch({ error: { message: "bad model" } }, 400)),
    (error) => error.message.includes("bad model") && !error.message.includes("do-not-print"),
  );
});
