// src/commands/organize-attachments.ts
import chalk from "chalk";
import { basename as basename3, dirname as dirname2, join as join2, relative, resolve as resolve2 } from "path";
import {
  existsSync,
  mkdirSync as mkdirSync2,
  readdirSync,
  renameSync,
  readFileSync as readFileSync2,
  writeFileSync as writeFileSync2
} from "fs";

// src/project-resolver.ts
import { basename as basename2, dirname } from "path";

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

// src/project-resolver.ts
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
      const full = join2(dir, e.name);
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
  const stem = basename3(desiredPath, ".md");
  if (basename3(dir) === stem) return dir;
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
            const fname = basename3(link.target);
            for (const nonMdPath of resolverContext.nonMdSet) {
              const nonMdStr = nonMdPath.replace(/\\/g, "/");
              if (basename3(nonMdStr) === fname) {
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
    const stem = basename3(desiredNotePath, ".md");
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
    const fname = basename3(ownedPath);
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
    const fname = basename3(binaryPath);
    const projectRoots = new Set(
      participantEffectiveRefs.map(projectRootForPath).filter((value) => Boolean(value))
    );
    let desiredTo;
    if (projectRoots.size === 1) {
      const projectRoot = [...projectRoots][0];
      const ownerBucket = participantEffectiveRefs.length === 1 ? basename3(participantEffectiveRefs[0], ".md") : "_shared";
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
    const absoluteTarget = collectionRoot ? join2(collectionRoot, desiredTo) : desiredTo;
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
    const fname = basename3(ownedPath);
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
    console.log(chalk.green("  Attachments: all in correct location."));
    return;
  }
  console.log(chalk.bold("\nAttachment plan:\n"));
  if (plan.promotionMoves.length > 0) {
    console.log(
      chalk.blue.bold("[Note promotions]") + chalk.dim(` ${plan.promotionMoves.length} note(s)`)
    );
    for (const m of plan.promotionMoves) {
      console.log(chalk.dim("  ") + m.from);
      console.log(chalk.dim("    \u2192 ") + chalk.green(m.to));
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
        chalk.blue.bold(`[${folder}]`) + chalk.dim(` ${moves.length} file(s)`)
      );
      for (const m of moves) {
        const label = m.kind === "owned" ? chalk.cyan(` [${m.noteType}]`) : "";
        console.log(chalk.dim("  ") + m.from + label);
        console.log(chalk.dim("    \u2192 ") + chalk.green(m.to));
        if (m.referencingNotes.length > 0) {
          const names = m.referencingNotes.map((n) => basename3(n)).join(", ");
          console.log(chalk.dim(`      (referenced by: ${names})`));
        }
      }
      console.log();
    }
  }
  if (plan.warnings.length > 0) {
    console.log(chalk.yellow("Attachment warnings:"));
    for (const w of plan.warnings) {
      console.log(chalk.yellow(`  \u26A0 ${w}`));
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
      mkdirSync2(dirname2(join2(collectionRoot, move.to)), { recursive: true });
      await collection.rename({ from: move.from, to: move.to, update_refs: true });
      console.log(
        chalk.green("  \u2713 ") + chalk.dim(`[promote] ${move.from}`) + chalk.dim(" \u2192 ") + move.to
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk.red("  \u2717 ") + `[promote] ${move.from}` + chalk.red(` (${err.message})`)
      );
      failed++;
    }
  }
  for (const move of plan.ownedNoteMoves) {
    try {
      mkdirSync2(dirname2(join2(collectionRoot, move.to)), { recursive: true });
      await collection.rename({ from: move.from, to: move.to, update_refs: true });
      console.log(
        chalk.green("  \u2713 ") + chalk.dim(`[${move.noteType}] ${move.from}`) + chalk.dim(" \u2192 ") + move.to
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk.red("  \u2717 ") + `[${move.noteType}] ${move.from}` + chalk.red(` (${err.message})`)
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
      const absFrom = join2(collectionRoot, move.from);
      const absTo = join2(collectionRoot, move.to);
      mkdirSync2(dirname2(absTo), { recursive: true });
      renameSync(absFrom, absTo);
      finalBinaryPaths.set(move.from, move.to);
      console.log(
        chalk.green("  \u2713 ") + chalk.dim(`[binary] ${move.from}`) + chalk.dim(" \u2192 ") + move.to
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk.red("  \u2717 ") + `[binary] ${move.from}` + chalk.red(` (${err.message})`)
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
        const absPath = join2(collectionRoot, noteFinalPath);
        if (!existsSync(absPath)) continue;
        const raw = readFileSync2(absPath, "utf-8");
        const updated = updateMarkdownBodyLinks(
          raw,
          noteFinalPath,
          finalBinaryPaths,
          collectionRoot
        );
        if (updated !== raw) {
          writeFileSync2(absPath, updated, "utf-8");
        }
      } catch {
      }
    }
  }
  return { succeeded, failed };
}
function updateMarkdownBodyLinks(content, noteFinalPath, movedBinaries, collectionRoot) {
  const noteAbsDir = join2(collectionRoot, dirname2(noteFinalPath));
  let updated = content;
  for (const [oldRel, newRel] of movedBinaries) {
    const newAbs = join2(collectionRoot, newRel);
    const newRelFromNote = relative(noteAbsDir, newAbs).replace(/\\/g, "/");
    const fname = basename3(oldRel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      if (basename3(normalizedTarget) !== basename3(oldRel)) return match;
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
export {
  executeAttachmentMoves,
  noteVirtualDir,
  planAttachmentMoves,
  printAttachmentDryRun,
  scanAttachments,
  updateMarkdownBodyLinks,
  walkMdFiles
};
