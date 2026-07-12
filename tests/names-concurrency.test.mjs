import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../dist/commands/names.js";

test("bounded name generation preserves order and concurrency limit", async () => {
  let active = 0;
  let maximumActive = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active--;
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8, 10, 12]);
  assert.equal(maximumActive, 3);
});
