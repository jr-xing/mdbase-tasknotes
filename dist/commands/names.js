// src/commands/names.ts
import { basename as basename8 } from "path";
import chalk4 from "chalk";

// src/collection.ts
import { Collection } from "@callumalpass/mdbase";
import { basename as basename2 } from "path";

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
function getConfigDir() {
  return CONFIG_DIR;
}
function resolveUserPath(userPath) {
  return path.resolve(expandHomeDirectory(userPath));
}
function resolveCollectionPath(flagPath) {
  if (flagPath) return resolveUserPath(flagPath);
  const envPath = process.env.MDBASE_TASKNOTES_PATH;
  if (envPath) return resolveUserPath(envPath);
  const config = load();
  if (config.collectionPath) return resolveUserPath(config.collectionPath);
  return process.cwd();
}
function expandHomeDirectory(userPath) {
  const homeDirectory = HOME_DIR;
  if (userPath === "~") {
    return homeDirectory;
  }
  if (userPath.startsWith("~/") || userPath.startsWith("~\\")) {
    return path.join(homeDirectory, userPath.slice(2));
  }
  return userPath;
}

// src/field-mapping.ts
import { loadConfig, getType } from "@callumalpass/mdbase";
import { basename } from "path";
var ALL_ROLES = [
  "title",
  "status",
  "priority",
  "due",
  "scheduled",
  "completedDate",
  "tags",
  "contexts",
  "projects",
  "timeEstimate",
  "dateCreated",
  "dateModified",
  "recurrence",
  "recurrenceAnchor",
  "completeInstances",
  "skippedInstances",
  "timeEntries"
];
function defaultFieldMapping() {
  const roleToField = {};
  const fieldToRole = {};
  for (const role of ALL_ROLES) {
    roleToField[role] = role;
    fieldToRole[role] = role;
  }
  return {
    roleToField,
    fieldToRole,
    displayNameKey: "title",
    completedStatuses: ["done", "cancelled"]
  };
}
function buildFieldMapping(fields, displayNameKey) {
  const roleToField = {};
  const fieldToRole = {};
  const rolesSet = new Set(ALL_ROLES);
  for (const [fieldName, def] of Object.entries(fields)) {
    if (def && typeof def === "object" && typeof def.tn_role === "string") {
      const role = def.tn_role;
      if (!rolesSet.has(role)) continue;
      if (roleToField[role] !== void 0) {
        console.warn(`[mtnj] Duplicate tn_role "${role}" on field "${fieldName}", ignoring.`);
        continue;
      }
      roleToField[role] = fieldName;
      fieldToRole[fieldName] = role;
    }
  }
  for (const role of ALL_ROLES) {
    if (roleToField[role] === void 0) {
      if (fields[role] !== void 0) {
        roleToField[role] = role;
        if (fieldToRole[role] === void 0) {
          fieldToRole[role] = role;
        }
      } else {
        roleToField[role] = role;
      }
    }
  }
  const completedStatuses = inferCompletedStatuses(fields, roleToField.status);
  return {
    roleToField,
    fieldToRole,
    displayNameKey: displayNameKey && typeof displayNameKey === "string" && displayNameKey.trim().length > 0 ? displayNameKey : roleToField.title,
    completedStatuses
  };
}
function inferCompletedStatuses(fields, statusFieldName) {
  const statusDef = fields[statusFieldName];
  if (!statusDef || typeof statusDef !== "object") {
    return ["done", "cancelled"];
  }
  if (Array.isArray(statusDef.tn_completed_values)) {
    const explicit = statusDef.tn_completed_values.filter((v) => typeof v === "string").map((v) => v.trim()).filter((v) => v.length > 0);
    if (explicit.length > 0) return explicit;
  }
  if (Array.isArray(statusDef.values)) {
    const inferred = statusDef.values.filter((v) => typeof v === "string").filter((v) => {
      const lower = v.toLowerCase();
      return lower.includes("done") || lower.includes("complete") || lower.includes("cancel") || lower.includes("finish");
    });
    if (inferred.length > 0) return inferred;
  }
  return ["done", "cancelled"];
}
async function loadFieldMapping(flagPath) {
  try {
    const collectionPath = resolveCollectionPath(flagPath);
    const configResult = await loadConfig(collectionPath);
    if (!configResult.valid || !configResult.config) {
      return defaultFieldMapping();
    }
    const typeResult = await getType(collectionPath, configResult.config, "task");
    if (!typeResult.valid || !typeResult.type) {
      return defaultFieldMapping();
    }
    const displayNameKey = typeof typeResult.type.display_name_key === "string" ? typeResult.type.display_name_key : typeof typeResult.type.displayNameKey === "string" ? typeResult.type.displayNameKey : void 0;
    return buildFieldMapping(typeResult.type.fields || {}, displayNameKey);
  } catch {
    return defaultFieldMapping();
  }
}

// src/collection.ts
async function openCollection(flagPath) {
  const collectionPath = resolveCollectionPath(flagPath);
  const { collection, error } = await Collection.open(collectionPath);
  if (error) {
    throw new Error(`Failed to open collection at ${collectionPath}: ${error.message}`);
  }
  return collection;
}
async function withCollection(fn, flagPath) {
  const collection = await openCollection(flagPath);
  const mapping = await loadFieldMapping(flagPath);
  try {
    return await fn(collection, mapping);
  } finally {
    await collection.close();
  }
}

// src/naming.ts
import { basename as basename3, join as join3 } from "path";
import { statSync } from "fs";
import { format } from "date-fns";

// src/credentials.ts
import * as fs2 from "fs";
import * as path2 from "path";
var PROVIDERS = ["openai", "anthropic", "google"];
function getCredentialsPath() {
  return path2.join(getConfigDir(), "credentials.json");
}
function getSavedCredential(provider) {
  return loadCredentials()[provider];
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
  const credential = resolveCredential(config.llmProvider, envName);
  if (!credential.apiKey) return { reason: `${envName} is not set and no saved credential was found` };
  return {
    settings: { provider: config.llmProvider, model: config.llmModel, apiKey: credential.apiKey },
    credentialSource: credential.source
  };
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

// src/naming.ts
var FILENAME_SCHEMA = "compact-v1";
var MAX_SLUG_LENGTH = 28;
function fallbackSlug(title) {
  const words = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return "untitled";
  const three = words.slice(0, 3).join("-");
  if (three.length <= MAX_SLUG_LENGTH) return avoidReservedName(three);
  const two = words.slice(0, 2).join("-");
  if (two.length <= MAX_SLUG_LENGTH) return avoidReservedName(two);
  return avoidReservedName(words[0].slice(0, MAX_SLUG_LENGTH) || "untitled");
}
function normalizeLLMSlug(value) {
  const cleaned = value.trim().replace(/^```[a-z]*\s*|\s*```$/gi, "").replace(/^['"`]+|['"`]+$/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned.length > MAX_SLUG_LENGTH) return null;
  const words = cleaned.split("-").filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  return cleaned;
}
async function generateSlug(context, overrides) {
  const resolved = overrides?.settings ? { settings: overrides.settings } : resolveLLMSettings();
  if (!resolved.settings) {
    return {
      slug: fallbackSlug(context.title),
      source: "fallback",
      warning: resolved.reason === "LLM provider/model not configured" ? void 0 : resolved.reason
    };
  }
  try {
    const raw = await requestSemanticSlug(context, resolved.settings, overrides?.fetchImpl);
    const slug = normalizeLLMSlug(raw);
    if (!slug) throw new Error("Provider returned an invalid slug");
    return { slug, source: "llm" };
  } catch (error) {
    return {
      slug: fallbackSlug(context.title),
      source: "fallback",
      warning: error.message
    };
  }
}
function compactStem(noteType, date, slug) {
  return `${date}-${noteType === "project" ? "P" : "T"}-${slug}`;
}
function resolveNamingDate(frontmatter, notePath, collectionRoot) {
  const created = typeof frontmatter.dateCreated === "string" ? frontmatter.dateCreated : "";
  const createdMatch = created.match(/^(\d{4}-\d{2}-\d{2})/);
  if (createdMatch) return createdMatch[1];
  const nameMatch = basename3(notePath).match(/^(\d{4}-\d{2}-\d{2})/);
  if (nameMatch) return nameMatch[1];
  if (collectionRoot) {
    try {
      const stat = statSync(join3(collectionRoot, notePath));
      const date = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
      return format(date, "yyyy-MM-dd");
    } catch {
    }
  }
  return format(/* @__PURE__ */ new Date(), "yyyy-MM-dd");
}
function readStoredSlug(frontmatter) {
  const value = frontmatter.file_slug;
  if (typeof value !== "string") return null;
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  return cleaned || null;
}
function avoidReservedName(slug) {
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return reserved.test(slug) ? `${slug}-note` : slug;
}
function desiredCompactStem(noteType, frontmatter, notePath, collectionRoot) {
  const slug = readStoredSlug(frontmatter);
  if (!slug) return null;
  return compactStem(noteType, resolveNamingDate(frontmatter, notePath, collectionRoot), slug);
}

// src/format.ts
import chalk from "chalk";
import { format as fmtDate, isPast, parseISO as parseISO2, differenceInMinutes } from "date-fns";
import { basename as basename4 } from "path";

// src/date.ts
import { isValid, parseISO } from "date-fns";

// src/format.ts
var PRIORITY_COLORS = {
  urgent: chalk.red,
  high: chalk.red,
  normal: chalk.yellow,
  low: chalk.green
};
function showError(msg) {
  console.error(chalk.red("\u2717") + " " + msg);
}
function showWarning(msg) {
  console.log(chalk.yellow("\u26A0") + " " + msg);
}

// src/commands/organize.ts
import chalk3 from "chalk";
import { basename as basename7, dirname as dirname3, join as join5, relative as relative2, resolve as resolve3 } from "path";
import { existsSync as existsSync2, mkdirSync as mkdirSync4, readdirSync as readdirSync2, rmdirSync } from "fs";

// src/project-resolver.ts
import { basename as basename5, dirname } from "path";
async function buildResolverContext(collection) {
  const coll = collection;
  if (typeof coll.scanFiles !== "function" || typeof coll.buildFileCache !== "function" || typeof coll.scanAllFiles !== "function" || typeof coll.buildNonMarkdownSet !== "function") {
    return null;
  }
  try {
    const files = await coll.scanFiles();
    const fileCache = await coll.buildFileCache(files);
    const allFiles = await coll.scanAllFiles();
    const nonMdSet = coll.buildNonMarkdownSet(allFiles);
    return { files, fileCache, nonMdSet };
  } catch {
    return null;
  }
}
function resolveLinkToPath(collection, sourcePath, rawLink, resolverContext) {
  try {
    const coll = collection;
    if (resolverContext && typeof coll.resolveLinkFullWithFiles === "function") {
      const resolution = coll.resolveLinkFullWithFiles(
        rawLink,
        sourcePath,
        resolverContext.files,
        void 0,
        resolverContext.fileCache,
        resolverContext.nonMdSet
      );
      const resolvedPath = resolution?.resolved;
      if (typeof resolvedPath === "string" && resolvedPath.length > 0) {
        return resolvedPath;
      }
    }
  } catch {
  }
  return null;
}

// src/commands/organize-attachments.ts
import chalk2 from "chalk";
import { basename as basename6, dirname as dirname2, join as join4, relative, resolve as resolve2 } from "path";
import {
  existsSync,
  mkdirSync as mkdirSync3,
  readdirSync,
  renameSync as renameSync2,
  readFileSync as readFileSync3,
  writeFileSync as writeFileSync3
} from "fs";
var OWNED_NOTE_TYPES = /* @__PURE__ */ new Set(["task-card", "prompt-note", "copilot-conversation"]);
var OWNED_NOTE_FALLBACK_FOLDER = {
  "task-card": "task-cards",
  "prompt-note": "prompts",
  "copilot-conversation": "copilot-conversations"
};
function walkMdFiles(root) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join4(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        results.push(relative(root, full).replace(/\\/g, "/"));
      }
    }
  }
  walk(root);
  return results;
}
function parseBodyLinks(body) {
  const results = [];
  const wikiRe = /!?\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = wikiRe.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) results.push({ target, syntax: "wikilink" });
  }
  const mdRe = /!?\[[^\]]*\]\(([^)#\s]+)(?:#[^)]+)?\)/g;
  while ((m = mdRe.exec(body)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
    results.push({ target, syntax: "markdown" });
  }
  return results;
}
function noteVirtualDir(desiredPath) {
  const dir = dirname2(desiredPath).replace(/\\/g, "/");
  const stem = basename6(desiredPath, ".md");
  if (basename6(dir) === stem) return dir;
  return dir === "." ? stem : `${dir}/${stem}`;
}
function computeLCAOfDirs(dirs) {
  if (dirs.length === 0) return ".";
  if (dirs.length === 1) return dirs[0];
  const parts = dirs.map((d) => d === "." ? [] : d.split("/"));
  const shortest = parts.reduce((a, b) => a.length < b.length ? a : b);
  const lca = [];
  for (let i = 0; i < shortest.length; i++) {
    if (parts.every((p) => p[i] === shortest[i])) lca.push(shortest[i]);
    else break;
  }
  return lca.length > 0 ? lca.join("/") : ".";
}
async function getTypeFromCache(collection, notePath, cache) {
  if (cache.has(notePath)) return cache.get(notePath);
  try {
    const r = await collection.read(notePath);
    if (!r.error && r.frontmatter) {
      const t = r.frontmatter.type;
      const typeStr = typeof t === "string" ? t : null;
      cache.set(notePath, typeStr);
      return typeStr;
    }
  } catch {
  }
  cache.set(notePath, null);
  return null;
}
function addRef(map, key, value) {
  const s = map.get(key) ?? /* @__PURE__ */ new Set();
  s.add(value);
  map.set(key, s);
}
async function scanAttachments(collection, collectionRoot, desiredPaths, resolverContext) {
  const binaryRefs = /* @__PURE__ */ new Map();
  const ownedNoteRefs = /* @__PURE__ */ new Map();
  const ownedNoteTypes = /* @__PURE__ */ new Map();
  const typeCache = /* @__PURE__ */ new Map();
  const allMd = walkMdFiles(collectionRoot).filter((p) => !p.startsWith("_types/"));
  for (const notePath of allMd) {
    let body;
    try {
      const r = await collection.read(notePath);
      if (r.error || !r.body) continue;
      body = r.body;
    } catch {
      continue;
    }
    const noteDesiredPath = desiredPaths.get(notePath) ?? notePath;
    const links = parseBodyLinks(body);
    for (const link of links) {
      if (link.syntax === "markdown") {
        const noteAbsDir = resolve2(collectionRoot, dirname2(notePath));
        const targetAbs = resolve2(noteAbsDir, link.target);
        if (!existsSync(targetAbs)) continue;
        const targetRel = relative(collectionRoot, targetAbs).replace(/\\/g, "/");
        if (targetRel.startsWith("..") || targetRel.startsWith("_types/")) continue;
        if (targetRel.endsWith(".md")) {
          const t = await getTypeFromCache(collection, targetRel, typeCache);
          if (t && OWNED_NOTE_TYPES.has(t)) {
            addRef(ownedNoteRefs, targetRel, noteDesiredPath);
            ownedNoteTypes.set(targetRel, t);
          }
        } else {
          addRef(binaryRefs, targetRel, noteDesiredPath);
        }
      } else {
        const resolved = resolveLinkToPath(
          collection,
          notePath,
          `[[${link.target}]]`,
          resolverContext
        );
        if (resolved) {
          const resolvedNorm = resolved.replace(/\\/g, "/");
          if (resolvedNorm.endsWith(".md")) {
            const t = await getTypeFromCache(collection, resolvedNorm, typeCache);
            if (t && OWNED_NOTE_TYPES.has(t)) {
              addRef(ownedNoteRefs, resolvedNorm, noteDesiredPath);
              ownedNoteTypes.set(resolvedNorm, t);
            }
          } else {
            addRef(binaryRefs, resolvedNorm, noteDesiredPath);
          }
        } else if (!link.target.endsWith(".md")) {
          if (resolverContext?.nonMdSet) {
            const fname = basename6(link.target);
            for (const nonMdPath of resolverContext.nonMdSet) {
              const nonMdStr = nonMdPath.replace(/\\/g, "/");
              if (basename6(nonMdStr) === fname) {
                addRef(binaryRefs, nonMdStr, noteDesiredPath);
                break;
              }
            }
          }
        }
      }
    }
  }
  return { binaryRefs, ownedNoteRefs, ownedNoteTypes };
}
function planAttachmentMoves(scanResult, desiredPaths, collectionRoot = "") {
  const binaryMoves = [];
  const stationaryBinaries = [];
  const ownedNoteMoves = [];
  const promotionMoves = [];
  const warnings = [];
  const promotedPaths = /* @__PURE__ */ new Map();
  const plannedBinaryTargets = /* @__PURE__ */ new Map();
  const participantRefPaths = new Set(desiredPaths.values());
  function maybePromote(desiredNotePath) {
    if (promotedPaths.has(desiredNotePath)) return;
    const actualDir = dirname2(desiredNotePath).replace(/\\/g, "/");
    const vdir = noteVirtualDir(desiredNotePath);
    if (vdir === actualDir) return;
    const stem = basename6(desiredNotePath, ".md");
    const promotedTo = `${vdir}/${stem}.md`;
    promotedPaths.set(desiredNotePath, promotedTo);
    promotionMoves.push({ from: desiredNotePath, to: promotedTo });
  }
  const ownedNoteTargets = /* @__PURE__ */ new Map();
  for (const [ownedPath, refsSet] of scanResult.ownedNoteRefs) {
    const refs = [...refsSet];
    const participantRefs = refs.filter((r) => participantRefPaths.has(r));
    if (participantRefs.length === 0) continue;
    const virtualDirs = participantRefs.map(noteVirtualDir);
    const lca = computeLCAOfDirs(virtualDirs);
    const fname = basename6(ownedPath);
    const noteType = scanResult.ownedNoteTypes.get(ownedPath) ?? "";
    const fallbackFolder = OWNED_NOTE_FALLBACK_FOLDER[noteType];
    const desiredTo = lca === "." && fallbackFolder ? `${fallbackFolder}/${fname}` : lca === "." ? fname : `${lca}/${fname}`;
    const normalized = ownedPath.replace(/\\/g, "/");
    if (normalized !== desiredTo) {
      const organizeTarget = desiredPaths.get(normalized)?.replace(/\\/g, "/");
      if (organizeTarget !== desiredTo) {
        ownedNoteTargets.set(normalized, desiredTo);
      }
    }
  }
  for (const [binaryPath, refsSet] of scanResult.binaryRefs) {
    const refs = [...refsSet];
    const effectiveRefs = refs.map((ref) => ownedNoteTargets.get(ref) ?? ref);
    const participantEffectiveRefs = effectiveRefs.filter((_, i) => participantRefPaths.has(refs[i]));
    if (participantEffectiveRefs.length === 0) continue;
    const fname = basename6(binaryPath);
    const projectRoots = new Set(
      participantEffectiveRefs.map(projectRootForPath).filter((value) => Boolean(value))
    );
    let desiredTo;
    if (projectRoots.size === 1) {
      const projectRoot = [...projectRoots][0];
      const ownerBucket = participantEffectiveRefs.length === 1 ? basename6(participantEffectiveRefs[0], ".md") : "_shared";
      desiredTo = `${projectRoot}/_assets/${ownerBucket}/${fname}`;
    } else {
      desiredTo = `_assets/_shared/${fname}`;
    }
    const normalized = binaryPath.replace(/\\/g, "/");
    if (normalized === desiredTo) continue;
    if (plannedBinaryTargets.has(desiredTo) && plannedBinaryTargets.get(desiredTo) !== normalized) {
      warnings.push(`Collision: "${fname}" from multiple sources at "${desiredTo}" \u2014 skipping "${normalized}"`);
      stationaryBinaries.push({ path: normalized, referencingNotes: refs });
      continue;
    }
    const absoluteTarget = collectionRoot ? join4(collectionRoot, desiredTo) : desiredTo;
    if (absoluteTarget.length > 220) {
      warnings.push(`Path exceeds 220 characters: "${desiredTo}" \u2014 skipping "${normalized}"`);
      stationaryBinaries.push({ path: normalized, referencingNotes: refs });
      continue;
    }
    plannedBinaryTargets.set(desiredTo, normalized);
    binaryMoves.push({ from: normalized, to: desiredTo, referencingNotes: refs });
  }
  for (const [ownedPath, refsSet] of scanResult.ownedNoteRefs) {
    const refs = [...refsSet];
    const participantRefs = refs.filter((r) => participantRefPaths.has(r));
    if (participantRefs.length === 0) continue;
    const virtualDirs = participantRefs.map(noteVirtualDir);
    const lca = computeLCAOfDirs(virtualDirs);
    const fname = basename6(ownedPath);
    const noteType = scanResult.ownedNoteTypes.get(ownedPath) ?? "";
    const fallbackFolder = OWNED_NOTE_FALLBACK_FOLDER[noteType];
    const desiredTo = lca === "." && fallbackFolder ? `${fallbackFolder}/${fname}` : lca === "." ? fname : `${lca}/${fname}`;
    const normalized = ownedPath.replace(/\\/g, "/");
    if (normalized === desiredTo) continue;
    const organizeTarget = desiredPaths.get(normalized)?.replace(/\\/g, "/");
    if (organizeTarget === desiredTo) continue;
    for (const ref of participantRefs) {
      maybePromote(ref);
    }
    ownedNoteMoves.push({ from: normalized, to: desiredTo, noteType: noteType || "owned", referencingNotes: refs });
  }
  return { binaryMoves, stationaryBinaries, ownedNoteMoves, promotionMoves, warnings };
}
function printAttachmentDryRun(plan) {
  const totalMoves = plan.binaryMoves.length + plan.ownedNoteMoves.length + plan.promotionMoves.length;
  if (totalMoves === 0) {
    console.log(chalk2.green("  Attachments: all in correct location."));
    return;
  }
  console.log(chalk2.bold("\nAttachment plan:\n"));
  if (plan.promotionMoves.length > 0) {
    console.log(
      chalk2.blue.bold("[Note promotions]") + chalk2.dim(` ${plan.promotionMoves.length} note(s)`)
    );
    for (const m of plan.promotionMoves) {
      console.log(chalk2.dim("  ") + m.from);
      console.log(chalk2.dim("    \u2192 ") + chalk2.green(m.to));
    }
    console.log();
  }
  const allMoves = [
    ...plan.ownedNoteMoves.map((m) => ({ ...m, kind: "owned" })),
    ...plan.binaryMoves.map((m) => ({ ...m, kind: "binary" }))
  ];
  if (allMoves.length > 0) {
    const byFolder = /* @__PURE__ */ new Map();
    for (const m of allMoves) {
      const parts = m.to.split("/");
      const folder = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
      const g = byFolder.get(folder) ?? [];
      g.push(m);
      byFolder.set(folder, g);
    }
    for (const [folder, moves] of [...byFolder.entries()].sort()) {
      console.log(
        chalk2.blue.bold(`[${folder}]`) + chalk2.dim(` ${moves.length} file(s)`)
      );
      for (const m of moves) {
        const label = m.kind === "owned" ? chalk2.cyan(` [${m.noteType}]`) : "";
        console.log(chalk2.dim("  ") + m.from + label);
        console.log(chalk2.dim("    \u2192 ") + chalk2.green(m.to));
        if (m.referencingNotes.length > 0) {
          const names = m.referencingNotes.map((n) => basename6(n)).join(", ");
          console.log(chalk2.dim(`      (referenced by: ${names})`));
        }
      }
      console.log();
    }
  }
  if (plan.warnings.length > 0) {
    console.log(chalk2.yellow("Attachment warnings:"));
    for (const w of plan.warnings) {
      console.log(chalk2.yellow(`  \u26A0 ${w}`));
    }
  }
}
async function executeAttachmentMoves(collection, collectionRoot, plan) {
  let succeeded = 0;
  let failed = 0;
  const promotedFinalPaths = /* @__PURE__ */ new Map();
  for (const m of plan.promotionMoves) {
    promotedFinalPaths.set(m.from, m.to);
  }
  for (const move of plan.promotionMoves) {
    try {
      mkdirSync3(dirname2(join4(collectionRoot, move.to)), { recursive: true });
      await collection.rename({ from: move.from, to: move.to, update_refs: true });
      console.log(
        chalk2.green("  \u2713 ") + chalk2.dim(`[promote] ${move.from}`) + chalk2.dim(" \u2192 ") + move.to
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk2.red("  \u2717 ") + `[promote] ${move.from}` + chalk2.red(` (${err.message})`)
      );
      failed++;
    }
  }
  for (const move of plan.ownedNoteMoves) {
    try {
      mkdirSync3(dirname2(join4(collectionRoot, move.to)), { recursive: true });
      await collection.rename({ from: move.from, to: move.to, update_refs: true });
      console.log(
        chalk2.green("  \u2713 ") + chalk2.dim(`[${move.noteType}] ${move.from}`) + chalk2.dim(" \u2192 ") + move.to
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk2.red("  \u2717 ") + `[${move.noteType}] ${move.from}` + chalk2.red(` (${err.message})`)
      );
      failed++;
    }
  }
  const finalBinaryPaths = /* @__PURE__ */ new Map();
  for (const stationary of plan.stationaryBinaries) {
    finalBinaryPaths.set(stationary.path, stationary.path);
  }
  for (const move of plan.binaryMoves) {
    try {
      const absFrom = join4(collectionRoot, move.from);
      const absTo = join4(collectionRoot, move.to);
      mkdirSync3(dirname2(absTo), { recursive: true });
      renameSync2(absFrom, absTo);
      finalBinaryPaths.set(move.from, move.to);
      console.log(
        chalk2.green("  \u2713 ") + chalk2.dim(`[binary] ${move.from}`) + chalk2.dim(" \u2192 ") + move.to
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk2.red("  \u2717 ") + `[binary] ${move.from}` + chalk2.red(` (${err.message})`)
      );
      finalBinaryPaths.set(move.from, move.from);
      failed++;
    }
  }
  if (finalBinaryPaths.size > 0) {
    const affectedNotes = /* @__PURE__ */ new Set();
    const binaryReferences = [
      ...plan.binaryMoves.map((move) => ({ path: move.from, referencingNotes: move.referencingNotes })),
      ...plan.stationaryBinaries
    ];
    for (const item of binaryReferences) {
      for (const noteRef of item.referencingNotes) {
        affectedNotes.add(promotedFinalPaths.get(noteRef) ?? noteRef);
      }
    }
    for (const noteFinalPath of affectedNotes) {
      try {
        const absPath = join4(collectionRoot, noteFinalPath);
        if (!existsSync(absPath)) continue;
        const raw = readFileSync3(absPath, "utf-8");
        const updated = updateMarkdownBodyLinks(
          raw,
          noteFinalPath,
          finalBinaryPaths,
          collectionRoot
        );
        if (updated !== raw) {
          writeFileSync3(absPath, updated, "utf-8");
        }
      } catch {
      }
    }
  }
  return { succeeded, failed };
}
function updateMarkdownBodyLinks(content, noteFinalPath, movedBinaries, collectionRoot) {
  const noteAbsDir = join4(collectionRoot, dirname2(noteFinalPath));
  let updated = content;
  for (const [oldRel, newRel] of movedBinaries) {
    const newAbs = join4(collectionRoot, newRel);
    const newRelFromNote = relative(noteAbsDir, newAbs).replace(/\\/g, "/");
    const fname = basename6(oldRel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mdRe = new RegExp(
      `(!?\\[[^\\]]*\\]\\()([^)]*(?:\\/|^)${fname})(\\))`,
      "g"
    );
    updated = updated.replace(mdRe, (_match, prefix, _oldPath, close) => {
      return `${prefix}${newRelFromNote}${close}`;
    });
    const wikiRe = /(!?\[\[)([^|\]#]+)([^\]]*\]\])/g;
    updated = updated.replace(wikiRe, (match, open, target, tail) => {
      const normalizedTarget = String(target).replace(/\\/g, "/");
      if (basename6(normalizedTarget) !== basename6(oldRel)) return match;
      return `${open}${newRel}${tail}`;
    });
  }
  return updated;
}
function projectRootForPath(notePath) {
  const normalized = notePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts[0] !== "projects" || !parts[1] || parts[1] === "_unassigned") return null;
  return `projects/${parts[1]}`;
}

// src/commands/organize.ts
async function organizeCommand(options) {
  try {
    await withCollection(async (collection, _mapping) => {
      const taskResult = await collection.query({ types: ["task"], limit: 5e3 });
      const projectResult = await collection.query({ types: ["project"], limit: 500 });
      const tasks = taskResult.results || [];
      const projects = projectResult.results || [];
      if (tasks.length === 0 && projects.length === 0) {
        console.log(chalk3.dim("No tasks or projects found."));
        return;
      }
      const allNotes = /* @__PURE__ */ new Map();
      for (const t of tasks) {
        allNotes.set(t.path, { path: t.path, type: "task", frontmatter: t.frontmatter });
      }
      for (const p of projects) {
        allNotes.set(p.path, { path: p.path, type: "project", frontmatter: p.frontmatter });
      }
      const resolverContext = await buildResolverContext(collection);
      const readCache = /* @__PURE__ */ new Map();
      const taskToParent = /* @__PURE__ */ new Map();
      const taskToDirectProject = /* @__PURE__ */ new Map();
      const childrenOf = /* @__PURE__ */ new Map();
      for (const task of tasks) {
        const rawProjects = Array.isArray(task.frontmatter.projects) ? task.frontmatter.projects : [];
        for (const raw of rawProjects) {
          if (typeof raw !== "string" || raw.trim().length === 0) continue;
          const resolvedPath = resolveLinkToPath(collection, task.path, raw, resolverContext);
          if (!resolvedPath) continue;
          const targetType = allNotes.get(resolvedPath)?.type ?? await getNoteType(collection, resolvedPath, readCache);
          if (targetType === "task") {
            if (!taskToParent.has(task.path)) {
              taskToParent.set(task.path, resolvedPath);
              const children = childrenOf.get(resolvedPath) || /* @__PURE__ */ new Set();
              children.add(task.path);
              childrenOf.set(resolvedPath, children);
            }
          } else if (targetType === "project") {
            if (!taskToDirectProject.has(task.path)) {
              taskToDirectProject.set(task.path, resolvedPath);
            }
          }
        }
      }
      const taskToProject = /* @__PURE__ */ new Map();
      for (const [taskPath, projectPath] of taskToDirectProject) {
        taskToProject.set(taskPath, projectPath);
      }
      for (const task of tasks) {
        if (taskToProject.has(task.path)) continue;
        const project = resolveOwningProject(
          task.path,
          taskToParent,
          taskToDirectProject,
          /* @__PURE__ */ new Set()
        );
        if (project) {
          taskToProject.set(task.path, project);
        }
      }
      const moves = [];
      const warnings = [];
      const targetPaths = /* @__PURE__ */ new Set();
      const collectionRoot = collection.rootPath || collection.root || "";
      const stem = (filePath) => {
        const note = allNotes.get(filePath);
        if (!note) return basename7(filePath, ".md");
        const override = options.nameOverrides?.get(filePath);
        const frontmatter = override ? { ...note.frontmatter, file_slug: override.slug } : note.frontmatter;
        return desiredCompactStem(note.type, frontmatter, note.path, collectionRoot) ?? basename7(filePath, ".md");
      };
      const fileName = (filePath) => `${stem(filePath)}.md`;
      const projectFolderMap = /* @__PURE__ */ new Map();
      for (const p of projects) {
        const projStem = stem(p.path);
        const folder = normalizeSlashes(join5("projects", projStem));
        projectFolderMap.set(p.path, folder);
      }
      const desiredPaths = /* @__PURE__ */ new Map();
      for (const p of projects) {
        const folder = projectFolderMap.get(p.path);
        const desired = normalizeSlashes(join5(folder, fileName(p.path)));
        desiredPaths.set(p.path, desired);
      }
      for (const task of tasks) {
        const projectPath = taskToProject.get(task.path);
        if (!projectPath) {
          if (options.orphans === "unassigned") {
            const desired = normalizeSlashes(join5("projects/_unassigned", fileName(task.path)));
            desiredPaths.set(task.path, desired);
          } else if (options.nameOverrides?.has(task.path) || desiredCompactStem("task", task.frontmatter, task.path, collectionRoot)) {
            desiredPaths.set(task.path, normalizeSlashes(join5(dirname3(task.path), fileName(task.path))));
          }
          continue;
        }
        const projectFolder = projectFolderMap.get(projectPath);
        if (!projectFolder) {
          warnings.push(`Task "${basename7(task.path)}" links to unknown project: ${projectPath}`);
          continue;
        }
        const ancestorChain = buildAncestorChain(task.path, taskToParent, /* @__PURE__ */ new Set());
        let currentDir = projectFolder;
        for (const ancestorPath of ancestorChain) {
          const hasChildren2 = (childrenOf.get(ancestorPath)?.size ?? 0) > 0;
          if (hasChildren2) {
            currentDir = normalizeSlashes(join5(currentDir, stem(ancestorPath)));
          }
        }
        const hasChildren = (childrenOf.get(task.path)?.size ?? 0) > 0;
        const alreadyInOwnSubfolder = basename7(dirname3(task.path)) === basename7(task.path, ".md");
        if (hasChildren || alreadyInOwnSubfolder) {
          const taskFolder = normalizeSlashes(join5(currentDir, stem(task.path)));
          desiredPaths.set(task.path, normalizeSlashes(join5(taskFolder, fileName(task.path))));
        } else {
          desiredPaths.set(task.path, normalizeSlashes(join5(currentDir, fileName(task.path))));
        }
      }
      let alreadyOrganized = 0;
      const orphanPaths = [];
      for (const [notePath, desiredPath] of desiredPaths) {
        const normalizedCurrent = normalizeSlashes(notePath);
        if (normalizedCurrent === desiredPath) {
          alreadyOrganized++;
          continue;
        }
        if (targetPaths.has(desiredPath)) {
          warnings.push(`Collision: "${basename7(notePath)}" would collide at "${desiredPath}"`);
          continue;
        }
        targetPaths.add(desiredPath);
        const note = allNotes.get(notePath);
        const noteType = note?.type || "task";
        const reason = noteType === "project" ? "project folder" : taskToDirectProject.has(notePath) ? `project: ${stem(taskToDirectProject.get(notePath))}` : taskToParent.has(notePath) ? `parent: ${stem(taskToParent.get(notePath))}` : "orphan \u2192 _unassigned";
        moves.push({ from: normalizedCurrent, to: desiredPath, reason });
      }
      for (const task of tasks) {
        if (!taskToProject.has(task.path) && !desiredPaths.has(task.path)) {
          orphanPaths.push(task.path);
        }
      }
      let attachmentPlan = null;
      if (options.attachments) {
        const scanResult = await scanAttachments(
          collection,
          collectionRoot,
          desiredPaths,
          resolverContext
        );
        attachmentPlan = planAttachmentMoves(scanResult, desiredPaths, collectionRoot);
      }
      const noteMovesEmpty = moves.length === 0;
      const attachMovesEmpty = !attachmentPlan || attachmentPlan.binaryMoves.length === 0 && attachmentPlan.ownedNoteMoves.length === 0 && attachmentPlan.promotionMoves.length === 0;
      if (noteMovesEmpty && attachMovesEmpty) {
        console.log(chalk3.green("All files are already organized."));
        console.log(chalk3.dim(`  ${alreadyOrganized} files in correct location`));
        if (orphanPaths.length > 0) {
          console.log(chalk3.dim(`  ${orphanPaths.length} orphan(s) skipped (no project link)`));
        }
        return;
      }
      if (!options.apply) {
        if (moves.length > 0) {
          console.log(chalk3.bold("Organize plan (dry run):\n"));
          const movesByProject = /* @__PURE__ */ new Map();
          for (const move of moves) {
            const pathParts = move.to.split("/");
            const projectName = pathParts.length >= 2 ? pathParts[1] : "_other";
            const group = movesByProject.get(projectName) || [];
            group.push(move);
            movesByProject.set(projectName, group);
          }
          for (const [projectName, projectMoves] of [...movesByProject.entries()].sort()) {
            console.log(chalk3.blue.bold(`[${projectName}]`) + chalk3.dim(` ${projectMoves.length} move(s)`));
            for (const move of projectMoves) {
              console.log(chalk3.dim("  ") + move.from);
              console.log(chalk3.dim("    \u2192 ") + chalk3.green(move.to));
            }
            console.log();
          }
          console.log(chalk3.bold("Summary:"));
          console.log(`  ${chalk3.yellow(String(moves.length))} moves planned`);
          console.log(`  ${alreadyOrganized} already organized`);
          if (orphanPaths.length > 0) {
            console.log(`  ${orphanPaths.length} orphan(s) skipped`);
          }
          if (warnings.length > 0) {
            console.log(chalk3.yellow("\nWarnings:"));
            for (const w of warnings) {
              console.log(chalk3.yellow(`  \u26A0 ${w}`));
            }
          }
        }
        if (attachmentPlan) {
          printAttachmentDryRun(attachmentPlan);
        }
        console.log(chalk3.dim("\nRun with --apply to execute."));
      } else {
        console.log(chalk3.bold("Organizing files...\n"));
        let succeeded = 0;
        let failed = 0;
        for (const move of moves) {
          try {
            const targetDir = dirname3(join5(collectionRoot, move.to));
            mkdirSync4(targetDir, { recursive: true });
            await collection.rename({
              from: move.from,
              to: move.to,
              update_refs: true
            });
            console.log(chalk3.green("  \u2713 ") + chalk3.dim(move.from) + chalk3.dim(" \u2192 ") + move.to);
            succeeded++;
          } catch (err) {
            console.log(chalk3.red("  \u2717 ") + move.from + chalk3.red(` (${err.message})`));
            failed++;
          }
        }
        if (attachmentPlan) {
          const { succeeded: as, failed: af } = await executeAttachmentMoves(
            collection,
            collectionRoot,
            attachmentPlan
          );
          succeeded += as;
          failed += af;
        }
        pruneEmptySourceDirectories(collectionRoot, [
          ...moves.map((move) => move.from),
          ...attachmentPlan?.binaryMoves.map((move) => move.from) ?? [],
          ...attachmentPlan?.ownedNoteMoves.map((move) => move.from) ?? [],
          ...attachmentPlan?.promotionMoves.map((move) => move.from) ?? []
        ]);
        console.log(chalk3.bold(`
Done: ${succeeded} moved, ${failed} failed.`));
        if (warnings.length > 0) {
          console.log(chalk3.yellow("\nWarnings:"));
          for (const w of warnings) {
            console.log(chalk3.yellow(`  \u26A0 ${w}`));
          }
        }
        if (attachmentPlan?.warnings.length) {
          console.log(chalk3.yellow("\nAttachment warnings:"));
          for (const w of attachmentPlan.warnings) {
            console.log(chalk3.yellow(`  \u26A0 ${w}`));
          }
        }
      }
    }, options.path);
  } catch (err) {
    showError(err.message);
    process.exitCode = 1;
  }
}
function pruneEmptySourceDirectories(collectionRoot, sourcePaths) {
  const absoluteRoot = resolve3(collectionRoot);
  const candidates = [...new Set(sourcePaths.map((source) => dirname3(source)))].sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length);
  for (const candidate of candidates) {
    let current = resolve3(collectionRoot, candidate);
    while (true) {
      const rel = relative2(absoluteRoot, current);
      const depth = rel.split(/[\\/]/).filter(Boolean).length;
      if (!rel || rel.startsWith("..") || depth <= 1) break;
      if (!existsSync2(current) || readdirSync2(current).length > 0) break;
      rmdirSync(current);
      current = dirname3(current);
    }
  }
}
function buildAncestorChain(taskPath, taskToParent, visited) {
  const chain = [];
  let current = taskToParent.get(taskPath);
  while (current && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current);
    current = taskToParent.get(current);
  }
  return chain;
}
function resolveOwningProject(taskPath, taskToParent, taskToDirectProject, visited) {
  if (visited.has(taskPath)) return null;
  visited.add(taskPath);
  const directProject = taskToDirectProject.get(taskPath);
  if (directProject) return directProject;
  const parent = taskToParent.get(taskPath);
  if (!parent) return null;
  return resolveOwningProject(parent, taskToParent, taskToDirectProject, visited);
}
async function getNoteType(collection, notePath, readCache) {
  let fm = readCache.get(notePath);
  if (!fm) {
    try {
      const readResult = await collection.read(notePath);
      if (!readResult.error) {
        fm = readResult.frontmatter || {};
        readCache.set(notePath, fm);
      }
    } catch {
    }
  }
  if (fm && typeof fm.type === "string") {
    return fm.type;
  }
  return null;
}
function normalizeSlashes(p) {
  return p.replace(/\\/g, "/");
}

// src/commands/names.ts
async function namesCommand(pathOrTitle, options) {
  let updated = 0;
  let selectedCount = 0;
  let previewOverrides = null;
  try {
    if (options.apply && options.preview) throw new Error("Use either --preview or --apply, not both.");
    const concurrency = parseConcurrency(options.concurrency);
    await withCollection(async (collection) => {
      const taskResult = await collection.query({ types: ["task"], limit: 5e3 });
      const projectResult = await collection.query({ types: ["project"], limit: 500 });
      const notes = [
        ...(taskResult.results || []).map((note) => ({ ...note, type: "task" })),
        ...(projectResult.results || []).map((note) => ({ ...note, type: "project" }))
      ];
      const selected = selectNotes(notes, pathOrTitle);
      selectedCount = selected.length;
      if (selected.length === 0) throw new Error(pathOrTitle ? `No note matched: ${pathOrTitle}` : "No tasks or projects found.");
      if (!options.apply && !options.preview) {
        console.log(chalk4.bold("Compact filename audit:\n"));
        for (const note of selected) {
          const slug = readStoredSlug(note.frontmatter);
          const state = slug ? `${slug} (${note.frontmatter.file_slug_source ?? "manual"})` : "missing";
          console.log(`  ${note.path}`);
          console.log(chalk4.dim(`    ${state}`));
        }
        const missing = selected.filter((note) => !readStoredSlug(note.frontmatter)).length;
        console.log(chalk4.dim(`
${selected.length} checked; ${missing} need generation.`));
        console.log(chalk4.dim("Run with --apply to generate metadata and organize paths."));
        return;
      }
      const reserved = new Set(
        notes.filter((note) => !selected.includes(note)).map((note) => {
          const slug = readStoredSlug(note.frontmatter);
          return slug ? reservationKey(note, slug) : null;
        }).filter((key) => Boolean(key))
      );
      const rawProposals = await mapWithConcurrency(selected, concurrency, async (note) => {
        const storedSlug = readStoredSlug(note.frontmatter);
        if (!options.refresh && storedSlug) {
          const storedSource = note.frontmatter.file_slug_source;
          const source = storedSource === "llm" || storedSource === "fallback" ? storedSource : "manual";
          return { note, slug: storedSlug, source, generated: false };
        }
        const generated = await generateSlug({ title: readTitle(note), noteType: note.type });
        return { note, ...generated, generated: true };
      });
      const proposals = rawProposals.map((proposal) => {
        const slug = uniqueSlug(proposal.slug, proposal.note, reserved, !proposal.generated);
        reserved.add(reservationKey(proposal.note, slug));
        return { ...proposal, slug };
      });
      if (options.preview) {
        console.log(chalk4.bold(`Compact filename preview (${concurrency} parallel generator(s)):
`));
        previewOverrides = /* @__PURE__ */ new Map();
        for (const proposal of proposals) {
          if (proposal.warning) showWarning(`${readTitle(proposal.note)}: ${proposal.warning}`);
          console.log(`  ${proposal.note.path}`);
          console.log(`${chalk4.dim("    slug: ")}${chalk4.green(proposal.slug)} ${chalk4.dim(`(${proposal.source})`)}`);
          previewOverrides.set(proposal.note.path, { slug: proposal.slug });
        }
        console.log(chalk4.dim(`
${proposals.length} slug(s) proposed; computing the full hierarchy plan...
`));
        return;
      }
      for (const proposal of proposals) {
        const { note, slug, source } = proposal;
        if (proposal.warning) showWarning(`${readTitle(note)}: ${proposal.warning}`);
        const metadataChanged = note.frontmatter.file_slug !== slug || note.frontmatter.filename_schema !== FILENAME_SCHEMA || note.frontmatter.file_slug_source !== source;
        if (metadataChanged) {
          const result = await collection.update({
            path: note.path,
            fields: {
              file_slug: slug,
              filename_schema: FILENAME_SCHEMA,
              file_slug_source: source
            }
          });
          if (result.error) throw new Error(`Failed to update ${note.path}: ${result.error.message}`);
          updated++;
          console.log(`${chalk4.green("\u2713")} ${readTitle(note)} \u2192 ${slug}`);
        } else {
          console.log(`${chalk4.dim("=")} ${readTitle(note)} \u2192 ${slug}`);
        }
      }
    }, options.path);
    if (options.preview && previewOverrides) {
      await organizeCommand({
        path: options.path,
        apply: false,
        attachments: true,
        nameOverrides: previewOverrides
      });
      console.log(chalk4.dim("\nPreview only: no files or frontmatter were changed."));
      console.log(chalk4.dim("Run with --apply to generate again, persist metadata, and execute this hierarchy plan."));
    } else if (options.apply && selectedCount > 0) {
      console.log(chalk4.dim(`
${updated}/${selectedCount} naming records updated; organizing paths...`));
      await organizeCommand({
        path: options.path,
        apply: true,
        attachments: true
      });
    }
  } catch (error) {
    showError(error.message);
    process.exitCode = 1;
  }
}
function selectNotes(notes, query) {
  if (!query) return notes;
  const q = query.toLowerCase();
  const exact = notes.filter(
    (note) => note.path.toLowerCase() === q || basename8(note.path, ".md").toLowerCase() === q || readTitle(note).toLowerCase() === q
  );
  if (exact.length > 0) return exact;
  const partial = notes.filter(
    (note) => note.path.toLowerCase().includes(q) || readTitle(note).toLowerCase().includes(q)
  );
  if (partial.length > 1) {
    throw new Error(`Ambiguous note name "${query}". Use an exact title or path.`);
  }
  return partial;
}
function readTitle(note) {
  return typeof note.frontmatter.title === "string" && note.frontmatter.title.trim() ? note.frontmatter.title.trim() : basename8(note.path, ".md");
}
function uniqueSlug(base, note, reserved, keepExisting = false) {
  if (keepExisting || !reserved.has(reservationKey(note, base))) return base;
  let index = 2;
  while (reserved.has(reservationKey(note, withSuffix(base, index)))) index++;
  return withSuffix(base, index);
}
function reservationKey(note, slug) {
  return `${note.type}:${resolveNamingDate(note.frontmatter, note.path)}:${slug}`;
}
function withSuffix(base, index) {
  const suffix = `-${index}`;
  return `${base.slice(0, 28 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
function parseConcurrency(value) {
  const parsed = value === void 0 ? 4 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error("--concurrency must be an integer from 1 to 16.");
  }
  return parsed;
}
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}
export {
  mapWithConcurrency,
  namesCommand
};
