import { defineConfig } from "tsup";
import path from "node:path";

const common = {
  format: ["esm"] as const,
  target: "node20",
  outDir: "dist",
  splitting: false,
  noExternal: ["tasknotes-nlp-core", "rrule"],
  esbuildOptions(options: any) {
    options.alias = {
      ...(options.alias || {}),
      rrule: path.resolve("src/shims/rrule.ts"),
    };
  },
};

export default defineConfig([
  {
    ...common,
    entry: ["src/cli.ts"],
    clean: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    ...common,
    entry: [
      "src/date.ts",
      "src/field-mapping.ts",
      "src/recurrence.ts",
      "src/create-compat.ts",
      "src/config.ts",
      "src/collection.ts",
      "src/mapper.ts",
      "src/conformance.ts",
    ],
    clean: false,
  },
]);
