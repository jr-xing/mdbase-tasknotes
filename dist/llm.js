// src/config.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
var HOME_DIR = process.env.HOME || os.homedir();
var CONFIG_DIR = process.env.MDBASE_TASKNOTES_CONFIG_DIR ? path.resolve(process.env.MDBASE_TASKNOTES_CONFIG_DIR) : path.join(HOME_DIR, ".config", "mdbase-tasknotes");
var CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
var DEFAULT_CONFIG = {
  collectionPath: null,
  language: "en",
  llmProvider: null,
  llmModel: null
};
function load() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function getConfig() {
  return load();
}

// src/llm.ts
var PROVIDER_KEY_ENV = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY"
};
function resolveLLMSettings() {
  const config = getConfig();
  if (!config.llmProvider || !config.llmModel) {
    return { reason: "LLM provider/model not configured" };
  }
  const envName = PROVIDER_KEY_ENV[config.llmProvider];
  const apiKey = process.env[envName];
  if (!apiKey) return { reason: `${envName} is not set` };
  return { settings: { provider: config.llmProvider, model: config.llmModel, apiKey } };
}
async function requestSemanticSlug(context, settings, fetchImpl = fetch) {
  const prompt = buildPrompt(context);
  const signal = AbortSignal.timeout(3e4);
  let response;
  if (settings.provider === "openai") {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        input: prompt,
        reasoning: { effort: "none" },
        max_output_tokens: 40,
        store: false
      }),
      signal
    });
    const json2 = await readJson(response);
    ensureOk(response, json2);
    return readOpenAIText(json2);
  }
  if (settings.provider === "anthropic") {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 40,
        messages: [{ role: "user", content: prompt }]
      }),
      signal
    });
    const json2 = await readJson(response);
    ensureOk(response, json2);
    const content = Array.isArray(json2.content) ? json2.content : [];
    return content.filter((item) => item?.type === "text").map((item) => item.text).join("");
  }
  response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": settings.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
      signal
    }
  );
  const json = await readJson(response);
  ensureOk(response, json);
  return (json.candidates?.[0]?.content?.parts ?? []).map((part) => part?.text ?? "").join("");
}
function buildPrompt(context) {
  const lines = [
    "Return only a lowercase ASCII kebab-case filename slug.",
    "Use 2-4 distinguishing words and no more than 28 characters.",
    "Keep meaningful technical terms; omit filler words. Do not explain.",
    `Type: ${context.noteType}`,
    `Title: ${context.title}`
  ];
  if (context.parentTitle) lines.push(`Parent: ${context.parentTitle}`);
  if (context.projectTitle) lines.push(`Project: ${context.projectTitle}`);
  return lines.join("\n");
}
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`Provider returned non-JSON response (HTTP ${response.status})`);
  }
}
function ensureOk(response, json) {
  if (response.ok) return;
  const message = json?.error?.message || json?.message || `HTTP ${response.status}`;
  throw new Error(`Provider request failed: ${String(message).slice(0, 300)}`);
}
function readOpenAIText(json) {
  if (typeof json.output_text === "string") return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  return output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).filter((item) => item?.type === "output_text").map((item) => item.text ?? "").join("");
}
export {
  PROVIDER_KEY_ENV,
  requestSemanticSlug,
  resolveLLMSettings
};
