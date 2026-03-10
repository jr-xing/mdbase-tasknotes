import chalk from "chalk";
import { withCollection } from "../collection.js";
import { formatTaskForDate, showError } from "../format.js";
import {
  normalizeFrontmatter,
  resolveDisplayTitle,
  resolveField,
  isCompletedStatus,
} from "../field-mapping.js";
import {
  buildResolverContext,
  resolveProjectName,
  resolveLinkToPath,
} from "../project-resolver.js";
import { getCurrentDateString, isBeforeDateSafe, resolveDateOrToday } from "../date.js";
import type { TaskResult, TaskFrontmatter } from "../types.js";
import type { Collection } from "@callumalpass/mdbase";
import type { FieldMapping } from "../field-mapping.js";
import type { InternalResolverContext } from "../project-resolver.js";

interface TaskNode {
  task: TaskResult;
  children: TaskNode[];
}

interface TreeCommandOptions {
  path?: string;
  status?: string;
  priority?: string;
  tag?: string;
  overdue?: boolean;
  all?: boolean;
  limit?: string;
}

export async function treeCommand(options: TreeCommandOptions): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      // Phase 1: Load and filter tasks
      const tasks = await loadTasks(collection, mapping, options);
      if (tasks.length === 0) {
        console.log(chalk.dim("No tasks found."));
        return;
      }

      const tasksByPath = new Map<string, TaskResult>();
      for (const task of tasks) {
        tasksByPath.set(task.path, task);
      }

      // Phase 2: Classify links and build relationships
      const resolverContext = await buildResolverContext(collection);
      const nameCache = new Map<string, string>();
      const readCache = new Map<string, Record<string, unknown>>();

      // For each task: which are its parent tasks, which are its real projects
      const parentTaskPaths = new Map<string, string[]>();   // taskPath -> parent task paths
      const taskProjectNames = new Map<string, string[]>();  // taskPath -> real project names

      for (const task of tasks) {
        const rawProjects = Array.isArray(task.frontmatter.projects)
          ? (task.frontmatter.projects as string[])
          : [];

        const parents: string[] = [];
        const projects: string[] = [];

        for (const raw of rawProjects) {
          if (typeof raw !== "string" || raw.trim().length === 0) continue;

          const resolvedPath = resolveLinkToPath(collection, task.path, raw, resolverContext);

          // Classify: is the target a task (parent) or a project?
          let isParentTask = false;
          if (resolvedPath) {
            // Check if the target is in our loaded task set
            if (tasksByPath.has(resolvedPath)) {
              isParentTask = true;
            } else {
              // Read target frontmatter to check its type
              let targetFm = readCache.get(resolvedPath);
              if (!targetFm) {
                try {
                  const readResult = await collection.read(resolvedPath);
                  if (!readResult.error) {
                    targetFm = (readResult.frontmatter || {}) as Record<string, unknown>;
                    readCache.set(resolvedPath, targetFm);
                  }
                } catch { /* ignore */ }
              }
              if (targetFm) {
                const targetType = typeof targetFm.type === "string" ? targetFm.type : "";
                isParentTask = targetType === "task";
              }
            }
          }

          if (isParentTask && resolvedPath) {
            parents.push(resolvedPath);
          } else {
            // Real project or unresolved link
            const name = await resolveProjectName(
              collection, mapping, task.path, raw,
              resolverContext, nameCache, readCache,
            );
            if (name.length > 0) {
              projects.push(name);
            }
          }
        }

        parentTaskPaths.set(task.path, parents);
        taskProjectNames.set(task.path, projects);
      }

      // Phase 3: Build tree
      const taskNodes = new Map<string, TaskNode>();
      for (const task of tasks) {
        taskNodes.set(task.path, { task, children: [] });
      }

      const isChild = new Set<string>();
      for (const task of tasks) {
        const parents = parentTaskPaths.get(task.path) || [];
        for (const parentPath of parents) {
          const parentNode = taskNodes.get(parentPath);
          if (parentNode) {
            parentNode.children.push(taskNodes.get(task.path)!);
            isChild.add(task.path);
          }
        }
      }

      // Root tasks: not a child of any other task
      const rootTasks = tasks.filter((t) => !isChild.has(t.path));

      // Group root tasks by project
      const projectGroups = new Map<string, TaskNode[]>();
      const orphans: TaskNode[] = [];

      for (const task of rootTasks) {
        const projects = taskProjectNames.get(task.path) || [];
        if (projects.length === 0) {
          // Check if this task has subtasks that have projects — still an orphan at project level
          orphans.push(taskNodes.get(task.path)!);
        } else {
          for (const project of projects) {
            const group = projectGroups.get(project) || [];
            group.push(taskNodes.get(task.path)!);
            projectGroups.set(project, group);
          }
        }
      }

      // Phase 4: Render
      const sortedProjects = [...projectGroups.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );

      let first = true;
      for (const [projectName, nodes] of sortedProjects) {
        if (!first) console.log("");
        first = false;
        console.log(chalk.blue.bold(`+${projectName}`));
        renderChildren(nodes, "", new Set());
      }

      if (orphans.length > 0) {
        if (!first) console.log("");
        console.log(chalk.dim.bold("Orphan tasks"));
        renderChildren(orphans, "", new Set());
      }

      if (sortedProjects.length === 0 && orphans.length === 0) {
        console.log(chalk.dim("No tasks found."));
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

function renderChildren(nodes: TaskNode[], prefix: string, visited: Set<string>): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    renderNode(node, prefix, isLast, visited);
  }
}

function renderNode(node: TaskNode, prefix: string, isLast: boolean, visited: Set<string>): void {
  const connector = isLast ? "└── " : "├── ";
  const taskLine = formatTaskForDate(node.task, getCurrentDateString(), { hideProjects: true });

  // Cycle detection
  if (visited.has(node.task.path)) {
    console.log(`${prefix}${connector}${taskLine} ${chalk.dim("(cycle)")}`);
    return;
  }

  console.log(`${prefix}${connector}${taskLine}`);

  if (node.children.length > 0) {
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const newVisited = new Set(visited);
    newVisited.add(node.task.path);
    renderChildren(node.children, childPrefix, newVisited);
  }
}

async function loadTasks(
  collection: Collection,
  mapping: FieldMapping,
  options: TreeCommandOptions,
): Promise<TaskResult[]> {
  const conditions: string[] = [];
  const statusField = resolveField(mapping, "status");
  const priorityField = resolveField(mapping, "priority");
  const tagsField = resolveField(mapping, "tags");
  const dueField = resolveField(mapping, "due");
  const completedStatuses = mapping.completedStatuses;

  if (!options.all) {
    if (options.status) {
      if (!isCompletedStatus(mapping, options.status)) {
        conditions.push(`${statusField} == "${options.status}"`);
      }
    } else {
      // Default: exclude completed
      for (const status of completedStatuses) {
        const escaped = status.replace(/"/g, '\\"');
        conditions.push(`${statusField} != "${escaped}"`);
      }
    }

    // Exclude archived
    conditions.push(`!${tagsField}.contains("archive")`);
    conditions.push(`!${tagsField}.contains("archived")`);
  }

  if (options.priority) {
    conditions.push(`${priorityField} == "${options.priority}"`);
  }

  if (options.tag) {
    conditions.push(`${tagsField}.contains("${options.tag}")`);
  }

  if (options.overdue) {
    conditions.push(`${dueField} != null`);
    for (const status of completedStatuses) {
      const escaped = status.replace(/"/g, '\\"');
      conditions.push(`${statusField} != "${escaped}"`);
    }
  }

  const where = conditions.length > 0 ? conditions.join(" && ") : undefined;
  const limit = options.limit ? parseInt(options.limit, 10) : 1000;

  const result = await collection.query({
    types: ["task"],
    where,
    order_by: [{ field: dueField, direction: "asc" }],
    limit,
  });

  const rawTasks = (result.results || []) as TaskResult[];
  const today = resolveDateOrToday();

  return rawTasks
    .filter((task) => {
      const fm = normalizeFrontmatter(task.frontmatter as Record<string, unknown>, mapping);
      if (options.overdue) {
        if (isCompletedStatus(mapping, typeof fm.status === "string" ? fm.status : undefined)) return false;
        if (typeof fm.due !== "string" || fm.due.trim().length === 0) return false;
        if (!isBeforeDateSafe(fm.due, today)) return false;
      }
      return true;
    })
    .map((t) => {
      const fm = normalizeFrontmatter(t.frontmatter as Record<string, unknown>, mapping);
      const displayTitle = resolveDisplayTitle(fm, mapping, t.path);
      if (displayTitle) {
        fm.title = displayTitle;
      }
      return { ...t, frontmatter: fm as any as TaskFrontmatter };
    });
}
