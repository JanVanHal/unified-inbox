const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

export function dateKeyFromDate(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayKey(timeZone) {
  return dateKeyFromDate(new Date(), timeZone);
}

export function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addMonths(dateKey, months) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDate(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(day, last));
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function zoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - date.getTime();
}

/** Wall-clock date (YYYY-MM-DD) and time (HH:MM) in `timeZone`, as an absolute Date. */
export function zonedWallToDate(dateKey, hm, timeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = hm.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  let result = guess - offset;
  const offset2 = zoneOffsetMs(new Date(result), timeZone);
  if (offset2 !== offset) result = guess - offset2;
  return new Date(result);
}

export function startOfDay(dateKey, timeZone) {
  return zonedWallToDate(dateKey, "00:00", timeZone);
}

export function weekdayMon0(dateKey, timeZone) {
  const noon = zonedWallToDate(dateKey, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(noon);
  return { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[name] ?? 0;
}

export function weekStart(dateKey, timeZone) {
  return addDays(dateKey, -weekdayMon0(dateKey, timeZone));
}

export function eachDate(start, endExclusive) {
  const days = [];
  let cursor = start;
  while (cursor < endExclusive && days.length < 62) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function visibleRange(mode, cursor, timeZone) {
  if (mode === "month") {
    const first = `${cursor.slice(0, 7)}-01`;
    const start = weekStart(first, timeZone);
    const end = addDays(start, 42);
    return { start, end, days: eachDate(start, end), month: cursor.slice(0, 7) };
  }
  if (mode === "week") {
    const start = weekStart(cursor, timeZone);
    const end = addDays(start, 7);
    return { start, end, days: eachDate(start, end) };
  }
  const end = addDays(cursor, 21);
  return { start: cursor, end, days: eachDate(cursor, end) };
}

export function formatMailDate(ms, timeZone) {
  const date = new Date(Number(ms) || 0);
  const key = dateKeyFromDate(date, timeZone);
  const today = todayKey(timeZone);
  const parts = zonedParts(date, timeZone);
  if (key === today) return `${parts.hour}:${parts.minute}`;
  if (key === addDays(today, -1)) return "Yesterday";
  const day = String(Number(parts.day));
  const month = MONTHS_SHORT[Number(parts.month) - 1];
  if (parts.year === today.slice(0, 4)) return `${day} ${month}`;
  return `${day} ${month} ${parts.year}`;
}

export function formatFull(ms, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Number(ms) || 0));
}

export function formatTime(ms, timeZone) {
  const parts = zonedParts(new Date(Number(ms) || 0), timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function formatDateTimeLocal(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function shortDate(dateKey) {
  const [, month, day] = dateKey.split("-");
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]}`;
}

export function monthLabel(dateKey) {
  const [year, month] = dateKey.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export function weekdayShort(dateKey, timeZone) {
  const noon = zonedWallToDate(dateKey, "12:00", timeZone);
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(noon);
}

export function rangeTitle(mode, cursor, timeZone) {
  if (mode === "month") return monthLabel(cursor);
  const range = visibleRange(mode, cursor, timeZone);
  const last = addDays(range.end, -1);
  if (mode === "week" && range.start.slice(0, 7) === last.slice(0, 7)) {
    return `${Number(range.start.slice(8))}–${Number(last.slice(8))} ${MONTHS_SHORT[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}`;
  }
  const sameYear = range.start.slice(0, 4) === last.slice(0, 4);
  if (sameYear) return `${shortDate(range.start)} – ${shortDate(last)} ${last.slice(0, 4)}`;
  return `${shortDate(range.start)} ${range.start.slice(0, 4)} – ${shortDate(last)} ${last.slice(0, 4)}`;
}
