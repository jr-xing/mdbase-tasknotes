// src/date.ts
import { isValid, parseISO } from "date-fns";
var DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))?$/;
var RELAXED_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))?$/;
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
function parseDateToLocal(dateString) {
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
    const parsed2 = new Date(y, m - 1, d, 0, 0, 0, 0);
    if (parsed2.getFullYear() !== y || parsed2.getMonth() !== m - 1 || parsed2.getDate() !== d) {
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
function formatDateForStorage(date) {
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function getCurrentDateString() {
  const now = /* @__PURE__ */ new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function resolveDateOrToday(date) {
  if (!date) {
    return getCurrentDateString();
  }
  return validateDateString(date);
}
function resolveOperationTargetDate(explicitDate, scheduled, due) {
  if (explicitDate) {
    return validateDateString(explicitDate);
  }
  const scheduledDatePart = extractValidDatePartOrUndefined(scheduled);
  if (scheduledDatePart) {
    return scheduledDatePart;
  }
  const dueDatePart = extractValidDatePartOrUndefined(due);
  if (dueDatePart) {
    return dueDatePart;
  }
  return getCurrentDateString();
}
function validateDateString(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD.`);
  }
  parseDateToUTC(date);
  return date;
}
function resolveDateTimeRangeBound(value, bound) {
  if (!value || value.trim().length === 0) {
    throw new Error("Datetime cannot be empty.");
  }
  const trimmed = value.trim();
  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, year2, month2, day2] = dateOnlyMatch;
    const y2 = Number(year2);
    const m2 = Number(month2);
    const d2 = Number(day2);
    if (!isValidCalendarDate(y2, m2, d2)) {
      throw new Error(`Invalid datetime "${value}".`);
    }
    return bound === "from" ? new Date(y2, m2 - 1, d2, 0, 0, 0, 0) : new Date(y2, m2 - 1, d2, 23, 59, 59, 999);
  }
  const match = trimmed.match(RELAXED_DATE_TIME_RE);
  if (!match) {
    throw new Error(
      `Invalid datetime "${value}". Expected YYYY-MM-DD, YYYY-MM-DD HH:mm, or YYYY-MM-DDTHH:mm.`
    );
  }
  const [, year, month, day, hours, minutes, seconds, fraction, tz, tzSign, tzHours, tzMinutes] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = Number(hours);
  const mm = Number(minutes);
  const ss = seconds === void 0 ? bound === "to" ? 59 : 0 : Number(seconds);
  const ms = fraction ? Number(fraction.slice(1).padEnd(3, "0")) : bound === "to" ? 999 : 0;
  if (!isValidCalendarDate(y, m, d) || !isValidClockTime(hh, mm, ss) || !isValidOffset(tzSign, tzHours, tzMinutes)) {
    throw new Error(`Invalid datetime "${value}".`);
  }
  const normalized = `${year}-${month}-${day}T${hours}:${minutes}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}${tz || ""}`;
  const parsed = parseISO(normalized);
  if (!isValid(parsed)) {
    throw new Error(`Invalid datetime "${value}".`);
  }
  return parsed;
}
function hasTimeComponent(dateString) {
  if (!dateString) return false;
  return /T\d{2}:\d{2}/.test(dateString);
}
function getDatePart(dateString) {
  if (!dateString) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  const tIndex = dateString.indexOf("T");
  if (tIndex > -1) {
    return dateString.slice(0, tIndex);
  }
  return formatDateForStorage(parseDateToUTC(dateString));
}
function extractValidDatePartOrUndefined(dateString) {
  if (!dateString || dateString.trim().length === 0) {
    return void 0;
  }
  try {
    const datePart = getDatePart(dateString.trim());
    return validateDateString(datePart);
  } catch {
    return void 0;
  }
}
function isSameDateSafe(date1, date2) {
  try {
    const d1 = parseDateToUTC(getDatePart(date1));
    const d2 = parseDateToUTC(getDatePart(date2));
    return d1.getTime() === d2.getTime();
  } catch {
    return false;
  }
}
function isBeforeDateSafe(date1, date2) {
  try {
    const d1 = parseDateToUTC(getDatePart(date1));
    const d2 = parseDateToUTC(getDatePart(date2));
    return d1.getTime() < d2.getTime();
  } catch {
    return false;
  }
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
export {
  formatDateForStorage,
  getCurrentDateString,
  getDatePart,
  hasTimeComponent,
  isBeforeDateSafe,
  isSameDateSafe,
  parseDateToLocal,
  parseDateToUTC,
  resolveDateOrToday,
  resolveDateTimeRangeBound,
  resolveOperationTargetDate,
  validateDateString
};
