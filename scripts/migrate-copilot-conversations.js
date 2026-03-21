#!/usr/bin/env node

/**
 * Migration script to add `type: copilot-conversation` to existing copilot conversation files.
 *
 * Usage:
 *   node scripts/migrate-copilot-conversations.js [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be changed without actually modifying files
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to copilot conversations directory
const COPILOT_DIR = 'C:\\Users\\jx332\\Documents\\Obsidian\\ResearchKelan\\copilot\\copilot-conversations';

// Check for --dry-run flag
const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  console.log('🔍 DRY RUN MODE - No files will be modified\n');
}

if (!fs.existsSync(COPILOT_DIR)) {
  console.error(`❌ Directory not found: ${COPILOT_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(COPILOT_DIR).filter(f => f.endsWith('.md'));

console.log(`Found ${files.length} markdown files in ${COPILOT_DIR}\n`);

let updatedCount = 0;
let skippedCount = 0;
let errorCount = 0;

for (const file of files) {
  const fullPath = path.join(COPILOT_DIR, file);

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Check if file starts with frontmatter
    if (!content.startsWith('---\n')) {
      console.log(`⚠️  Skipping ${file} - No frontmatter found`);
      skippedCount++;
      continue;
    }

    // Check if already has type: copilot-conversation
    if (content.includes('type: copilot-conversation')) {
      console.log(`✓ ${file} - Already has type field`);
      skippedCount++;
      continue;
    }

    // Add type: copilot-conversation after the opening ---
    const updatedContent = content.replace(/^---\n/, '---\ntype: copilot-conversation\n');

    if (isDryRun) {
      console.log(`📝 Would update: ${file}`);
      updatedCount++;
    } else {
      fs.writeFileSync(fullPath, updatedContent, 'utf-8');
      console.log(`✓ Updated: ${file}`);
      updatedCount++;
    }
  } catch (error) {
    console.error(`❌ Error processing ${file}:`, error.message);
    errorCount++;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('Migration Summary:');
console.log(`  Updated: ${updatedCount} files`);
console.log(`  Skipped: ${skippedCount} files`);
console.log(`  Errors:  ${errorCount} files`);

if (isDryRun && updatedCount > 0) {
  console.log(`\nTo apply changes, run without --dry-run flag:`);
  console.log(`  node scripts/migrate-copilot-conversations.js`);
}

console.log('✅ Migration complete!');
