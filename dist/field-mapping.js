// src/field-mapping.ts
import { loadConfig, getType } from "@callumalpass/mdbase";
import { basename } from "path";

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
function isCompletedStatus(mapping, status) {
  if (!status) return false;
  return mapping.completedStatuses.includes(status);
}
function getDefaultCompletedStatus(mapping) {
  return mapping.completedStatuses[0] || "done";
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
function normalizeFrontmatter(raw, mapping) {
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    const role = mapping.fieldToRole[key];
    result[role ?? key] = value;
  }
  return result;
}
function denormalizeFrontmatter(roleData, mapping) {
  const result = {};
  const rolesSet = new Set(ALL_ROLES);
  for (const [key, value] of Object.entries(roleData)) {
    if (rolesSet.has(key)) {
      result[mapping.roleToField[key]] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}
function resolveField(mapping, role) {
  return mapping.roleToField[role];
}
function resolveDisplayTitle(frontmatter, mapping, taskPath) {
  const candidates = [mapping.displayNameKey, "title"];
  const seen = /* @__PURE__ */ new Set();
  for (const key of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  if (typeof taskPath === "string" && taskPath.trim().length > 0) {
    const fromPath = basename(taskPath, ".md").trim();
    if (fromPath.length > 0) {
      return fromPath;
    }
  }
  return void 0;
}
export {
  buildFieldMapping,
  defaultFieldMapping,
  denormalizeFrontmatter,
  getDefaultCompletedStatus,
  isCompletedStatus,
  loadFieldMapping,
  normalizeFrontmatter,
  resolveDisplayTitle,
  resolveField
};
