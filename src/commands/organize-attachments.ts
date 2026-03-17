import chalk from "chalk";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Collection } from "@callumalpass/mdbase";
import { resolveLinkToPath } from "../project-resolver.js";
import type { InternalResolverContext } from "../project-resolver.js";

// ============================================================
// Constants
// ============================================================

const OWNED_NOTE_TYPES = new Set(["task-card", "prompt-note"]);

/** Fallback home folder when an owned note's LCA is the collection root. */
const OWNED_NOTE_FALLBACK_FOLDER: Record<string, string> = {
  "task-card": "task-cards",
  "prompt-note": "prompts",
};

// ============================================================
// Interfaces
// ============================================================

export interface AttachmentScanResult {
  /** binary file (collection-relative) → set of referencing note DESIRED paths */
  binaryRefs: Map<string, Set<string>>;
  /** owned note (collection-relative) → set of referencing note DESIRED paths */
  ownedNoteRefs: Map<string, Set<string>>;
  /** owned note path → frontmatter type string */
  ownedNoteTypes: Map<string, string>;
}

export interface AttachmentPlan {
  /** Binary files to move with fs.renameSync */
  binaryMoves: Array<{
    from: string; // collection-relative
    to: string;   // collection-relative
    referencingNotes: string[];
  }>;
  /** Owned notes to move via collection.rename (wikilink refs auto-updated) */
  ownedNoteMoves: Array<{
    from: string;
    to: string;
    noteType: string;
    referencingNotes: string[];
  }>;
  /** Task notes to promote into their own subfolder (also via collection.rename) */
  promotionMoves: Array<{
    from: string;
    to: string;
  }>;
  warnings: string[];
}

// ============================================================
// Filesystem helpers
// ============================================================

/** Walk all .md files under root, return collection-relative POSIX paths. */
export function walkMdFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
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

// ============================================================
// Link parsing
// ============================================================

interface BodyLink {
  target: string;
  syntax: "wikilink" | "markdown";
}

/** Extract all link/embed targets from markdown body text. */
function parseBodyLinks(body: string): BodyLink[] {
  const results: BodyLink[] = [];

  // Wikilinks: [[target]], [[target|alias]], ![[target]], etc.
  const wikiRe = /!?\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) results.push({ target, syntax: "wikilink" });
  }

  // Markdown links: [text](target), ![alt](target)
  const mdRe = /!?\[[^\]]*\]\(([^)#\s]+)(?:#[^)]+)?\)/g;
  while ((m = mdRe.exec(body)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:")
    ) continue;
    results.push({ target, syntax: "markdown" });
  }

  return results;
}

// ============================================================
// LCA helpers
// ============================================================

/**
 * Return the "virtual containing directory" of a note.
 * If the note is already in its own subfolder (e.g. task-1/task-1.md),
 * the virtual dir is that subfolder. Otherwise it is the subfolder the
 * note WOULD be in after promotion (e.g. proj-a/task-1.md → proj-a/task-1/).
 */
export function noteVirtualDir(desiredPath: string): string {
  const dir = dirname(desiredPath).replace(/\\/g, "/");
  const stem = basename(desiredPath, ".md");
  // Already in own subfolder?
  if (basename(dir) === stem) return dir;
  // Return the would-be subfolder path
  return dir === "." ? stem : `${dir}/${stem}`;
}

/** Compute the Lowest Common Ancestor directory of a list of directories. */
function computeLCAOfDirs(dirs: string[]): string {
  if (dirs.length === 0) return ".";
  if (dirs.length === 1) return dirs[0];
  const parts = dirs.map(d => (d === "." ? [] : d.split("/")));
  const shortest = parts.reduce((a, b) => (a.length < b.length ? a : b));
  const lca: string[] = [];
  for (let i = 0; i < shortest.length; i++) {
    if (parts.every(p => p[i] === shortest[i])) lca.push(shortest[i]);
    else break;
  }
  return lca.length > 0 ? lca.join("/") : ".";
}

// ============================================================
// Type cache helper
// ============================================================

async function getTypeFromCache(
  collection: Collection,
  notePath: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(notePath)) return cache.get(notePath)!;
  try {
    const r = await collection.read(notePath);
    if (!r.error && r.frontmatter) {
      const t = (r.frontmatter as Record<string, unknown>).type;
      const typeStr = typeof t === "string" ? t : null;
      cache.set(notePath, typeStr);
      return typeStr;
    }
  } catch { /* ignore */ }
  cache.set(notePath, null);
  return null;
}

function addRef(map: Map<string, Set<string>>, key: string, value: string): void {
  const s = map.get(key) ?? new Set<string>();
  s.add(value);
  map.set(key, s);
}

// ============================================================
// Scan
// ============================================================

/**
 * Walk all markdown files in the collection, read their bodies, and build
 * reference maps from attachment/owned-note paths to the DESIRED paths of
 * the notes that reference them.
 */
export async function scanAttachments(
  collection: Collection,
  collectionRoot: string,
  desiredPaths: Map<string, string>,
  resolverContext: InternalResolverContext | null,
): Promise<AttachmentScanResult> {
  const binaryRefs = new Map<string, Set<string>>();
  const ownedNoteRefs = new Map<string, Set<string>>();
  const ownedNoteTypes = new Map<string, string>();
  const typeCache = new Map<string, string | null>();

  const allMd = walkMdFiles(collectionRoot).filter(p => !p.startsWith("_types/"));

  for (const notePath of allMd) {
    let body: string;
    try {
      const r = await (collection as any).read(notePath);
      if (r.error || !r.body) continue;
      body = r.body as string;
    } catch {
      continue;
    }

    // Use the post-organize desired path as the note's identity in ref maps
    const noteDesiredPath = desiredPaths.get(notePath) ?? notePath;
    const links = parseBodyLinks(body);

    for (const link of links) {
      if (link.syntax === "markdown") {
        // Resolve relative to the note's current directory
        const noteAbsDir = resolve(collectionRoot, dirname(notePath));
        const targetAbs = resolve(noteAbsDir, link.target);
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
        // Wikilink — use collection resolver
        const resolved = resolveLinkToPath(
          collection,
          notePath,
          `[[${link.target}]]`,
          resolverContext,
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
          // Wikilink didn't resolve — try matching by basename in nonMdSet
          if (resolverContext?.nonMdSet) {
            const fname = basename(link.target);
            for (const nonMdPath of resolverContext.nonMdSet) {
              const nonMdStr = (nonMdPath as string).replace(/\\/g, "/");
              if (basename(nonMdStr) === fname) {
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

// ============================================================
// Plan
// ============================================================

/**
 * Given a scan result, compute the full attachment move plan using LCA.
 * Notes that become sole owners of assets are promoted to their own subfolder.
 */
export function planAttachmentMoves(
  scanResult: AttachmentScanResult,
  desiredPaths: Map<string, string>,
): AttachmentPlan {
  const binaryMoves: AttachmentPlan["binaryMoves"] = [];
  const ownedNoteMoves: AttachmentPlan["ownedNoteMoves"] = [];
  const promotionMoves: AttachmentPlan["promotionMoves"] = [];
  const warnings: string[] = [];

  // Desired note path → promoted path (to avoid duplicate promotions)
  const promotedPaths = new Map<string, string>();
  // Target path → source path (for binary collision detection)
  const plannedBinaryTargets = new Map<string, string>();

  // Only notes managed by the organize command (tasks, projects) should
  // influence where attachments are placed. Notes like copilot conversations
  // that have no type frontmatter are not managed and must not pull assets
  // into their folder hierarchy or trigger note promotions.
  const participantRefPaths = new Set(desiredPaths.values());

  function maybePromote(desiredNotePath: string): void {
    if (promotedPaths.has(desiredNotePath)) return;
    const actualDir = dirname(desiredNotePath).replace(/\\/g, "/");
    const vdir = noteVirtualDir(desiredNotePath);
    if (vdir === actualDir) return; // already in own subfolder
    const stem = basename(desiredNotePath, ".md");
    const promotedTo = `${vdir}/${stem}.md`;
    promotedPaths.set(desiredNotePath, promotedTo);
    promotionMoves.push({ from: desiredNotePath, to: promotedTo });
  }

  // ---- First: Compute owned note target paths ----
  // This ensures binary LCAs use the post-move locations of owned notes
  const ownedNoteTargets = new Map<string, string>(); // current path → target path

  for (const [ownedPath, refsSet] of scanResult.ownedNoteRefs) {
    const refs = [...refsSet];
    const participantRefs = refs.filter(r => participantRefPaths.has(r));
    if (participantRefs.length === 0) continue;
    const virtualDirs = participantRefs.map(noteVirtualDir);
    const lca = computeLCAOfDirs(virtualDirs);
    const fname = basename(ownedPath);
    const noteType = scanResult.ownedNoteTypes.get(ownedPath) ?? "";
    const fallbackFolder = OWNED_NOTE_FALLBACK_FOLDER[noteType];
    const desiredTo =
      lca === "." && fallbackFolder
        ? `${fallbackFolder}/${fname}`
        : lca === "."
          ? fname
          : `${lca}/${fname}`;
    const normalized = ownedPath.replace(/\\/g, "/");

    if (normalized !== desiredTo) {
      const organizeTarget = desiredPaths.get(normalized)?.replace(/\\/g, "/");
      if (organizeTarget !== desiredTo) {
        ownedNoteTargets.set(normalized, desiredTo);
      }
    }
  }

  // ---- Binary moves (using owned note target paths) ----
  for (const [binaryPath, refsSet] of scanResult.binaryRefs) {
    const refs = [...refsSet];

    // Use owned note target paths if available, so binary LCAs are computed
    // based on where owned notes will be AFTER they're moved
    const effectiveRefs = refs.map(ref => ownedNoteTargets.get(ref) ?? ref);

    // Only participant (managed) notes determine where a binary is placed.
    // Non-participant notes (e.g. copilot conversations) may link to assets
    // but must not pull those assets into their folder hierarchy.
    const participantEffectiveRefs = effectiveRefs.filter((_, i) => participantRefPaths.has(refs[i]));
    if (participantEffectiveRefs.length === 0) continue;

    const virtualDirs = participantEffectiveRefs.map(noteVirtualDir);
    const lca = computeLCAOfDirs(virtualDirs);
    const fname = basename(binaryPath);
    const desiredTo = lca === "." ? `assets/${fname}` : `${lca}/assets/${fname}`;
    const normalized = binaryPath.replace(/\\/g, "/");

    if (normalized === desiredTo) continue;

    if (plannedBinaryTargets.has(desiredTo) && plannedBinaryTargets.get(desiredTo) !== normalized) {
      warnings.push(`Collision: "${fname}" from multiple sources at "${desiredTo}" — skipping "${normalized}"`);
      continue;
    }
    plannedBinaryTargets.set(desiredTo, normalized);

    // Promote only participant referencing notes
    for (const ref of participantEffectiveRefs) {
      maybePromote(ref);
    }

    // Keep all refs (including non-participants) for display and link updating
    binaryMoves.push({ from: normalized, to: desiredTo, referencingNotes: refs });
  }

  // ---- Owned note moves ----
  for (const [ownedPath, refsSet] of scanResult.ownedNoteRefs) {
    const refs = [...refsSet];
    const participantRefs = refs.filter(r => participantRefPaths.has(r));
    if (participantRefs.length === 0) continue;
    const virtualDirs = participantRefs.map(noteVirtualDir);
    const lca = computeLCAOfDirs(virtualDirs);
    const fname = basename(ownedPath);
    const noteType = scanResult.ownedNoteTypes.get(ownedPath) ?? "";
    // When the LCA is the collection root, fall back to the type's home folder
    // (task-cards/ or prompts/) rather than floating to the vault root.
    const fallbackFolder = OWNED_NOTE_FALLBACK_FOLDER[noteType];
    const desiredTo =
      lca === "." && fallbackFolder
        ? `${fallbackFolder}/${fname}`
        : lca === "."
          ? fname
          : `${lca}/${fname}`;
    const normalized = ownedPath.replace(/\\/g, "/");

    if (normalized === desiredTo) continue;

    // Skip if the organize phase is already moving it to the right place
    const organizeTarget = desiredPaths.get(normalized)?.replace(/\\/g, "/");
    if (organizeTarget === desiredTo) continue;

    for (const ref of participantRefs) {
      maybePromote(ref);
    }

    ownedNoteMoves.push({ from: normalized, to: desiredTo, noteType: noteType || "owned", referencingNotes: refs });
  }

  return { binaryMoves, ownedNoteMoves, promotionMoves, warnings };
}

// ============================================================
// Dry-run output
// ============================================================

export function printAttachmentDryRun(plan: AttachmentPlan): void {
  const totalMoves =
    plan.binaryMoves.length + plan.ownedNoteMoves.length + plan.promotionMoves.length;

  if (totalMoves === 0) {
    console.log(chalk.green("  Attachments: all in correct location."));
    return;
  }

  console.log(chalk.bold("\nAttachment plan:\n"));

  if (plan.promotionMoves.length > 0) {
    console.log(
      chalk.blue.bold("[Note promotions]") +
      chalk.dim(` ${plan.promotionMoves.length} note(s)`),
    );
    for (const m of plan.promotionMoves) {
      console.log(chalk.dim("  ") + m.from);
      console.log(chalk.dim("    → ") + chalk.green(m.to));
    }
    console.log();
  }

  // Group all attachment moves by top-level project folder
  const allMoves = [
    ...plan.ownedNoteMoves.map(m => ({ ...m, kind: "owned" as const })),
    ...plan.binaryMoves.map(m => ({ ...m, kind: "binary" as const })),
  ];

  if (allMoves.length > 0) {
    const byFolder = new Map<string, typeof allMoves>();
    for (const m of allMoves) {
      const parts = m.to.split("/");
      const folder = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
      const g = byFolder.get(folder) ?? [];
      g.push(m);
      byFolder.set(folder, g);
    }

    for (const [folder, moves] of [...byFolder.entries()].sort()) {
      console.log(
        chalk.blue.bold(`[${folder}]`) + chalk.dim(` ${moves.length} file(s)`),
      );
      for (const m of moves) {
        const label =
          m.kind === "owned" ? chalk.cyan(` [${(m as any).noteType}]`) : "";
        console.log(chalk.dim("  ") + m.from + label);
        console.log(chalk.dim("    → ") + chalk.green(m.to));
        if (m.referencingNotes.length > 0) {
          const names = m.referencingNotes.map(n => basename(n)).join(", ");
          console.log(chalk.dim(`      (referenced by: ${names})`));
        }
      }
      console.log();
    }
  }

  if (plan.warnings.length > 0) {
    console.log(chalk.yellow("Attachment warnings:"));
    for (const w of plan.warnings) {
      console.log(chalk.yellow(`  ⚠ ${w}`));
    }
  }
}

// ============================================================
// Execute
// ============================================================

export async function executeAttachmentMoves(
  collection: Collection,
  collectionRoot: string,
  plan: AttachmentPlan,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  // Build promoted-path lookup so body updates use final note locations
  const promotedFinalPaths = new Map<string, string>(); // organizedPath → finalPath
  for (const m of plan.promotionMoves) {
    promotedFinalPaths.set(m.from, m.to);
  }

  // 1. Promote notes into their own subfolders
  for (const move of plan.promotionMoves) {
    try {
      mkdirSync(dirname(join(collectionRoot, move.to)), { recursive: true });
      await collection.rename({ from: move.from, to: move.to, update_refs: true });
      console.log(
        chalk.green("  ✓ ") +
        chalk.dim(`[promote] ${move.from}`) +
        chalk.dim(" → ") +
        move.to,
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk.red("  ✗ ") +
        `[promote] ${move.from}` +
        chalk.red(` (${(err as Error).message})`),
      );
      failed++;
    }
  }

  // 2. Move owned notes (collection.rename updates all wikilink backlinks)
  for (const move of plan.ownedNoteMoves) {
    try {
      mkdirSync(dirname(join(collectionRoot, move.to)), { recursive: true });
      await collection.rename({ from: move.from, to: move.to, update_refs: true });
      console.log(
        chalk.green("  ✓ ") +
        chalk.dim(`[${move.noteType}] ${move.from}`) +
        chalk.dim(" → ") +
        move.to,
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk.red("  ✗ ") +
        `[${move.noteType}] ${move.from}` +
        chalk.red(` (${(err as Error).message})`),
      );
      failed++;
    }
  }

  // 3. Move binary files (raw filesystem)
  const movedBinaries = new Map<string, string>(); // from → to (succeeded only)
  for (const move of plan.binaryMoves) {
    try {
      const absFrom = join(collectionRoot, move.from);
      const absTo = join(collectionRoot, move.to);
      mkdirSync(dirname(absTo), { recursive: true });
      renameSync(absFrom, absTo);
      movedBinaries.set(move.from, move.to);
      console.log(
        chalk.green("  ✓ ") +
        chalk.dim(`[binary] ${move.from}`) +
        chalk.dim(" → ") +
        move.to,
      );
      succeeded++;
    } catch (err) {
      console.log(
        chalk.red("  ✗ ") +
        `[binary] ${move.from}` +
        chalk.red(` (${(err as Error).message})`),
      );
      failed++;
    }
  }

  // 4. Update markdown-style body links in referencing notes
  if (movedBinaries.size > 0) {
    const affectedNotes = new Set<string>();
    for (const move of plan.binaryMoves) {
      for (const noteRef of move.referencingNotes) {
        // Use the post-promotion path if the note was promoted
        affectedNotes.add(promotedFinalPaths.get(noteRef) ?? noteRef);
      }
    }

    for (const noteFinalPath of affectedNotes) {
      try {
        const absPath = join(collectionRoot, noteFinalPath);
        if (!existsSync(absPath)) continue;
        const raw = readFileSync(absPath, "utf-8");
        const updated = updateMarkdownBodyLinks(
          raw,
          noteFinalPath,
          movedBinaries,
          collectionRoot,
        );
        if (updated !== raw) {
          writeFileSync(absPath, updated, "utf-8");
        }
      } catch {
        // Non-critical; wikilinks will still resolve by filename
      }
    }
  }

  return { succeeded, failed };
}

// ============================================================
// Body link updater (markdown links only; wikilinks resolve by filename)
// ============================================================

function updateMarkdownBodyLinks(
  content: string,
  noteFinalPath: string,
  movedBinaries: Map<string, string>,
  collectionRoot: string,
): string {
  const noteAbsDir = join(collectionRoot, dirname(noteFinalPath));
  let updated = content;

  for (const [oldRel, newRel] of movedBinaries) {
    const newAbs = join(collectionRoot, newRel);
    const newRelFromNote = relative(noteAbsDir, newAbs).replace(/\\/g, "/");

    // Match markdown links whose target basename matches the moved file.
    // We use the filename as the discriminator (false positives are rare).
    const fname = basename(oldRel).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mdRe = new RegExp(
      `(!?\\[[^\\]]*\\]\\()([^)]*(?:\\/|^)${fname})(\\))`,
      "g",
    );
    updated = updated.replace(mdRe, (_match, prefix, _oldPath, close) => {
      return `${prefix}${newRelFromNote}${close}`;
    });
  }

  return updated;
}
