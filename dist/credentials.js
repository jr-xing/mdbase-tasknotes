// src/credentials.ts
import * as fs2 from "fs";
import * as path2 from "path";

// src/config.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
var HOME_DIR = process.env.HOME || os.homedir();
var CONFIG_DIR = process.env.MDBASE_TASKNOTES_CONFIG_DIR ? path.resolve(process.env.MDBASE_TASKNOTES_CONFIG_DIR) : path.join(HOME_DIR, ".config", "mdbase-tasknotes");
var CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
function getConfigDir() {
  return CONFIG_DIR;
}

// src/credentials.ts
var PROVIDERS = ["openai", "anthropic", "google"];
function getCredentialsPath() {
  return path2.join(getConfigDir(), "credentials.json");
}
function getSavedCredential(provider) {
  return loadCredentials()[provider];
}
function saveCredential(provider, apiKey) {
  const value = apiKey.trim();
  if (!value) throw new Error("API key cannot be empty.");
  const credentials = loadCredentials();
  credentials[provider] = value;
  writeCredentials(credentials);
}
function clearCredential(provider) {
  const credentials = loadCredentials();
  if (!(provider in credentials)) return false;
  delete credentials[provider];
  writeCredentials(credentials);
  return true;
}
function resolveCredential(provider, environmentName) {
  const environmentValue = process.env[environmentName];
  if (environmentValue) return { apiKey: environmentValue, source: "environment" };
  const savedValue = getSavedCredential(provider);
  if (savedValue) return { apiKey: savedValue, source: "saved" };
  return { source: "not set" };
}
function loadCredentials() {
  const credentialsPath = getCredentialsPath();
  let raw;
  try {
    raw = fs2.readFileSync(credentialsPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Unable to read credentials file at ${credentialsPath}.`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    const credentials = {};
    for (const provider of PROVIDERS) {
      const value = parsed[provider];
      if (value === void 0) continue;
      if (typeof value !== "string" || !value.trim()) throw new Error("invalid credential");
      credentials[provider] = value;
    }
    return credentials;
  } catch {
    throw new Error(`Credentials file at ${credentialsPath} is malformed.`);
  }
}
function writeCredentials(credentials) {
  const directory = getConfigDir();
  const credentialsPath = getCredentialsPath();
  fs2.mkdirSync(directory, { recursive: true, mode: 448 });
  restrictPermissions(directory, 448);
  const temporaryPath = path2.join(directory, `.credentials-${process.pid}-${Date.now()}.tmp`);
  try {
    fs2.writeFileSync(temporaryPath, JSON.stringify(credentials, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 384
    });
    restrictPermissions(temporaryPath, 384);
    fs2.renameSync(temporaryPath, credentialsPath);
    restrictPermissions(credentialsPath, 384);
  } catch (error) {
    try {
      fs2.unlinkSync(temporaryPath);
    } catch {
    }
    throw error;
  }
}
function restrictPermissions(targetPath, mode) {
  if (process.platform === "win32") return;
  fs2.chmodSync(targetPath, mode);
}
export {
  clearCredential,
  getCredentialsPath,
  getSavedCredential,
  resolveCredential,
  saveCredential
};
