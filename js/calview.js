import { actions } from "./actions.js";
import { canWriteCalendar } from "./calendar.js";
import { state } from "./state.js";
import { getTimezone } from "./storage.js";
import {
  addDays,
  formatDateTimeLocal,
  formatTime,
  rangeTitle,
  shortDate,
  startOfDay,
  visibleRange,
  weekdayShort,
  zonedParts,
  todayKey,
} from "./time.js";
import { el, toast } from "./util.js";

const HOUR = 48;
let editing = null;
let weekScroll = null;
let weekKey = "";

export function initCalendar() {
  document.querySelectorAll("[data-cal]").forEach((button) => {
    button.addEventListener("click", () => actions.setCalMode(button.dataset.cal));
  });
  document.getElementById("cal-prev").addEventListener("click", () => actions.shiftCalendar(-1));
  document.getElementById("cal-next").addEventListener("click", () => actions.shiftCalendar(1));
  document.getElementById("cal-today").addEventListener("click", () => actions.calToday());
  document.getElementById("new-event").addEventListener("click", () => showNewEvent({}));
  document.getElementById("event-all-day").addEventListener("change", syncAllDayInputs);
  document.getElementById("event-delete").addEventListener("click", () => {
    if (editing) actions.deleteEvent(editing);
  });
  document.getElementById("event-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const save = document.getElementById("event-save");
    save.disabled = true;
    Promise.resolve(actions.saveEvent({
      existing: editing,
      calendarKey: document.getElementById("event-calendar").value,
      title: document.getElementById("event-title").value,
      location: document.getElementById("event-location").value,
      description: document.getElementById("event-description").value,
      allDay: document.getElementById("event-all-day").checked,
      start: document.getElementById("event-start").value,
      end: document.getElementById("event-end").value,
    })).finally(() => {
      if (document.getElementById("event-dialog").open) save.disabled = false;
    });
  });
}

export function setEventError(message) {
  const node = document.getElementById("event-error");
  node.hidden = !message;
  node.textContent = message || "";
}

export function showNewEvent({ date, hour = 9, minute = 0, allDay = false } = {}) {
  const writable = state.calendars.filter(canWriteCalendar);
  if (!writable.length) {
    if (state.calLoading) toast("Calendars are still loading.");
    else actions.needWritableCalendar();
    return;
  }
  const day = date || state.calDate;
  let endDay = day;
  let endHour = hour + 1;
  let endMinute = minute;
  if (!allDay && endHour >= 24) {
    endDay = addDays(day, 1);
    endHour = 0;
  }
  const pad = (value) => String(value).padStart(2, "0");
  showEventForm({
    heading: "New event",
    calendarKey: defaultCalendarKey(writable),
    title: "",
    allDay,
    start: allDay ? day : `${day}T${pad(hour)}:${pad(minute)}`,
    end: allDay ? day : `${endDay}T${pad(endHour)}:${pad(endMinute)}`,
    location: "",
    description: "",
    existing: null,
    readOnly: false,
  });
}

export function showEvent(event) {
  const timeZone = getTimezone();
  let start = event.allDay ? event.startDate : formatDateTimeLocal(new Date(event.startMs), timeZone);
  let end = event.allDay
    ? addDays(event.endDate || addDays(event.startDate, 1), -1)
    : formatDateTimeLocal(new Date(event.endMs), timeZone);
  if (!event.allDay && end <= start) end = formatDateTimeLocal(new Date(event.startMs + 30 * 60 * 1000), timeZone);
  if (event.allDay && end < start) end = start;
  showEventForm({
    heading: event.canWrite ? "Edit event" : "Event",
    calendarKey: `${event.accountEmail}::${event.calendarId}`,
    title: event.title === "(no title)" ? "" : event.title,
    allDay: event.allDay,
    start,
    end,
    location: event.location,
    description: event.description,
    existing: event,
    readOnly: !event.canWrite,
  });
}

function defaultCalendarKey(writable) {
  const primary = writable.find((calendar) => calendar.primary) || writable[0];
  return primary?.key || "";
}

function showEventForm(draft) {
  editing = draft.existing;
  const dialog = document.getElementById("event-dialog");
  document.getElementById("event-heading").textContent = draft.heading;
  document.getElementById("event-zone-note").textContent = draft.allDay
    ? "All-day events use the date you pick."
    : `Times use ${getTimezone()}.`;
  fillCalendars(draft.calendarKey, draft.readOnly);
  document.getElementById("event-title").value = draft.title || "";
  document.getElementById("event-location").value = draft.location || "";
  document.getElementById("event-description").value = draft.description || "";
  document.getElementById("event-all-day").checked = !!draft.allDay;
  setWhen(!!draft.allDay, draft.start, draft.end);
  const readOnly = !!draft.readOnly;
  for (const id of ["event-calendar", "event-title", "event-location", "event-description", "event-all-day", "event-start", "event-end"]) {
    document.getElementById(id).disabled = readOnly;
  }
  document.getElementById("event-save").hidden = readOnly;
  const remove = document.getElementById("event-delete");
  remove.hidden = !draft.existing || readOnly;
  setEventError("");
  if (readOnly) {
    document.getElementById("event-zone-note").textContent = "You can view this calendar, but you cannot change it.";
  }
  if (!dialog.open) dialog.showModal();
  if (!readOnly) document.getElementById("event-title").focus();
}

function fillCalendars(selectedKey, readOnly) {
  const select = document.getElementById("event-calendar");
  select.replaceChildren();
  let calendars = state.calendars.filter(canWriteCalendar);
  if (readOnly) calendars = state.calendars.filter((calendar) => calendar.key === selectedKey);
  if (!calendars.some((calendar) => calendar.key === selectedKey)) {
    const current = state.calendars.find((calendar) => calendar.key === selectedKey);
    if (current) calendars = [current, ...calendars];
  }
  for (const calendar of calendars) {
    const option = el("option", {
      value: calendar.key,
      text: `${calendar.summary} · ${calendar.accountEmail}`,
    });
    if (calendar.key === selectedKey) option.selected = true;
    select.append(option);
  }
}

function setWhen(allDay, startValue, endValue) {
  const start = document.getElementById("event-start");
  const end = document.getElementById("event-end");
  const type = allDay ? "date" : "datetime-local";
  start.type = type;
  end.type = type;
  start.value = allDay ? String(startValue || "").slice(0, 10) : startValue;
  end.value = allDay ? String(endValue || "").slice(0, 10) : endValue;
}

function syncAllDayInputs() {
  const allDay = document.getElementById("event-all-day").checked;
  const start = document.getElementById("event-start");
  const end = document.getElementById("event-end");
  const startValue = start.value;
  const endValue = end.value;
  document.getElementById("event-zone-note").textContent = allDay
    ? "All-day events use the date you pick. End is the last day."
    : `Times use ${getTimezone()}.`;
  if (allDay) setWhen(true, startValue.slice(0, 10), (endValue || startValue).slice(0, 10));
  else {
    const day = (startValue || state.calDate).slice(0, 10);
    const endDay = (endValue || day).slice(0, 10);
    setWhen(false, startValue.length > 10 ? startValue : `${day}T09:00`, endValue.length > 10 ? endValue : `${endDay}T10:00`);
  }
}

export function renderCalendar() {
  const canvas = document.getElementById("cal-canvas");
  const errors = document.getElementById("cal-errors");
  const timeZone = getTimezone();
  const nextKey = `${state.calMode}:${state.calDate}`;
  if (nextKey !== weekKey) weekScroll = null;
  weekKey = nextKey;
  document.getElementById("cal-heading").textContent = rangeTitle(state.calMode, state.calDate, timeZone);
  document.querySelectorAll("[data-cal]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.cal === state.calMode ? "true" : "false");
  });
  const noun = state.calMode === "month" ? "month" : state.calMode === "agenda" ? "three weeks" : "week";
  document.getElementById("cal-prev").setAttribute("aria-label", `Previous ${noun}`);
  document.getElementById("cal-next").setAttribute("aria-label", `Next ${noun}`);
  errors.replaceChildren();
  for (const error of state.calErrors) {
    const banner = el("div", { class: "banner" });
    const who = error.email ? `${error.email}: ` : "";
    banner.append(el("span", { text: `${who}${error.message}` }));
    if (error.auth && error.email) {
      banner.append(el("button", {
        type: "button",
        class: "chip",
        text: "Reconnect",
        onClick: () => actions.reconnect(error.email),
      }));
    }
    errors.append(banner);
  }
  const view = state.calMode === "month" ? renderMonth(timeZone) : state.calMode === "agenda" ? renderAgenda(timeZone) : renderWeek(timeZone);
  canvas.replaceChildren(view);
  if (state.calLoading) canvas.prepend(el("p", { class: "status", text: "Loading calendar…" }));
}

function renderAgenda(timeZone) {
  const range = visibleRange("agenda", state.calDate, timeZone);
  const wrap = el("div");
  let any = false;
  for (const day of range.days) {
    const events = state.events.filter((event) => eventOccurs(event, day, timeZone));
    if (!events.length) continue;
    any = true;
    const section = el("section", { class: "agenda-day" });
    section.append(el("h3", { text: `${weekdayShort(day, timeZone)} ${shortDate(day)}` }));
    for (const event of events) {
      const button = el("button", {
        type: "button",
        class: "agenda-item",
        style: `border-color:${event.color};border-left-color:${event.color}`,
      });
      const when = event.allDay ? "All day" : `${formatTime(event.startMs, timeZone)}–${formatTime(event.endMs, timeZone)}`;
      button.append(
        el("span", { class: "acct-dot", style: `background:${event.accountColor}`, title: event.accountEmail }),
        el("span", { class: "when-col", text: when }),
        el("span", { text: event.title }),
        el("span", { class: "where", text: event.location || event.calendarSummary }),
      );
      button.addEventListener("click", () => showEvent(event));
      section.append(button);
    }
    wrap.append(section);
  }
  if (!any) {
    wrap.append(el("p", {
      class: "agenda-empty",
      text: state.calLoading ? "Loading events…" : "No events in these three weeks.",
    }));
  }
  return wrap;
}

function renderWeek(timeZone) {
  const range = visibleRange("week", state.calDate, timeZone);
  const today = todayKey(timeZone);
  const wrap = el("div", { class: "week" });
  const head = el("div", { class: "week-head" });
  head.append(el("div"));
  for (const day of range.days) {
    const cell = el("div", { class: day === today ? "day-head is-today" : "day-head" });
    cell.append(document.createTextNode(weekdayShort(day, timeZone)));
    cell.append(el("strong", { text: String(Number(day.slice(8))) }));
    head.append(cell);
  }
  const allDay = el("div", { class: "allday" });
  allDay.append(el("div", { class: "allday-label", text: "all day" }));
  for (const day of range.days) {
    const cell = el("div", { class: "allday-cell" });
    for (const event of state.events) {
      if (event.allDay && day >= event.startDate && day < (event.endDate || addDays(event.startDate, 1))) {
        cell.append(eventChip(event, "allday-chip"));
      }
    }
    cell.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      showNewEvent({ date: day, allDay: true });
    });
    allDay.append(cell);
  }
  const scroll = el("div", { class: "week-scroll" });
  const grid = el("div", { class: "week-grid" });
  const hours = el("div", { class: "hours" });
  for (let hour = 0; hour < 24; hour++) {
    hours.append(el("div", { class: "hour-label", text: String(hour).padStart(2, "0") }));
  }
  grid.append(hours);
  for (const day of range.days) {
    const column = el("div", { class: "day-col" });
    const timed = state.events.filter((event) => !event.allDay && overlapsDay(event, day, timeZone));
    for (const item of layoutDay(timed, day, timeZone)) {
      const button = el("button", {
        type: "button",
        class: "event",
        style: [
          `top:${(item.startMin / 60) * HOUR}px`,
          `height:${Math.max(20, ((item.endMin - item.startMin) / 60) * HOUR - 2)}px`,
          `left:calc(${item.col} * (100% / ${item.colCount}) + 2px)`,
          `width:calc(100% / ${item.colCount} - 4px)`,
          "right:auto",
          `background:${item.event.color}`,
          `color:${item.event.foreground}`,
        ].join(";"),
      });
      button.append(el("strong", { text: item.event.title }));
      button.append(document.createTextNode(formatTime(item.event.startMs, timeZone)));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        showEvent(item.event);
      });
      column.append(button);
    }
    column.addEventListener("click", (event) => {
      if (event.target.closest(".event")) return;
      const rect = column.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round((y / HOUR) * 60 / 15) * 15));
      showNewEvent({
        date: day,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
        allDay: false,
      });
    });
    grid.append(column);
  }
  if (range.days.includes(today)) {
    const parts = zonedParts(new Date(), timeZone);
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    grid.append(el("div", { class: "now-line", style: `top:${(minutes / 60) * HOUR}px` }));
  }
  scroll.append(grid);
  scroll.addEventListener("scroll", () => { weekScroll = scroll.scrollTop; });
  wrap.append(head, allDay, scroll);
  requestAnimationFrame(() => {
    if (weekScroll != null) scroll.scrollTop = weekScroll;
    else {
      const hour = range.days.includes(today) ? Number(zonedParts(new Date(), timeZone).hour) : 8;
      scroll.scrollTop = Math.max(0, hour * HOUR - 24);
    }
  });
  return wrap;
}

function renderMonth(timeZone) {
  const range = visibleRange("month", state.calDate, timeZone);
  const today = todayKey(timeZone);
  const month = state.calDate.slice(0, 7);
  const wrap = el("div");
  const labels = el("div", { class: "dow" });
  for (const name of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) labels.append(el("div", { text: name }));
  const grid = el("div", { class: "month-grid" });
  for (const day of range.days) {
    const cell = el("div", {
      class: `month-cell${day.slice(0, 7) === month ? "" : " is-out"}${day === today ? " is-today" : ""}`,
    });
    const number = el("button", {
      type: "button",
      class: "day-num",
      text: String(Number(day.slice(8))),
      "aria-label": `New event on ${shortDate(day)}`,
    });
    number.addEventListener("click", () => showNewEvent({ date: day, allDay: true }));
    cell.append(number);
    const events = state.events.filter((event) => eventOccurs(event, day, timeZone));
    events.slice(0, 3).forEach((event) => cell.append(eventChip(event, "month-chip")));
    if (events.length > 3) {
      const more = el("button", { type: "button", class: "more", text: `+${events.length - 3} more` });
      more.addEventListener("click", () => actions.showDay(day));
      cell.append(more);
    }
    grid.append(cell);
  }
  wrap.append(labels, grid);
  return wrap;
}

function eventChip(event, className) {
  const button = el("button", {
    type: "button",
    class: className,
    style: `border-left-color:${event.color}`,
  });
  button.append(
    el("span", { class: "acct-dot", style: `background:${event.accountColor}`, title: event.accountEmail }),
    el("span", { text: event.title }),
  );
  button.addEventListener("click", (click) => {
    click.stopPropagation();
    showEvent(event);
  });
  return button;
}

function eventOccurs(event, day, timeZone) {
  if (event.allDay) return day >= event.startDate && day < (event.endDate || addDays(event.startDate, 1));
  return overlapsDay(event, day, timeZone);
}

function overlapsDay(event, day, timeZone) {
  const bounds = dayBounds(day, timeZone);
  return event.endMs > bounds.start && event.startMs < bounds.end;
}

function dayBounds(day, timeZone) {
  return {
    start: startOfDay(day, timeZone).getTime(),
    end: startOfDay(addDays(day, 1), timeZone).getTime(),
  };
}

function layoutDay(events, day, timeZone) {
  const bounds = dayBounds(day, timeZone);
  const items = events.map((event) => {
    const start = Math.max(event.startMs, bounds.start);
    const end = Math.min(event.endMs, bounds.end);
    const startMin = (start - bounds.start) / 60000;
    let endMin = (end - bounds.start) / 60000;
    if (endMin < startMin + 15) endMin = startMin + 15;
    return { event, startMin, endMin, col: 0, colCount: 1 };
  }).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const groups = [];
  let group = [];
  let groupEnd = -1;
  for (const item of items) {
    if (group.length && item.startMin >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  if (group.length) groups.push(group);
  for (const cluster of groups) {
    const columns = [];
    for (const item of cluster) {
      let placed = false;
      for (let index = 0; index < columns.length; index++) {
        if (columns[index] <= item.startMin + 0.01) {
          item.col = index;
          columns[index] = item.endMin;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = columns.length;
        columns.push(item.endMin);
      }
    }
    for (const item of cluster) item.colCount = Math.max(1, columns.length);
  }
  return items;
}
