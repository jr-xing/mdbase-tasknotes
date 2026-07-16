import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "./config.js";
import type { LLMProvider } from "./types.js";

export type CredentialSource = "environment" | "saved" | "not set";

interface StoredCredentials {
  openai?: string;
  anthropic?: string;
  google?: string;
}

const PROVIDERS: LLMProvider[] = ["openai", "anthropic", "google"];

export function getCredentialsPath(): string {
  return path.join(getConfigDir(), "credentials.json");
}

export function getSavedCredential(provider: LLMProvider): string | undefined {
  return loadCredentials()[provider];
}

export function saveCredential(provider: LLMProvider, apiKey: string): void {
  const value = apiKey.trim();
  if (!value) throw new Error("API key cannot be empty.");
  const credentials = loadCredentials();
  credentials[provider] = value;
  writeCredentials(credentials);
}

export function clearCredential(provider: LLMProvider): boolean {
  const credentials = loadCredentials();
  if (!(provider in credentials)) return false;
  delete credentials[provider];
  writeCredentials(credentials);
  return true;
}

export function resolveCredential(
  provider: LLMProvider,
  environmentName: string,
): { apiKey?: string; source: CredentialSource } {
  const environmentValue = process.env[environmentName];
  if (environmentValue) return { apiKey: environmentValue, source: "environment" };
  const savedValue = getSavedCredential(provider);
  if (savedValue) return { apiKey: savedValue, source: "saved" };
  return { source: "not set" };
}

function loadCredentials(): StoredCredentials {
  const credentialsPath = getCredentialsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(credentialsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Unable to read credentials file at ${credentialsPath}.`);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    const credentials: StoredCredentials = {};
    for (const provider of PROVIDERS) {
      const value = (parsed as Record<string, unknown>)[provider];
      if (value === undefined) continue;
      if (typeof value !== "string" || !value.trim()) throw new Error("invalid credential");
      credentials[provider] = value;
    }
    return credentials;
  } catch {
    throw new Error(`Credentials file at ${credentialsPath} is malformed.`);
  }
}

function writeCredentials(credentials: StoredCredentials): void {
  const directory = getConfigDir();
  const credentialsPath = getCredentialsPath();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  restrictPermissions(directory, 0o700);

  const temporaryPath = path.join(directory, `.credentials-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(credentials, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    restrictPermissions(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, credentialsPath);
    restrictPermissions(credentialsPath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already have been renamed.
    }
    throw error;
  }
}

function restrictPermissions(targetPath: string, mode: number): void {
  if (process.platform === "win32") return;
  fs.chmodSync(targetPath, mode);
}
