import { basename } from "node:path";
import chalk from "chalk";
import { withCollection } from "../collection.js";
import { generateSlug, readStoredSlug, resolveNamingDate, FILENAME_SCHEMA } from "../naming.js";
import { showError, showWarning } from "../format.js";
import { organizeCommand } from "./organize.js";

interface NoteRecord {
  path: string;
  type: "task" | "project";
  frontmatter: Record<string, unknown>;
}

interface NameProposal {
  note: NoteRecord;
  slug: string;
  source: "llm" | "fallback" | "manual";
  warning?: string;
  generated: boolean;
}

export async function namesCommand(
  pathOrTitle: string | undefined,
  options: {
    path?: string;
    apply?: boolean;
    preview?: boolean;
    refresh?: boolean;
    concurrency?: string | number;
  },
): Promise<void> {
  let updated = 0;
  let selectedCount = 0;
  let previewOverrides: Map<string, { slug: string }> | null = null;

  try {
    if (options.apply && options.preview) throw new Error("Use either --preview or --apply, not both.");
    const concurrency = parseConcurrency(options.concurrency);
    await withCollection(async (collection) => {
      const taskResult = await collection.query({ types: ["task"], limit: 5000 });
      const projectResult = await collection.query({ types: ["project"], limit: 500 });
      const notes: NoteRecord[] = [
        ...(taskResult.results || []).map((note: any) => ({ ...note, type: "task" as const })),
        ...(projectResult.results || []).map((note: any) => ({ ...note, type: "project" as const })),
      ];
      const selected = selectNotes(notes, pathOrTitle);
      selectedCount = selected.length;
      if (selected.length === 0) throw new Error(pathOrTitle ? `No note matched: ${pathOrTitle}` : "No tasks or projects found.");

      if (!options.apply && !options.preview) {
        console.log(chalk.bold("Compact filename audit:\n"));
        for (const note of selected) {
          const slug = readStoredSlug(note.frontmatter);
          const state = slug ? `${slug} (${note.frontmatter.file_slug_source ?? "manual"})` : "missing";
          console.log(`  ${note.path}`);
          console.log(chalk.dim(`    ${state}`));
        }
        const missing = selected.filter((note) => !readStoredSlug(note.frontmatter)).length;
        console.log(chalk.dim(`\n${selected.length} checked; ${missing} need generation.`));
        console.log(chalk.dim("Run with --apply to generate metadata and organize paths."));
        return;
      }

      const reserved = new Set(
        notes
          .filter((note) => !selected.includes(note))
          .map((note) => {
            const slug = readStoredSlug(note.frontmatter);
            return slug ? reservationKey(note, slug) : null;
          })
          .filter((key): key is string => Boolean(key)),
      );

      const rawProposals = await mapWithConcurrency(selected, concurrency, async (note) => {
        const storedSlug = readStoredSlug(note.frontmatter);
        if (!options.refresh && storedSlug) {
          const storedSource = note.frontmatter.file_slug_source;
          const source = storedSource === "llm" || storedSource === "fallback" ? storedSource : "manual";
          return { note, slug: storedSlug, source, generated: false } as NameProposal;
        }
        const generated = await generateSlug({ title: readTitle(note), noteType: note.type });
        return { note, ...generated, generated: true } as NameProposal;
      });

      const proposals = rawProposals.map((proposal) => {
        const slug = uniqueSlug(proposal.slug, proposal.note, reserved, !proposal.generated);
        reserved.add(reservationKey(proposal.note, slug));
        return { ...proposal, slug };
      });

      if (options.preview) {
        console.log(chalk.bold(`Compact filename preview (${concurrency} parallel generator(s)):\n`));
        previewOverrides = new Map<string, { slug: string }>();
        for (const proposal of proposals) {
          if (proposal.warning) showWarning(`${readTitle(proposal.note)}: ${proposal.warning}`);
          console.log(`  ${proposal.note.path}`);
          console.log(`${chalk.dim("    slug: ")}${chalk.green(proposal.slug)} ${chalk.dim(`(${proposal.source})`)}`);
          previewOverrides.set(proposal.note.path, { slug: proposal.slug });
        }
        console.log(chalk.dim(`\n${proposals.length} slug(s) proposed; computing the full hierarchy plan...\n`));
        return;
      }

      for (const proposal of proposals) {
        const { note, slug, source } = proposal;
        if (proposal.warning) showWarning(`${readTitle(note)}: ${proposal.warning}`);
        const metadataChanged =
          note.frontmatter.file_slug !== slug ||
          note.frontmatter.filename_schema !== FILENAME_SCHEMA ||
          note.frontmatter.file_slug_source !== source;
        if (metadataChanged) {
          const result = await collection.update({
            path: note.path,
            fields: {
              file_slug: slug,
              filename_schema: FILENAME_SCHEMA,
              file_slug_source: source,
            },
          });
          if (result.error) throw new Error(`Failed to update ${note.path}: ${result.error.message}`);
          updated++;
          console.log(`${chalk.green("✓")} ${readTitle(note)} → ${slug}`);
        } else {
          console.log(`${chalk.dim("=")} ${readTitle(note)} → ${slug}`);
        }
      }
    }, options.path);

    if (options.preview && previewOverrides) {
      await organizeCommand({
        path: options.path,
        apply: false,
        attachments: true,
        nameOverrides: previewOverrides,
      });
      console.log(chalk.dim("\nPreview only: no files or frontmatter were changed."));
      console.log(chalk.dim("Run with --apply to generate again, persist metadata, and execute this hierarchy plan."));
    } else if (options.apply && selectedCount > 0) {
      console.log(chalk.dim(`\n${updated}/${selectedCount} naming records updated; organizing paths...`));
      await organizeCommand({
        path: options.path,
        apply: true,
        attachments: true,
      });
    }
  } catch (error) {
    showError((error as Error).message);
    process.exitCode = 1;
  }
}

function selectNotes(notes: NoteRecord[], query?: string): NoteRecord[] {
  if (!query) return notes;
  const q = query.toLowerCase();
  const exact = notes.filter((note) =>
    note.path.toLowerCase() === q ||
    basename(note.path, ".md").toLowerCase() === q ||
    readTitle(note).toLowerCase() === q
  );
  if (exact.length > 0) return exact;
  const partial = notes.filter((note) =>
    note.path.toLowerCase().includes(q) || readTitle(note).toLowerCase().includes(q)
  );
  if (partial.length > 1) {
    throw new Error(`Ambiguous note name "${query}". Use an exact title or path.`);
  }
  return partial;
}

function readTitle(note: NoteRecord): string {
  return typeof note.frontmatter.title === "string" && note.frontmatter.title.trim()
    ? note.frontmatter.title.trim()
    : basename(note.path, ".md");
}

function uniqueSlug(base: string, note: NoteRecord, reserved: Set<string>, keepExisting = false): string {
  if (keepExisting || !reserved.has(reservationKey(note, base))) return base;
  let index = 2;
  while (reserved.has(reservationKey(note, withSuffix(base, index)))) index++;
  return withSuffix(base, index);
}

function reservationKey(note: NoteRecord, slug: string): string {
  return `${note.type}:${resolveNamingDate(note.frontmatter, note.path)}:${slug}`;
}

function withSuffix(base: string, index: number): string {
  const suffix = `-${index}`;
  return `${base.slice(0, 28 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

function parseConcurrency(value: string | number | undefined): number {
  const parsed = value === undefined ? 4 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error("--concurrency must be an integer from 1 to 16.");
  }
  return parsed;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}
