import type { LLMProvider } from "./types.js";
import { getConfig } from "./config.js";
import { resolveCredential, type CredentialSource } from "./credentials.js";

export interface SlugPromptContext {
  title: string;
  noteType: "task" | "project";
  parentTitle?: string;
  projectTitle?: string;
}

export interface LLMSettings {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

export const PROVIDER_KEY_ENV: Record<LLMProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
};

export function resolveLLMSettings(): { settings?: LLMSettings; reason?: string; credentialSource?: CredentialSource } {
  const config = getConfig();
  if (!config.llmProvider || !config.llmModel) {
    return { reason: "LLM provider/model not configured" };
  }
  const envName = PROVIDER_KEY_ENV[config.llmProvider];
  const credential = resolveCredential(config.llmProvider, envName);
  if (!credential.apiKey) return { reason: `${envName} is not set and no saved credential was found` };
  return {
    settings: { provider: config.llmProvider, model: config.llmModel, apiKey: credential.apiKey },
    credentialSource: credential.source,
  };
}

export async function requestSemanticSlug(
  context: SlugPromptContext,
  settings: LLMSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const prompt = buildPrompt(context);
  const signal = AbortSignal.timeout(30_000);
  let response: Response;

  if (settings.provider === "openai") {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        input: prompt,
        reasoning: { effort: "none" },
        max_output_tokens: 40,
        store: false,
      }),
      signal,
    });
    const json = await readJson(response);
    ensureOk(response, json);
    return readOpenAIText(json);
  }

  if (settings.provider === "anthropic") {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 40,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });
    const json = await readJson(response);
    ensureOk(response, json);
    const content = Array.isArray(json.content) ? json.content : [];
    return content.filter((item: any) => item?.type === "text").map((item: any) => item.text).join("");
  }

  response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": settings.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
      signal,
    },
  );
  const json = await readJson(response);
  ensureOk(response, json);
  return (json.candidates?.[0]?.content?.parts ?? []).map((part: any) => part?.text ?? "").join("");
}

function buildPrompt(context: SlugPromptContext): string {
  const lines = [
    "Return only a lowercase ASCII kebab-case filename slug.",
    "Use 2-4 distinguishing words and no more than 28 characters.",
    "Keep meaningful technical terms; omit filler words. Do not explain.",
    `Type: ${context.noteType}`,
    `Title: ${context.title}`,
  ];
  if (context.parentTitle) lines.push(`Parent: ${context.parentTitle}`);
  if (context.projectTitle) lines.push(`Project: ${context.projectTitle}`);
  return lines.join("\n");
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    throw new Error(`Provider returned non-JSON response (HTTP ${response.status})`);
  }
}

function ensureOk(response: Response, json: any): void {
  if (response.ok) return;
  const message = json?.error?.message || json?.message || `HTTP ${response.status}`;
  throw new Error(`Provider request failed: ${String(message).slice(0, 300)}`);
}

function readOpenAIText(json: any): string {
  if (typeof json.output_text === "string") return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  return output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item.text ?? "")
    .join("");
}
