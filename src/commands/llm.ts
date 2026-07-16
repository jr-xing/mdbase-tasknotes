import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Writable } from "node:stream";
import { getConfig, setConfig } from "../config.js";
import { clearCredential, resolveCredential, saveCredential } from "../credentials.js";
import { PROVIDER_KEY_ENV, requestSemanticSlug, resolveLLMSettings } from "../llm.js";
import { normalizeLLMSlug } from "../naming.js";
import { showError, showSuccess } from "../format.js";
import type { LLMProvider } from "../types.js";

export async function llmConfigureCommand(options: {
  provider?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}): Promise<void> {
  if (options.apiKey !== undefined && options.clearApiKey) {
    showError("Use either --api-key or --clear-api-key, not both.");
    process.exitCode = 1;
    return;
  }
  let provider = options.provider;
  let model = options.model;
  if ((!provider || !model) && process.stdin.isTTY) {
    const rl = createInterface({ input, output });
    try {
      provider ||= await rl.question("Provider (openai/anthropic/google): ");
      model ||= await rl.question("Model name: ");
    } finally {
      rl.close();
    }
  }
  if (!provider || !["openai", "anthropic", "google"].includes(provider)) {
    showError("Provider must be openai, anthropic, or google.");
    process.exitCode = 1;
    return;
  }
  if (!model?.trim()) {
    showError("Please provide a model name.");
    process.exitCode = 1;
    return;
  }
  const typedProvider = provider as LLMProvider;
  let apiKey = options.apiKey;
  if (apiKey === undefined && !options.clearApiKey && process.stdin.isTTY) {
    apiKey = await questionHidden("API key (leave blank to keep the saved key): ");
  }

  try {
    if (options.clearApiKey) {
      clearCredential(typedProvider);
    } else if (apiKey !== undefined && apiKey.trim()) {
      saveCredential(typedProvider, apiKey);
    } else if (options.apiKey !== undefined) {
      throw new Error("API key cannot be empty.");
    }
    setConfig("llmProvider", provider);
    setConfig("llmModel", model.trim());
  } catch (error) {
    showError((error as Error).message);
    process.exitCode = 1;
    return;
  }

  showSuccess(`Configured ${provider} / ${model.trim()}`);
  if (options.clearApiKey) console.log(`Cleared the saved ${provider} API key.`);
  else if (apiKey?.trim()) console.log(`Saved the ${provider} API key locally.`);
  else console.log(`Credential unchanged. ${PROVIDER_KEY_ENV[typedProvider]} can override a saved key.`);
}

export function llmStatusCommand(): void {
  const config = getConfig();
  console.log(`Provider: ${config.llmProvider ?? "(not configured)"}`);
  console.log(`Model: ${config.llmModel ?? "(not configured)"}`);
  if (config.llmProvider) {
    const envName = PROVIDER_KEY_ENV[config.llmProvider];
    try {
      const credential = resolveCredential(config.llmProvider, envName);
      console.log(`Credential: ${credential.source}`);
    } catch (error) {
      showError((error as Error).message);
      process.exitCode = 1;
    }
  }
}

export async function llmTestCommand(): Promise<void> {
  const config = getConfig();
  if (!config.llmProvider || !config.llmModel) {
    showError("Run mtnj llm configure first.");
    process.exitCode = 1;
    return;
  }
  let resolved: ReturnType<typeof resolveLLMSettings>;
  try {
    resolved = resolveLLMSettings();
  } catch (error) {
    showError((error as Error).message);
    process.exitCode = 1;
    return;
  }
  if (!resolved.settings) {
    showError(resolved.reason ?? "LLM credential is not configured.");
    process.exitCode = 1;
    return;
  }
  try {
    const raw = await requestSemanticSlug(
      { title: "Initial attempt on dual-branch network", noteType: "task" },
      resolved.settings,
    );
    const slug = normalizeLLMSlug(raw);
    if (!slug) throw new Error(`Invalid slug returned: ${raw.slice(0, 80)}`);
    showSuccess(`LLM configuration works: ${slug}`);
  } catch (error) {
    showError((error as Error).message);
    process.exitCode = 1;
  }
}

async function questionHidden(prompt: string): Promise<string> {
  output.write(prompt);
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({ input, output: mutedOutput, terminal: true });
  try {
    return await rl.question("");
  } finally {
    rl.close();
    output.write("\n");
  }
}
