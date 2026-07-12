import { basename, join } from "node:path";
import { statSync } from "node:fs";
import { format } from "date-fns";
import { requestSemanticSlug, resolveLLMSettings, type LLMSettings, type SlugPromptContext } from "./llm.js";
import type { FileSlugSource } from "./types.js";

export const FILENAME_SCHEMA = "compact-v1";
export const MAX_SLUG_LENGTH = 28;

export interface GeneratedSlug {
  slug: string;
  source: FileSlugSource;
  warning?: string;
}

export function fallbackSlug(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return "untitled";
  const three = words.slice(0, 3).join("-");
  if (three.length <= MAX_SLUG_LENGTH) return avoidReservedName(three);
  const two = words.slice(0, 2).join("-");
  if (two.length <= MAX_SLUG_LENGTH) return avoidReservedName(two);
  return avoidReservedName(words[0].slice(0, MAX_SLUG_LENGTH) || "untitled");
}

export function normalizeLLMSlug(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned.length > MAX_SLUG_LENGTH) return null;
  const words = cleaned.split("-").filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  return cleaned;
}

export async function generateSlug(
  context: SlugPromptContext,
  overrides?: { settings?: LLMSettings; fetchImpl?: typeof fetch },
): Promise<GeneratedSlug> {
  const resolved = overrides?.settings ? { settings: overrides.settings } : resolveLLMSettings();
  if (!resolved.settings) {
    return {
      slug: fallbackSlug(context.title),
      source: "fallback",
      warning: resolved.reason === "LLM provider/model not configured" ? undefined : resolved.reason,
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
      warning: (error as Error).message,
    };
  }
}

export function compactStem(noteType: "task" | "project", date: string, slug: string): string {
  return `${date}-${noteType === "project" ? "P" : "T"}-${slug}`;
}

export function resolveNamingDate(
  frontmatter: Record<string, unknown>,
  notePath: string,
  collectionRoot?: string,
): string {
  const created = typeof frontmatter.dateCreated === "string" ? frontmatter.dateCreated : "";
  const createdMatch = created.match(/^(\d{4}-\d{2}-\d{2})/);
  if (createdMatch) return createdMatch[1];
  const nameMatch = basename(notePath).match(/^(\d{4}-\d{2}-\d{2})/);
  if (nameMatch) return nameMatch[1];
  if (collectionRoot) {
    try {
      const stat = statSync(join(collectionRoot, notePath));
      const date = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
      return format(date, "yyyy-MM-dd");
    } catch { /* fall through */ }
  }
  return format(new Date(), "yyyy-MM-dd");
}

export function readStoredSlug(frontmatter: Record<string, unknown>): string | null {
  const value = frontmatter.file_slug;
  if (typeof value !== "string") return null;
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  return cleaned || null;
}

function avoidReservedName(slug: string): string {
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return reserved.test(slug) ? `${slug}-note` : slug;
}

export function desiredCompactStem(
  noteType: "task" | "project",
  frontmatter: Record<string, unknown>,
  notePath: string,
  collectionRoot?: string,
): string | null {
  const slug = readStoredSlug(frontmatter);
  if (!slug) return null;
  return compactStem(noteType, resolveNamingDate(frontmatter, notePath, collectionRoot), slug);
}
