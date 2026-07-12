import chalk from "chalk";
import { withCollection } from "../collection.js";
import { createParser } from "../nlp.js";
import { mapToFrontmatter } from "../mapper.js";
import { formatTask, showError, showSuccess, showWarning } from "../format.js";
import { normalizeFrontmatter } from "../field-mapping.js";
import { createTaskWithCompat } from "../create-compat.js";
import type { TaskResult } from "../types.js";
import { compactStem, FILENAME_SCHEMA, generateSlug, resolveNamingDate } from "../naming.js";

export async function createCommand(
  text: string[],
  options: { path?: string; folder?: string },
): Promise<void> {
  const input = text.join(" ").trim();
  if (!input) {
    showError("Please provide task text.");
    process.exitCode = 1;
    return;
  }

  try {
    const parser = await createParser(options.path);
    const parsed = parser.parseInput(input);
    const { frontmatter, body } = mapToFrontmatter(parsed);
    const title = typeof frontmatter.title === "string" ? frontmatter.title : input;
    const generated = await generateSlug({ title, noteType: "task" });
    frontmatter.file_slug = generated.slug;
    frontmatter.filename_schema = FILENAME_SCHEMA;
    frontmatter.file_slug_source = generated.source;
    const fileNameOverride = compactStem(
      "task",
      resolveNamingDate(frontmatter as Record<string, unknown>, ""),
      generated.slug,
    );
    if (generated.warning) showWarning(`Using fallback filename: ${generated.warning}`);

    await withCollection(async (collection, mapping) => {
      const result = await createTaskWithCompat(
        collection,
        mapping,
        frontmatter as Record<string, unknown>,
        body,
        options.folder,
        fileNameOverride,
      );

      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          showWarning(warning);
        }
      }

      if (result.error) {
        showError(`Failed to create task: ${result.error.message}`);
        process.exitCode = 1;
        return;
      }

      const fm = normalizeFrontmatter(result.frontmatter as Record<string, unknown>, mapping);

      const task: TaskResult = {
        path: result.path!,
        frontmatter: fm as any,
      };

      showSuccess("Task created");
      console.log(formatTask(task));
      console.log(chalk.dim(`  → ${result.path}`));
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exitCode = 1;
  }
}
