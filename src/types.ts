export interface TaskFrontmatter {
  title: string;
  status: string;
  priority?: string;
  due?: string;
  scheduled?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  timeEstimate?: number;
  recurrence?: string;
  recurrenceAnchor?: string;
  completeInstances?: string[];
  skippedInstances?: string[];
  completedDate?: string;
  dateCreated: string;
  dateModified?: string;
  timeEntries?: TimeEntry[];
  [key: string]: unknown;
}

export interface TimeEntry {
  startTime: string;
  endTime?: string;
  description?: string;
}

export interface TaskResult {
  path: string;
  frontmatter: TaskFrontmatter;
  body?: string | null;
}

export interface CLIConfig {
  collectionPath: string | null;
  language: string;
  llmProvider: LLMProvider | null;
  llmModel: string | null;
}

export type LLMProvider = "openai" | "anthropic" | "google";
export type FileSlugSource = "llm" | "fallback" | "manual";
