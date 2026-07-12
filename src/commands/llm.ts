import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getConfig, setConfig } from "../config.js";
import { PROVIDER_KEY_ENV, requestSemanticSlug } from "../llm.js";
import { normalizeLLMSlug } from "../naming.js";
import { showError, showSuccess } from "../format.js";
import type { LLMProvider } from "../types.js";

export async function llmConfigureCommand(options: { provider?: string; model?: string }): Promise<void> {
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
  setConfig("llmProvider", provider);
  setConfig("llmModel", model.trim());
  showSuccess(`Configured ${provider} / ${model.trim()}`);
  console.log(`Set ${PROVIDER_KEY_ENV[provider as LLMProvider]} in your environment to enable LLM naming.`);
}

export function llmStatusCommand(): void {
  const config = getConfig();
  console.log(`Provider: ${config.llmProvider ?? "(not configured)"}`);
  console.log(`Model: ${config.llmModel ?? "(not configured)"}`);
  if (config.llmProvider) {
    const envName = PROVIDER_KEY_ENV[config.llmProvider];
    console.log(`Credential: ${envName} ${process.env[envName] ? "is set" : "is not set"}`);
  }
}

export async function llmTestCommand(): Promise<void> {
  const config = getConfig();
  if (!config.llmProvider || !config.llmModel) {
    showError("Run mtnj llm configure first.");
    process.exitCode = 1;
    return;
  }
  const envName = PROVIDER_KEY_ENV[config.llmProvider];
  const apiKey = process.env[envName];
  if (!apiKey) {
    showError(`${envName} is not set.`);
    process.exitCode = 1;
    return;
  }
  try {
    const raw = await requestSemanticSlug(
      { title: "Initial attempt on dual-branch network", noteType: "task" },
      { provider: config.llmProvider, model: config.llmModel, apiKey },
    );
    const slug = normalizeLLMSlug(raw);
    if (!slug) throw new Error(`Invalid slug returned: ${raw.slice(0, 80)}`);
    showSuccess(`LLM configuration works: ${slug}`);
  } catch (error) {
    showError((error as Error).message);
    process.exitCode = 1;
  }
}
