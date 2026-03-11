import chalk from "chalk";
import { basename, dirname, join, posix } from "node:path";
import { mkdirSync } from "node:fs";
import { withCollection } from "../collection.js";
import { showError } from "../format.js";
import {
  buildResolverContext,
  resolveLinkToPath,
} from "../project-resolver.js";
import type { TaskResult } from "../types.js";
import type { Collection } from "@callumalpass/mdbase";
import type { InternalResolverContext } from "../project-resolver.js";

interface OrganizeOptions {
  path?: string;
  apply?: boolean;
  orphans?: string; // "skip" (default) | "unassigned"
}

interface PlannedMove {
  from: string;
  to: string;
  reason: string;
}

interface NoteInfo {
  path: string;
  type: "task" | "project";
  frontmatter: Record<string, unknown>;
}

export async function organizeCommand(options: OrganizeOptions): Promise<void> {
  try {
    await withCollection(async (collection, _mapping) => {
      // Phase 1: Load all tasks and projects
      const taskResult = await collection.query({ types: ["task"], limit: 5000 });
      const projectResult = await collection.query({ types: ["project"], limit: 500 });

      const tasks = (taskResult.results || []) as Array<{ path: string; frontmatter: Record<string, unknown> }>;
      const projects = (projectResult.results || []) as Array<{ path: string; frontmatter: Record<string, unknown> }>;

      if (tasks.length === 0 && projects.length === 0) {
        console.log(chalk.dim("No tasks or projects found."));
        return;
      }

      const allNotes = new Map<string, NoteInfo>();
      for (const t of tasks) {
        allNotes.set(t.path, { path: t.path, type: "task", frontmatter: t.frontmatter });
      }
      for (const p of projects) {
        allNotes.set(p.path, { path: p.path, type: "project", frontmatter: p.frontmatter });
      }

      // Phase 2: Build parent-child graph by resolving wikilinks
      const resolverContext = await buildResolverContext(collection);
      const readCache = new Map<string, Record<string, unknown>>();

      // task path -> direct parent task path (first one found)
      const taskToParent = new Map<string, string>();
      // task path -> owning project path (direct link)
      const taskToDirectProject = new Map<string, string>();
      // parent path -> set of child paths
      const childrenOf = new Map<string, Set<string>>();

      for (const task of tasks) {
        const rawProjects = Array.isArray(task.frontmatter.projects)
          ? (task.frontmatter.projects as string[])
          : [];

        for (const raw of rawProjects) {
          if (typeof raw !== "string" || raw.trim().length === 0) continue;

          const resolvedPath = resolveLinkToPath(collection, task.path, raw, resolverContext);
          if (!resolvedPath) continue;

          // Read target frontmatter to classify
          const targetType = await getNoteType(collection, resolvedPath, readCache);

          if (targetType === "task") {
            // It's a parent task link
            if (!taskToParent.has(task.path)) {
              taskToParent.set(task.path, resolvedPath);
              const children = childrenOf.get(resolvedPath) || new Set<string>();
              children.add(task.path);
              childrenOf.set(resolvedPath, children);
            }
          } else if (targetType === "project") {
            // It's a project link
            if (!taskToDirectProject.has(task.path)) {
              taskToDirectProject.set(task.path, resolvedPath);
            }
          }
        }
      }

      // Phase 3: Resolve inherited projects for subtasks
      const taskToProject = new Map<string, string>();

      // Copy direct project links
      for (const [taskPath, projectPath] of taskToDirectProject) {
        taskToProject.set(taskPath, projectPath);
      }

      // Walk parent chains to inherit project
      for (const task of tasks) {
        if (taskToProject.has(task.path)) continue;
        const project = resolveOwningProject(
          task.path,
          taskToParent,
          taskToDirectProject,
          new Set<string>(),
        );
        if (project) {
          taskToProject.set(task.path, project);
        }
      }

      // Phase 4: Compute desired paths
      const moves: PlannedMove[] = [];
      const warnings: string[] = [];
      const targetPaths = new Set<string>();

      // Helper: get the stem (filename without .md)
      const stem = (filePath: string) => basename(filePath, ".md");

      // Build a map of project path -> project folder
      // Always root at "projects/" regardless of where the project note currently lives
      const projectFolderMap = new Map<string, string>();
      for (const p of projects) {
        const projStem = stem(p.path);
        const folder = normalizeSlashes(join("projects", projStem));
        projectFolderMap.set(p.path, folder);
      }

      // Compute desired path for each note, top-down
      // We need to build the full path from root project -> parent tasks -> task
      const desiredPaths = new Map<string, string>();

      // First: project notes go into their own folder
      for (const p of projects) {
        const folder = projectFolderMap.get(p.path)!;
        const desired = normalizeSlashes(join(folder, basename(p.path)));
        desiredPaths.set(p.path, desired);
      }

      // For tasks, compute the full ancestor chain path
      for (const task of tasks) {
        const projectPath = taskToProject.get(task.path);
        if (!projectPath) {
          // Orphan
          if (options.orphans === "unassigned") {
            const desired = normalizeSlashes(join("projects/_unassigned", basename(task.path)));
            desiredPaths.set(task.path, desired);
          }
          continue;
        }

        const projectFolder = projectFolderMap.get(projectPath);
        if (!projectFolder) {
          warnings.push(`Task "${basename(task.path)}" links to unknown project: ${projectPath}`);
          continue;
        }

        // Build ancestor chain: task -> parent -> grandparent -> ... -> project
        const ancestorChain = buildAncestorChain(task.path, taskToParent, new Set<string>());

        // Compute path segments from project folder
        let currentDir = projectFolder;
        for (const ancestorPath of ancestorChain) {
          // Each ancestor that has children gets its own subfolder
          const hasChildren = (childrenOf.get(ancestorPath)?.size ?? 0) > 0;
          if (hasChildren) {
            currentDir = normalizeSlashes(join(currentDir, stem(ancestorPath)));
          }
        }

        // The task itself: if it has children, it goes into its own folder
        const hasChildren = (childrenOf.get(task.path)?.size ?? 0) > 0;
        if (hasChildren) {
          const taskFolder = normalizeSlashes(join(currentDir, stem(task.path)));
          desiredPaths.set(task.path, normalizeSlashes(join(taskFolder, basename(task.path))));
        } else {
          desiredPaths.set(task.path, normalizeSlashes(join(currentDir, basename(task.path))));
        }
      }

      // Phase 5: Build moves list
      let alreadyOrganized = 0;
      const orphanPaths: string[] = [];

      for (const [notePath, desiredPath] of desiredPaths) {
        const normalizedCurrent = normalizeSlashes(notePath);
        if (normalizedCurrent === desiredPath) {
          alreadyOrganized++;
          continue;
        }

        // Check for collision
        if (targetPaths.has(desiredPath)) {
          warnings.push(`Collision: "${basename(notePath)}" would collide at "${desiredPath}"`);
          continue;
        }
        targetPaths.add(desiredPath);

        const note = allNotes.get(notePath);
        const noteType = note?.type || "task";
        const reason = noteType === "project"
          ? "project folder"
          : taskToDirectProject.has(notePath)
            ? `project: ${stem(taskToDirectProject.get(notePath)!)}`
            : taskToParent.has(notePath)
              ? `parent: ${stem(taskToParent.get(notePath)!)}`
              : "orphan → _unassigned";

        moves.push({ from: normalizedCurrent, to: desiredPath, reason });
      }

      // Count orphans that weren't moved
      for (const task of tasks) {
        if (!taskToProject.has(task.path) && !desiredPaths.has(task.path)) {
          orphanPaths.push(task.path);
        }
      }

      // Phase 6: Output
      if (moves.length === 0) {
        console.log(chalk.green("All files are already organized."));
        console.log(chalk.dim(`  ${alreadyOrganized} files in correct location`));
        if (orphanPaths.length > 0) {
          console.log(chalk.dim(`  ${orphanPaths.length} orphan(s) skipped (no project link)`));
        }
        return;
      }

      if (!options.apply) {
        // Dry-run output
        console.log(chalk.bold("Organize plan (dry run):\n"));

        // Group moves by project
        const movesByProject = new Map<string, PlannedMove[]>();
        for (const move of moves) {
          // Determine project from the target path
          const pathParts = move.to.split("/");
          const projectName = pathParts.length >= 2 ? pathParts[1] : "_other";
          const group = movesByProject.get(projectName) || [];
          group.push(move);
          movesByProject.set(projectName, group);
        }

        for (const [projectName, projectMoves] of [...movesByProject.entries()].sort()) {
          console.log(chalk.blue.bold(`[${projectName}]`) + chalk.dim(` ${projectMoves.length} move(s)`));
          for (const move of projectMoves) {
            console.log(chalk.dim("  ") + move.from);
            console.log(chalk.dim("    → ") + chalk.green(move.to));
          }
          console.log();
        }

        console.log(chalk.bold("Summary:"));
        console.log(`  ${chalk.yellow(String(moves.length))} moves planned`);
        console.log(`  ${alreadyOrganized} already organized`);
        if (orphanPaths.length > 0) {
          console.log(`  ${orphanPaths.length} orphan(s) skipped`);
        }

        if (warnings.length > 0) {
          console.log(chalk.yellow("\nWarnings:"));
          for (const w of warnings) {
            console.log(chalk.yellow(`  ⚠ ${w}`));
          }
        }

        console.log(chalk.dim("\nRun with --apply to execute."));
      } else {
        // Apply mode
        console.log(chalk.bold("Organizing files...\n"));

        const collectionRoot = (collection as any).rootPath || (collection as any).root || "";
        let succeeded = 0;
        let failed = 0;

        for (const move of moves) {
          try {
            // Create target directory
            const targetDir = dirname(join(collectionRoot, move.to));
            mkdirSync(targetDir, { recursive: true });

            // Move file and update references
            await collection.rename({
              from: move.from,
              to: move.to,
              update_refs: true,
            });

            console.log(chalk.green("  ✓ ") + chalk.dim(move.from) + chalk.dim(" → ") + move.to);
            succeeded++;
          } catch (err) {
            console.log(chalk.red("  ✗ ") + move.from + chalk.red(` (${(err as Error).message})`));
            failed++;
          }
        }

        console.log(chalk.bold(`\nDone: ${succeeded} moved, ${failed} failed.`));

        if (warnings.length > 0) {
          console.log(chalk.yellow("\nWarnings:"));
          for (const w of warnings) {
            console.log(chalk.yellow(`  ⚠ ${w}`));
          }
        }
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

/**
 * Walk up the parent chain and return the ancestor paths from top to bottom
 * (excluding the task itself, excluding the project).
 */
function buildAncestorChain(
  taskPath: string,
  taskToParent: Map<string, string>,
  visited: Set<string>,
): string[] {
  const chain: string[] = [];
  let current = taskToParent.get(taskPath);

  while (current && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current); // prepend to get top-down order
    current = taskToParent.get(current);
  }

  return chain;
}

/**
 * Walk up the parent chain to find the owning project.
 */
function resolveOwningProject(
  taskPath: string,
  taskToParent: Map<string, string>,
  taskToDirectProject: Map<string, string>,
  visited: Set<string>,
): string | null {
  if (visited.has(taskPath)) return null; // cycle
  visited.add(taskPath);

  const directProject = taskToDirectProject.get(taskPath);
  if (directProject) return directProject;

  const parent = taskToParent.get(taskPath);
  if (!parent) return null;

  return resolveOwningProject(parent, taskToParent, taskToDirectProject, visited);
}

/**
 * Read a note's type from its frontmatter, with caching.
 */
async function getNoteType(
  collection: Collection,
  notePath: string,
  readCache: Map<string, Record<string, unknown>>,
): Promise<string | null> {
  let fm = readCache.get(notePath);
  if (!fm) {
    try {
      const readResult = await collection.read(notePath);
      if (!readResult.error) {
        fm = (readResult.frontmatter || {}) as Record<string, unknown>;
        readCache.set(notePath, fm);
      }
    } catch { /* ignore */ }
  }
  if (fm && typeof fm.type === "string") {
    return fm.type;
  }
  return null;
}

/**
 * Normalize path separators to forward slashes (for consistency on Windows).
 */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}
