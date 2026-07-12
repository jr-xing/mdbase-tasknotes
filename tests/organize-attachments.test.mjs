import test from "node:test";
import assert from "node:assert/strict";
import { planAttachmentMoves, updateMarkdownBodyLinks } from "../dist/commands/organize-attachments.js";

function scan(binaryRefs) {
  return { binaryRefs, ownedNoteRefs: new Map(), ownedNoteTypes: new Map() };
}

test("single-owner binary uses project-level task bucket without promotion", () => {
  const refs = new Map([["inbox/report.pdf", new Set(["projects/proj/task.md"])]]);
  const desired = new Map([["tasks/task.md", "projects/proj/task.md"]]);
  const plan = planAttachmentMoves(scan(refs), desired, "C:/vault");
  assert.deepEqual(plan.binaryMoves.map((move) => move.to), ["projects/proj/_assets/task/report.pdf"]);
  assert.equal(plan.promotionMoves.length, 0);
});

test("same-project and cross-project binaries use shared buckets", () => {
  const same = planAttachmentMoves(scan(new Map([
    ["a/image.png", new Set(["projects/proj/a.md", "projects/proj/b.md"])],
  ])), new Map([
    ["a.md", "projects/proj/a.md"], ["b.md", "projects/proj/b.md"],
  ]), "C:/vault");
  assert.equal(same.binaryMoves[0].to, "projects/proj/_assets/_shared/image.png");

  const cross = planAttachmentMoves(scan(new Map([
    ["a/image.png", new Set(["projects/one/a.md", "projects/two/b.md"])],
  ])), new Map([
    ["a.md", "projects/one/a.md"], ["b.md", "projects/two/b.md"],
  ]), "C:/vault");
  assert.equal(cross.binaryMoves[0].to, "_assets/_shared/image.png");
});

test("over-budget target paths are skipped with a warning", () => {
  const root = `C:/${"x".repeat(210)}`;
  const plan = planAttachmentMoves(scan(new Map([
    ["a/file.png", new Set(["projects/proj/task.md"])],
  ])), new Map([["task.md", "projects/proj/task.md"]]), root);
  assert.equal(plan.binaryMoves.length, 0);
  assert.deepEqual(plan.stationaryBinaries.map((item) => item.path), ["a/file.png"]);
  assert.match(plan.warnings[0], /exceeds 220/);
});

test("binary moves update markdown links and wikilinks to final paths", () => {
  const moved = new Map([["inbox/report.pdf", "projects/proj/_assets/task/report.pdf"]]);
  const input = "[report](../inbox/report.pdf) ![[report.pdf]] ![[report.pdf|source]]";
  const output = updateMarkdownBodyLinks(input, "projects/proj/task.md", moved, "C:/vault");
  assert.match(output, /\[report\]\(_assets\/task\/report\.pdf\)/);
  assert.match(output, /!\[\[projects\/proj\/_assets\/task\/report\.pdf\]\]/);
  assert.match(output, /!\[\[projects\/proj\/_assets\/task\/report\.pdf\|source\]\]/);
});
