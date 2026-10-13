import { CONFIG } from "../config.js";
import { authedJson } from "./api.js";
import { addDays } from "./time.js";

function calendarPath(calendarId, rest) {
  return `${CONFIG.CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}${rest}`;
}

export function listCalendarList(email) {
  return authedJson(email, `${CONFIG.CALENDAR_API}/users/me/calendarList?maxResults=250`);
}

export async function listEvents(email, calendarId, timeMin, timeMax) {
  const items = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await authedJson(email, `${calendarPath(calendarId, "/events")}?${params}`);
    items.push(...(data?.items || []));
    pageToken = data?.nextPageToken || "";
    if (!pageToken) break;
  }
  return items;
}

export function createEvent(email, calendarId, resource) {
  return authedJson(email, calendarPath(calendarId, "/events"), { method: "POST", body: resource });
}

export function updateEvent(email, calendarId, eventId, resource) {
  return authedJson(
    email,
    calendarPath(calendarId, `/events/${encodeURIComponent(eventId)}`),
    { method: "PATCH", body: resource }
  );
}

export function deleteEvent(email, calendarId, eventId) {
  return authedJson(email, calendarPath(calendarId, `/events/${encodeURIComponent(eventId)}`), {
    method: "DELETE",
  });
}

export function canWriteCalendar(calendar) {
  return calendar.accessRole === "owner" || calendar.accessRole === "writer";
}

export function eventResource({ title, location, description, allDay, start, end, timeZone }) {
  const summary = title.trim();
  if (!summary) throw new Error("Add a title.");
  if (allDay) {
    if (!start) throw new Error("Add a start date.");
    const endInclusive = end || start;
    if (endInclusive < start) throw new Error("The end date is before the start date.");
    return {
      summary,
      location: location.trim(),
      description,
      start: { date: start },
      end: { date: addDays(endInclusive, 1) },
    };
  }
  if (!start || !end) throw new Error("Add a start and end.");
  if (end <= start) throw new Error("The end time is before the start time.");
  const stamp = (value) => (value.length === 16 ? `${value}:00` : value);
  return {
    summary,
    location: location.trim(),
    description,
    start: { dateTime: stamp(start), timeZone },
    end: { dateTime: stamp(end), timeZone },
  };
}
