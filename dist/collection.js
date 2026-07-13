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
function resolveField(mapping, role) {
  return mapping.roleToField[role];
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
async function resolveTaskPath(collection, pathOrTitle, mapping) {
  if (pathOrTitle.includes("/") || pathOrTitle.endsWith(".md")) {
    return pathOrTitle;
  }
  const titleField = resolveField(mapping, "title");
  const query = pathOrTitle.trim();
  const escaped = query.replace(/"/g, '\\"');
  const exact = await queryTasks(collection, `${titleField} == "${escaped}"`, 20);
  if (exact.length === 1) {
    return exact[0].path;
  }
  if (exact.length > 1) {
    throw new Error(formatAmbiguousTaskError(query, exact, titleField));
  }
  const exactBasename = await queryTasks(collection, `file.basename == "${escaped}"`, 20);
  if (exactBasename.length === 1) {
    return exactBasename[0].path;
  }
  if (exactBasename.length > 1) {
    throw new Error(formatAmbiguousTaskError(query, exactBasename, titleField));
  }
  const fuzzyTitle = await queryTasks(collection, `${titleField}.contains("${escaped}")`, 20);
  const fuzzyBasename = await queryTasks(collection, `file.basename.contains("${escaped}")`, 20);
  const fuzzy = dedupeByPath([...fuzzyTitle, ...fuzzyBasename]);
  if (fuzzy.length === 1) {
    return fuzzy[0].path;
  }
  if (fuzzy.length > 1) {
    throw new Error(
      formatAmbiguousTaskError(
        query,
        rankCandidates(query, fuzzy, titleField),
        titleField
      )
    );
  }
  throw new Error(`No task found matching "${query}"`);
}
async function queryTasks(collection, where, limit) {
  try {
    const result = await collection.query({
      types: ["task"],
      where,
      limit
    });
    return result.results || [];
  } catch {
    return [];
  }
}
function dedupeByPath(candidates) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    deduped.push(candidate);
  }
  return deduped;
}
function rankCandidates(query, candidates, titleField) {
  const q = query.toLowerCase();
  return [...candidates].sort((a, b) => {
    const scoreA = scoreCandidate(q, a, titleField);
    const scoreB = scoreCandidate(q, b, titleField);
    if (scoreA !== scoreB) return scoreB - scoreA;
    const titleA = getTaskTitle(a, titleField).toLowerCase();
    const titleB = getTaskTitle(b, titleField).toLowerCase();
    if (titleA !== titleB) return titleA.localeCompare(titleB);
    return a.path.localeCompare(b.path);
  });
}
function scoreCandidate(query, candidate, titleField) {
  const title = getTaskTitle(candidate, titleField).toLowerCase();
  const path2 = candidate.path.toLowerCase();
  let score = 0;
  if (title === query) score += 100;
  if (title.startsWith(query)) score += 50;
  if (title.includes(query)) score += 25;
  if (path2.includes(query)) score += 10;
  score += Math.max(0, 10 - Math.abs(title.length - query.length));
  return score;
}
function formatAmbiguousTaskError(query, candidates, titleField) {
  const preview = candidates.slice(0, 5).map((candidate, index) => {
    const title = getTaskTitle(candidate, titleField);
    return `  ${index + 1}. ${title} (${candidate.path})`;
  }).join("\n");
  const more = candidates.length > 5 ? `
  ...and ${candidates.length - 5} more` : "";
  const examplePath = candidates[0]?.path || "tasks/<task>.md";
  return [
    `Ambiguous task reference "${query}".`,
    "Matches (best first):",
    `${preview}${more}`,
    `Use a full path to disambiguate (for example: ${examplePath}).`
  ].join("\n");
}
function getTaskTitle(candidate, titleField) {
  if (candidate.frontmatter && titleField) {
    const raw = candidate.frontmatter[titleField];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw;
    }
  }
  const fromPath = basename2(candidate.path, ".md").trim();
  return fromPath.length > 0 ? fromPath : candidate.path;
}
export {
  openCollection,
  resolveTaskPath,
  withCollection
};
