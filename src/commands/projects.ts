import chalk from "chalk";
import { withCollection } from "../collection.js";
import { formatTask, showError } from "../format.js";
import { normalizeFrontmatter, resolveDisplayTitle, isCompletedStatus } from "../field-mapping.js";
import type { TaskResult, TaskFrontmatter } from "../types.js";
import {
  buildResolverContext,
  resolveTaskProjectNames,
} from "../project-resolver.js";

export async function projectsListCommand(
  options: { path?: string; stats?: boolean },
): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      const result = await collection.query({
        types: ["task"],
        limit: 500,
      });

      const rawTasks = (result.results || []) as TaskResult[];
      const tasks = rawTasks.map((t) => {
        const fm = normalizeFrontmatter(t.frontmatter as Record<string, unknown>, mapping);
        const displayTitle = resolveDisplayTitle(fm, mapping, t.path);
        if (displayTitle) {
          fm.title = displayTitle;
        }
        return {
          ...t,
          frontmatter: fm as any as TaskFrontmatter,
        };
      });

      const resolverContext = await buildResolverContext(collection);
      const projectNameCache = new Map<string, string>();
      const readCache = new Map<string, Record<string, unknown>>();

      // Extract unique projects and count tasks
      const projectMap = new Map<
        string,
        { total: number; done: number; open: number }
      >();

      for (const task of tasks) {
        const projects = await resolveTaskProjectNames(
          collection,
          mapping,
          task,
          resolverContext,
          projectNameCache,
          readCache,
        );
        for (const project of projects) {
          const entry = projectMap.get(project) || { total: 0, done: 0, open: 0 };
          entry.total++;
          if (isCompletedStatus(mapping, task.frontmatter.status)) {
            entry.done++;
          } else {
            entry.open++;
          }
          projectMap.set(project, entry);
        }
      }

      if (projectMap.size === 0) {
        console.log(chalk.dim("No projects found."));
        return;
      }

      const sorted = [...projectMap.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );

      for (const [name, counts] of sorted) {
        if (options.stats) {
          const pct =
            counts.total > 0
              ? Math.round((counts.done / counts.total) * 100)
              : 0;
          console.log(
            `  ${chalk.blue(`+${name}`)}  ${counts.open} open, ${counts.done} done (${pct}%)`,
          );
        } else {
          console.log(`  ${chalk.blue(`+${name}`)}`);
        }
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

export async function projectsShowCommand(
  name: string,
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      const result = await collection.query({
        types: ["task"],
        limit: 500,
      });

      const rawTasks = (result.results || []) as TaskResult[];
      const tasks = rawTasks.map((t) => {
        const fm = normalizeFrontmatter(t.frontmatter as Record<string, unknown>, mapping);
        const displayTitle = resolveDisplayTitle(fm, mapping, t.path);
        if (displayTitle) {
          fm.title = displayTitle;
        }
        return {
          ...t,
          frontmatter: fm as any as TaskFrontmatter,
        };
      });

      const resolverContext = await buildResolverContext(collection);
      const projectNameCache = new Map<string, string>();
      const readCache = new Map<string, Record<string, unknown>>();

      const filtered: TaskResult[] = [];
      for (const task of tasks) {
        const projects = await resolveTaskProjectNames(
          collection,
          mapping,
          task,
          resolverContext,
          projectNameCache,
          readCache,
        );
        if (projects.some((p) => p.toLowerCase() === name.toLowerCase())) {
          filtered.push(task);
        }
      }

      if (filtered.length === 0) {
        console.log(chalk.dim(`No tasks in project "${name}".`));
        return;
      }

      console.log(chalk.bold(`Project: +${name}\n`));
      for (const task of filtered) {
        console.log(formatTask(task));
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
