// src/recurrence.ts
import { createRequire } from "module";

// src/date.ts
import { isValid, parseISO } from "date-fns";
var DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))?$/;
function parseDateToUTC(dateString) {
  if (!dateString || dateString.trim().length === 0) {
    throw new Error("Date string cannot be empty");
  }
  const trimmed = dateString.trim();
  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const parsed2 = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    if (parsed2.getUTCFullYear() !== y || parsed2.getUTCMonth() !== m - 1 || parsed2.getUTCDate() !== d) {
      throw new Error(`Invalid date "${dateString}".`);
    }
    return parsed2;
  }
  if (!isStrictDateTime(trimmed)) {
    throw new Error(`Invalid date "${dateString}".`);
  }
  const parsed = parseISO(trimmed);
  if (!isValid(parsed)) {
    throw new Error(`Invalid date "${dateString}".`);
  }
  return parsed;
}
function isStrictDateTime(value) {
  const match = value.match(DATE_TIME_RE);
  if (!match) return false;
  const [, year, month, day, hours, minutes, seconds, , tzSign, tzHours, tzMinutes] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = Number(hours);
  const mm = Number(minutes);
  const ss = Number(seconds);
  if (!isValidClockTime(hh, mm, ss) || !isValidCalendarDate(y, m, d)) {
    return false;
  }
  return isValidOffset(tzSign, tzHours, tzMinutes);
}
function isValidCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function isValidClockTime(hours, minutes, seconds) {
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}
function isValidOffset(tzSign, tzHours, tzMinutes) {
  if (!tzSign) return true;
  const offsetHours = Number(tzHours);
  const offsetMinutes = Number(tzMinutes);
  if (offsetHours > 14 || offsetMinutes > 59) return false;
  if (offsetHours === 14 && offsetMinutes !== 0) return false;
  return true;
}

// src/recurrence.ts
var require2 = createRequire(import.meta.url);
var { RRule } = require2("rrule");
var DTSTART_RE = /DTSTART:(\d{8}(?:T\d{6}Z?)?);?/;
function completeRecurringTask(input) {
  const completionDate = input.completionDate;
  const completeInstances = Array.isArray(input.completeInstances) ? [...input.completeInstances] : [];
  const skippedInstances = Array.isArray(input.skippedInstances) ? [...input.skippedInstances] : [];
  if (!completeInstances.includes(completionDate)) {
    completeInstances.push(completionDate);
  }
  const nextSkippedInstances = skippedInstances.filter((d) => d !== completionDate);
  const schedule = recalculateRecurringScheduleInternal({
    recurrence: input.recurrence,
    recurrenceAnchor: input.recurrenceAnchor,
    scheduled: input.scheduled,
    due: input.due,
    dateCreated: input.dateCreated,
    completeInstances,
    skippedInstances: nextSkippedInstances,
    referenceDate: completionDate,
    completionDateForAnchor: completionDate
  });
  return {
    updatedRecurrence: schedule.updatedRecurrence,
    nextScheduled: schedule.nextScheduled,
    nextDue: schedule.nextDue,
    completeInstances,
    skippedInstances: nextSkippedInstances
  };
}
function recalculateRecurringSchedule(input) {
  return recalculateRecurringScheduleInternal({
    ...input
  });
}
function recalculateRecurringScheduleInternal(input) {
  const anchor = input.recurrenceAnchor === "completion" ? "completion" : "scheduled";
  const sourceDate = input.scheduled || input.dateCreated || input.referenceDate;
  let updatedRecurrence = input.recurrence;
  if (anchor === "completion") {
    const anchorDate = input.completionDateForAnchor || input.referenceDate || sourceDate;
    updatedRecurrence = updateDTSTARTInRecurrenceRule(updatedRecurrence, anchorDate) || updatedRecurrence;
  } else {
    updatedRecurrence = addDTSTARTToRecurrenceRule(updatedRecurrence, sourceDate) || updatedRecurrence;
  }
  const referenceDate = parseDateString(input.referenceDate) || parseDateString(input.scheduled);
  if (!referenceDate) {
    return { updatedRecurrence, nextScheduled: null, nextDue: null };
  }
  const completionDay = parseDateString(input.referenceDate);
  const completeInstances = Array.isArray(input.completeInstances) ? input.completeInstances : [];
  const skippedInstances = Array.isArray(input.skippedInstances) ? input.skippedInstances : [];
  const processedDates = /* @__PURE__ */ new Set([
    ...completeInstances,
    ...skippedInstances,
    formatDateUTC(referenceDate)
  ]);
  let nextOccurrence = getNextOccurrenceDate(updatedRecurrence, sourceDate, referenceDate, true);
  if (completionDay) {
    let guard = 0;
    while (nextOccurrence && nextOccurrence.getTime() < completionDay.getTime() && guard < 1e3) {
      nextOccurrence = getNextOccurrenceDate(
        updatedRecurrence,
        sourceDate,
        nextOccurrence,
        false
      );
      guard++;
    }
  }
  let processedGuard = 0;
  while (nextOccurrence && processedGuard < 1e3) {
    const dateStr = formatDateUTC(nextOccurrence);
    if (!processedDates.has(dateStr)) break;
    nextOccurrence = getNextOccurrenceDate(updatedRecurrence, sourceDate, nextOccurrence, false);
    processedGuard++;
  }
  if (!nextOccurrence) {
    return { updatedRecurrence, nextScheduled: null, nextDue: null };
  }
  const nextScheduled = formatLikeExisting(input.scheduled, nextOccurrence);
  const nextDue = computeNextDue(input, nextOccurrence);
  return { updatedRecurrence, nextScheduled, nextDue };
}
function computeNextDue(input, nextScheduledDate) {
  if (!input.due || !input.scheduled) {
    return null;
  }
  const originalDue = parseDateString(input.due);
  const originalScheduled = parseDateString(input.scheduled);
  if (!originalDue || !originalScheduled) {
    return null;
  }
  const offsetMs = originalDue.getTime() - originalScheduled.getTime();
  const nextDueDate = new Date(nextScheduledDate.getTime() + offsetMs);
  return formatLikeExisting(input.due, nextDueDate);
}
function getNextOccurrenceDate(recurrence, sourceDate, afterDate, inclusive) {
  const rule = buildRRule(recurrence, sourceDate);
  if (!rule) return null;
  return rule.after(afterDate, inclusive);
}
function buildRRule(recurrence, sourceDate) {
  try {
    const dtstartMatch = recurrence.match(DTSTART_RE);
    const rruleString = recurrence.replace(DTSTART_RE, "").replace(/^;/, "").trim();
    if (!rruleString.includes("FREQ=")) {
      return null;
    }
    const options = RRule.parseString(rruleString);
    const dtstart = parseDTSTARTValue(dtstartMatch?.[1]) || parseDateString(sourceDate);
    if (dtstart) {
      options.dtstart = dtstart;
    }
    return new RRule(options);
  } catch {
    return null;
  }
}
function addDTSTARTToRecurrenceRule(recurrence, sourceDate) {
  if (!recurrence || recurrence.includes("DTSTART:")) {
    return recurrence;
  }
  const dtstart = formatDTSTARTValue(sourceDate);
  if (!dtstart) return null;
  return `DTSTART:${dtstart};${recurrence}`;
}
function updateDTSTARTInRecurrenceRule(recurrence, dateStr) {
  if (!recurrence) return null;
  const dtstart = formatDTSTARTValue(dateStr);
  if (!dtstart) return null;
  if (recurrence.includes("DTSTART:")) {
    return recurrence.replace(DTSTART_RE, `DTSTART:${dtstart};`);
  }
  return `DTSTART:${dtstart};${recurrence}`;
}
function formatDTSTARTValue(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes("T")) {
    const parsed2 = parseDateString(dateStr);
    if (!parsed2) return null;
    const year2 = parsed2.getUTCFullYear();
    const month2 = String(parsed2.getUTCMonth() + 1).padStart(2, "0");
    const day2 = String(parsed2.getUTCDate()).padStart(2, "0");
    const hours = String(parsed2.getUTCHours()).padStart(2, "0");
    const minutes = String(parsed2.getUTCMinutes()).padStart(2, "0");
    const seconds = String(parsed2.getUTCSeconds()).padStart(2, "0");
    return `${year2}${month2}${day2}T${hours}${minutes}${seconds}Z`;
  }
  const parsed = parseDateString(dateStr);
  if (!parsed) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
function parseDTSTARTValue(value) {
  if (!value) return null;
  if (value.length === 8) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  }
  const dtMatch = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/
  );
  if (!dtMatch) return null;
  const [, y, m, d, hh, mm, ss] = dtMatch;
  return new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss), 0)
  );
}
function parseDateString(dateStr) {
  if (!dateStr) return null;
  try {
    return parseDateToUTC(dateStr);
  } catch {
    return null;
  }
}
function formatLikeExisting(existingValue, date) {
  const datePart = formatDateUTC(date);
  if (existingValue && existingValue.includes("T")) {
    return `${datePart}T${existingValue.split("T")[1]}`;
  }
  return datePart;
}
function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export {
  completeRecurringTask,
  recalculateRecurringSchedule
};
