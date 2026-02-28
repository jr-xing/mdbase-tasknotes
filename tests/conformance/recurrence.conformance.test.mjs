import test from "node:test";
import assert from "node:assert/strict";
import {
  completeRecurringTask,
  recalculateRecurringSchedule,
} from "../../dist/recurrence.js";

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dateCmp(a, b) {
  return a.localeCompare(b);
}

function dateDiffDays(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / (24 * 60 * 60 * 1000));
}

function toDtstartDay(dateStr) {
  return dateStr.replace(/-/g, "");
}

test("recurrence conformance: completeRecurringTask matrix invariants", async (t) => {
  const rules = [
    "FREQ=DAILY",
    "FREQ=WEEKLY;BYDAY=MO",
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=20",
  ];

  const anchors = ["scheduled", "completion"];

  const scheduledDates = [
    "2026-01-05",
    "2026-01-12",
    "2026-02-02",
    "2026-03-01",
    "2026-04-01",
  ];

  const completionOffsets = [0, 1, 7];
  const dueOffsets = [0, 2];

  for (const rule of rules) {
    for (const anchor of anchors) {
      for (const scheduled of scheduledDates) {
        for (const completionOffset of completionOffsets) {
          for (const dueOffset of dueOffsets) {
            const completionDate = addDays(scheduled, completionOffset);
            const due = addDays(scheduled, dueOffset);
            const preComplete = [addDays(scheduled, -7), addDays(scheduled, -3)];
            const preSkipped = [completionDate, addDays(scheduled, -1)];

            await t.test(
              `completeRecurringTask invariant: ${rule} anchor=${anchor} scheduled=${scheduled} completionOffset=${completionOffset} dueOffset=${dueOffset}`,
              () => {
                const result = completeRecurringTask({
                  recurrence: rule,
                  recurrenceAnchor: anchor,
                  scheduled,
                  due,
                  dateCreated: addDays(scheduled, -14),
                  completionDate,
                  completeInstances: preComplete,
                  skippedInstances: preSkipped,
                });

                assert.equal(Array.isArray(result.completeInstances), true);
                assert.equal(Array.isArray(result.skippedInstances), true);
                assert.equal(result.completeInstances.includes(completionDate), true);
                assert.equal(result.skippedInstances.includes(completionDate), false);
                assert.match(result.updatedRecurrence, /FREQ=/);
                assert.match(result.updatedRecurrence, /DTSTART:/);

                if (anchor === "completion") {
                  assert.match(
                    result.updatedRecurrence,
                    new RegExp(`DTSTART:${toDtstartDay(completionDate)}(?:;|$)`),
                  );
                } else {
                  assert.match(
                    result.updatedRecurrence,
                    new RegExp(`DTSTART:${toDtstartDay(scheduled)}(?:;|$)`),
                  );
                }

                if (result.nextScheduled) {
                  assert.equal(dateCmp(result.nextScheduled.slice(0, 10), completionDate) >= 0, true);
                }

                if (result.nextScheduled && result.nextDue) {
                  const gotOffset = dateDiffDays(result.nextScheduled.slice(0, 10), result.nextDue.slice(0, 10));
                  const expectedOffset = dateDiffDays(scheduled, due);
                  assert.equal(gotOffset, expectedOffset);
                }
              },
            );
          }
        }
      }
    }
  }
});

test("recurrence conformance: recalculateRecurringSchedule matrix invariants", async (t) => {
  const rules = [
    "FREQ=DAILY",
    "FREQ=WEEKLY;BYDAY=MO",
    "FREQ=MONTHLY;BYMONTHDAY=1",
  ];

  const anchors = ["scheduled", "completion"];
  const scheduledDates = [
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
  ];

  const referenceOffsets = [0, 2, 7];

  for (const rule of rules) {
    for (const anchor of anchors) {
      for (const scheduled of scheduledDates) {
        for (const refOffset of referenceOffsets) {
          const referenceDate = addDays(scheduled, refOffset);
          const due = addDays(scheduled, 2);
          const completeInstances = [addDays(scheduled, -1), addDays(scheduled, 0), addDays(scheduled, 1)];
          const skippedInstances = [addDays(scheduled, 2), addDays(scheduled, 3)];

          await t.test(
            `recalculateRecurringSchedule invariant: ${rule} anchor=${anchor} scheduled=${scheduled} refOffset=${refOffset}`,
            () => {
              const result = recalculateRecurringSchedule({
                recurrence: rule,
                recurrenceAnchor: anchor,
                scheduled,
                due,
                dateCreated: addDays(scheduled, -10),
                completeInstances,
                skippedInstances,
                referenceDate,
              });

              assert.match(result.updatedRecurrence, /FREQ=/);
              assert.match(result.updatedRecurrence, /DTSTART:/);

              if (anchor === "scheduled") {
                assert.match(
                  result.updatedRecurrence,
                  new RegExp(`DTSTART:${toDtstartDay(scheduled)}(?:;|$)`),
                );
              }

              if (result.nextScheduled) {
                const nextDay = result.nextScheduled.slice(0, 10);
                assert.equal(dateCmp(nextDay, referenceDate) >= 0, true);
                assert.equal(completeInstances.includes(nextDay), false);
                assert.equal(skippedInstances.includes(nextDay), false);
              }

              if (result.nextScheduled && result.nextDue) {
                const offset = dateDiffDays(result.nextScheduled.slice(0, 10), result.nextDue.slice(0, 10));
                assert.equal(offset, 2);
              }
            },
          );
        }
      }
    }
  }
});

test("recurrence conformance: idempotency and processed-state transitions", async (t) => {
  const recurrence = "FREQ=DAILY";
  const scheduled = "2026-02-20";
  const due = "2026-02-21";
  const completionDate = "2026-02-22";

  await t.test("completeRecurringTask is idempotent for completeInstances insertion", () => {
    const first = completeRecurringTask({
      recurrence,
      recurrenceAnchor: "scheduled",
      scheduled,
      due,
      completionDate,
      completeInstances: [completionDate],
      skippedInstances: [],
    });

    const second = completeRecurringTask({
      recurrence: first.updatedRecurrence,
      recurrenceAnchor: "scheduled",
      scheduled: first.nextScheduled || scheduled,
      due: first.nextDue || due,
      completionDate,
      completeInstances: first.completeInstances,
      skippedInstances: first.skippedInstances,
    });

    assert.equal(first.completeInstances.filter((d) => d === completionDate).length, 1);
    assert.equal(second.completeInstances.filter((d) => d === completionDate).length, 1);
  });

  await t.test("completeRecurringTask removes completion day from skippedInstances", () => {
    const result = completeRecurringTask({
      recurrence,
      recurrenceAnchor: "scheduled",
      scheduled,
      due,
      completionDate,
      completeInstances: [],
      skippedInstances: [completionDate, "2026-02-23"],
    });

    assert.equal(result.skippedInstances.includes(completionDate), false);
    assert.equal(result.skippedInstances.includes("2026-02-23"), true);
  });

  await t.test("recalculateRecurringSchedule skips processed dates", () => {
    const result = recalculateRecurringSchedule({
      recurrence,
      recurrenceAnchor: "scheduled",
      scheduled,
      due,
      referenceDate: "2026-02-20",
      completeInstances: ["2026-02-21", "2026-02-22", "2026-02-23"],
      skippedInstances: ["2026-02-24"],
    });

    assert.equal(result.nextScheduled, "2026-02-25");
    assert.equal(result.nextDue, "2026-02-26");
  });
});
