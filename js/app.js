import { actions } from "./actions.js";
import {
  addAccountInteractive,
  ensureAccessToken,
  hydrateTokens,
  reconnectInteractive,
  resetTokenClient,
  revokeAndRemove,
  tokenState,
  waitForGsi,
} from "./auth.js";
import {
  canWriteCalendar,
  createEvent,
  deleteEvent,
  eventResource,
  listCalendarList,
  listEvents,
  updateEvent,
} from "./calendar.js";
import {
  folderLabelIds,
  getAttachment,
  getThread,
  listThreads,
  mailQuery,
  modifyThread,
  sendMessage,
  trashThread,
} from "./gmail.js";
import { openCompose, plainFromMessage, renderList, renderReading, setComposeError, syncSelection, initMail } from "./mail.js";
import { decodeBodyData, parseMessage, summarizeThread } from "./parse-mail.js";
import {
  buildRawMessage,
  buildReferences,
  formatAddressInput,
  forwardSubject,
  isValidEmail,
  parseAddressList,
  quoteText,
  replySubject,
  replyTargets,
} from "./rfc2822.js";
import { renderCalendar, setEventError, showEvent, showNewEvent, initCalendar } from "./calview.js";
import {
  applyTheme,
  initShell,
  openSettingsDialog,
  renderAccounts,
  renderCalendars,
  showApp,
  showClientError,
  showFirstRun,
  syncShell,
  toggleTheme,
  watchSystemTheme,
} from "./shell.js";
import { initShortcuts } from "./shortcuts.js";
import {
  accountOf,
  enabledAccounts,
  initState,
  notify,
  releaseBlobs,
  state,
  subscribe,
} from "./state.js";
import {
  getAccounts,
  getCalendarSelection,
  getClientId,
  getTimezone,
  setCalendarSelected,
  setClientId,
  upsertAccount,
} from "./storage.js";
import { accountKey, base64UrlToBlob, contrastColor, downloadBlob, mapPool, toast } from "./util.js";
import { addDays, addMonths, formatFull, startOfDay, todayKey, visibleRange } from "./time.js";

let started = false;
let calendarStamp = "";

function onTopic(topic) {
  if (topic === "all" || topic === "shell" || topic === "reading") syncShell();
  if (topic === "all" || topic === "accounts") renderAccounts();
  if (topic === "all" || topic === "calendar" || topic === "accounts") renderCalendars();
  if (topic === "all" || topic === "mail-list" || topic === "accounts") renderList();
  if (topic === "selection") syncSelection();
  if (topic === "all" || topic === "reading") renderReading();
  if (topic === "all" || topic === "calendar") renderCalendar();
}

function accountsForMail() {
  return state.accounts.filter((account) => {
    if (!account.enabled) return false;
    if (state.accountFilter !== "all" && accountKey(account.email) !== accountKey(state.accountFilter)) return false;
    return true;
  });
}

async function connectAccounts() {
  const pending = enabledAccounts().filter((account) => tokenState(account.email) !== "ok");
  await Promise.allSettled(pending.map((account) => ensureAccessToken(account.email)));
  notify("accounts");
}

async function loadMail({ append = false } = {}) {
  if (append && state.listLoading) return;
  const gen = ++state.listGen;
  state.listLoading = true;
  if (!append) {
    state.threads = [];
    state.cursors = {};
    state.listErrors = [];
    state.open = null;
    state.mobileReading = false;
    releaseBlobs();
  }
  notify("mail-list");
  notify("reading");
  const accounts = accountsForMail();
  if (!accounts.length) {
    state.listLoading = false;
    notify("mail-list");
    return;
  }
  const results = await Promise.allSettled(accounts.map(async (account) => {
    if (tokenState(account.email) === "reconnect") {
      const error = new Error("Needs a reconnect.");
      error.auth = true;
      throw error;
    }
    const cursor = state.cursors[account.email];
    if (append && (!cursor?.next || cursor.done)) {
      return { email: account.email, threads: [], next: null, done: true };
    }
    const data = await listThreads(account.email, {
      query: mailQuery({ folder: state.folder, query: state.query, unreadOnly: state.unreadOnly }),
      labelIds: folderLabelIds(state.folder),
      pageToken: append ? cursor?.next || "" : "",
      maxResults: 20,
    });
    const listed = data?.threads || [];
    const threads = await mapPool(listed, 5, async (item) => {
      try {
        const meta = await getThread(account.email, item.id, "metadata");
        if (!meta.snippet) meta.snippet = item.snippet || "";
        return summarizeThread(meta, account.email, state.folder);
      } catch {
        return summarizeThread({ id: item.id, snippet: item.snippet || "", messages: [] }, account.email, state.folder);
      }
    });
    return { email: account.email, threads, next: data?.nextPageToken || null, done: !data?.nextPageToken };
  }));
  if (gen !== state.listGen) return;
  const tried = new Set(accounts.map((account) => accountKey(account.email)));
  const errors = (append ? state.listErrors : []).filter((error) => !tried.has(accountKey(error.email)));
  const merged = append ? state.threads.slice() : [];
  results.forEach((result, index) => {
    const account = accounts[index];
    if (result.status === "rejected") {
      errors.push({
        email: account.email,
        message: result.reason?.message || "Couldn't load mail.",
        auth: !!result.reason?.auth,
      });
      return;
    }
    state.cursors[result.value.email] = { next: result.value.next, done: result.value.done };
    for (const thread of result.value.threads) {
      if (!merged.some((item) => item.key === thread.key)) merged.push(thread);
    }
  });
  merged.sort((a, b) => b.date - a.date || a.accountEmail.localeCompare(b.accountEmail));
  state.threads = merged;
  state.listErrors = errors;
  state.listLoading = false;
  if (!merged.some((thread) => thread.key === state.selectedKey)) state.selectedKey = merged[0]?.key || "";
  notify("mail-list");
  notify("accounts");
}

function removeThread(key) {
  state.threads = state.threads.filter((thread) => thread.key !== key);
  if (state.open?.key === key) {
    state.open = null;
    state.mobileReading = false;
    releaseBlobs();
  }
  if (state.selectedKey === key) state.selectedKey = state.threads[0]?.key || "";
  notify("mail-list");
  notify("reading");
}

function findThread(key) {
  return state.threads.find((thread) => thread.key === key) || null;
}

async function openThread(key, { focus = false } = {}) {
  const summary = findThread(key);
  if (!summary) return;
  state.selectedKey = key;
  state.mobileReading = true;
  state.focusReading = focus;
  state.openLoading = true;
  releaseBlobs();
  state.open = { ...summary, messages: [], loading: true, error: "" };
  const gen = ++state.openGen;
  notify("reading");
  notify("selection");
  try {
    const raw = await getThread(summary.accountEmail, summary.id, "full");
    const messages = [];
    for (const message of raw?.messages || []) {
      const parsed = parseMessage(message);
      if (!parsed.html && parsed.htmlAttachment) {
        const data = await getAttachment(summary.accountEmail, parsed.id, parsed.htmlAttachment);
        parsed.html = decodeBodyData(data?.data || "");
      }
      if (!parsed.text && parsed.textAttachment) {
        const data = await getAttachment(summary.accountEmail, parsed.id, parsed.textAttachment);
        parsed.text = decodeBodyData(data?.data || "");
      }
      messages.push(parsed);
    }
    if (gen !== state.openGen) return;
    const subject = messages.map((message) => message.subject).find(Boolean) || summary.subject;
    const wasUnread = summary.unread;
    summary.unread = false;
    state.open = {
      ...summary,
      subject: subject || summary.subject,
      messages,
      loading: false,
      error: "",
      unread: false,
    };
    state.openLoading = false;
    notify("reading");
    notify("mail-list");
    if (wasUnread) {
      modifyThread(summary.accountEmail, summary.id, [], ["UNREAD"]).catch((error) => {
        summary.unread = true;
        if (state.open?.key === summary.key) state.open.unread = true;
        notify("mail-list");
        notify("reading");
        toast(error.message || "Couldn't mark that conversation read.", { error: true });
      });
    }
  } catch (error) {
    if (gen !== state.openGen) return;
    state.openLoading = false;
    state.open = {
      ...summary,
      messages: [],
      loading: false,
      error: error.message || "Couldn't open this conversation.",
    };
    notify("reading");
    if (error.auth) notify("accounts");
  }
}

async function setUnread(key, unread) {
  const thread = findThread(key);
  if (!thread || thread.unread === unread) {
    if (state.open?.key === key && state.open.unread !== unread) state.open.unread = thread?.unread ?? unread;
    return;
  }
  try {
    if (unread) await modifyThread(thread.accountEmail, thread.id, ["UNREAD"], []);
    else await modifyThread(thread.accountEmail, thread.id, [], ["UNREAD"]);
    thread.unread = unread;
    if (state.open?.key === key) state.open.unread = unread;
    if (!unread && state.unreadOnly) {
      state.threads = state.threads.filter((item) => item.key !== key);
      if (state.selectedKey === key) state.selectedKey = state.threads[0]?.key || state.open?.key || "";
    }
    notify("mail-list");
    notify("reading");
  } catch (error) {
    toast(error.message || "Couldn't update that conversation.", { error: true });
    if (error.auth) notify("accounts");
  }
}

async function star(key) {
  const thread = findThread(key);
  if (!thread) return;
  const next = !thread.starred;
  thread.starred = next;
  if (state.open?.key === key) state.open.starred = next;
  notify("mail-list");
  if (state.open?.key === key) notify("reading");
  try {
    if (next) await modifyThread(thread.accountEmail, thread.id, ["STARRED"], []);
    else await modifyThread(thread.accountEmail, thread.id, [], ["STARRED"]);
  } catch (error) {
    thread.starred = !next;
    if (state.open?.key === key) state.open.starred = !next;
    notify("mail-list");
    if (state.open?.key === key) notify("reading");
    toast(error.message || "Couldn't change the star.", { error: true });
  }
}

async function archive(key) {
  const thread = findThread(key) || (state.open?.key === key ? state.open : null);
  if (!thread) return;
  try {
    await modifyThread(thread.accountEmail, thread.id, [], ["INBOX"]);
    if (state.folder === "inbox") removeThread(key);
    toast("Archived");
  } catch (error) {
    toast(error.message || "Couldn't archive that conversation.", { error: true });
  }
}

async function trash(key) {
  const thread = findThread(key) || (state.open?.key === key ? state.open : null);
  if (!thread) return;
  try {
    await trashThread(thread.accountEmail, thread.id);
    removeThread(key);
    toast("Moved to trash");
  } catch (error) {
    toast(error.message || "Couldn't trash that conversation.", { error: true });
  }
}

async function reply(key, mode, messageId) {
  if (state.open?.key !== key || !state.open.messages?.length) {
    await openThread(key, { focus: false });
  }
  const open = state.open?.key === key ? state.open : null;
  if (!open?.messages?.length) {
    toast("Open the conversation before replying.", { error: true });
    return;
  }
  const message = open.messages.find((item) => item.id === messageId) || open.messages[open.messages.length - 1];
  const fromList = parseAddressList(message.from);
  const targets = replyTargets({
    from: fromList,
    to: parseAddressList(message.to),
    cc: parseAddressList(message.cc),
    replyTo: parseAddressList(message.replyTo),
    selfEmail: open.accountEmail,
    mode,
  });
  const who = fromList[0]?.name || fromList[0]?.email || "someone";
  const quoted = quoteText(plainFromMessage(message), { when: formatFull(message.date, getTimezone()), who });
  const attachmentNote = message.attachments?.length && mode === "forward"
    ? `\n\nAttachments: ${message.attachments.map((item) => item.filename).join(", ")}`
    : "";
  openCompose({
    title: mode === "forward" ? "Forward" : mode === "reply-all" ? "Reply all" : "Reply",
    from: open.accountEmail,
    to: mode === "forward" ? "" : formatAddressInput(targets.to),
    cc: mode === "forward" ? "" : formatAddressInput(targets.cc),
    subject: mode === "forward" ? forwardSubject(open.subject) : replySubject(open.subject),
    body: `${quoted}${attachmentNote}`,
    threadId: mode === "forward" ? "" : open.id,
    accountEmail: open.accountEmail,
    inReplyTo: mode === "forward" ? "" : message.messageIdHeader,
    references: mode === "forward" ? "" : buildReferences(message.references, message.messageIdHeader),
  });
}

function composeNew() {
  const preferred = state.accountFilter !== "all"
    ? state.accountFilter
    : (enabledAccounts()[0]?.email || "");
  openCompose({
    title: "New message",
    from: preferred,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    threadId: "",
    accountEmail: preferred,
    inReplyTo: "",
    references: "",
  });
}

async function send(draft) {
  setComposeError("");
  const account = accountOf(draft.from);
  if (!account) {
    setComposeError("Choose an account to send from.");
    return;
  }
  const to = parseAddressList(draft.to);
  const cc = parseAddressList(draft.cc);
  const bcc = parseAddressList(draft.bcc);
  if (!to.length) {
    setComposeError("Add at least one To address.");
    return;
  }
  const invalid = [...to, ...cc, ...bcc].filter((address) => !isValidEmail(address.email));
  if (invalid.length) {
    setComposeError(`Check these addresses: ${invalid.map((address) => address.email).join(", ")}`);
    return;
  }
  try {
    const raw = buildRawMessage({
      from: { name: account.label || "", email: account.email },
      to,
      cc,
      bcc,
      subject: draft.subject,
      text: draft.body,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
    });
    const sameAccount = accountKey(draft.from) === accountKey(draft.accountEmail);
    await sendMessage(account.email, raw, sameAccount ? draft.threadId : "");
    document.getElementById("compose-dialog").close();
    toast("Sent");
    if (state.folder === "sent") loadMail();
  } catch (error) {
    setComposeError(error.message || "Couldn't send that message.");
  }
}

async function downloadAttachment(email, attachment) {
  try {
    let data = attachment.inlineData;
    if (!data) {
      const fetched = await getAttachment(email, attachment.messageId, attachment.attachmentId);
      data = fetched?.data || "";
    }
    if (!data) throw new Error("The file was empty.");
    downloadBlob(base64UrlToBlob(data, attachment.mimeType), attachment.filename);
  } catch (error) {
    toast(error.message || "Couldn't download that file.", { error: true });
  }
}

async function refreshCalendars(force) {
  const accounts = enabledAccounts();
  const stamp = accounts.map((account) => account.email).join("|");
  if (!force && stamp === calendarStamp && state.calendars.length) return;
  calendarStamp = stamp;
  state.calLoading = true;
  notify("calendar");
  const selection = getCalendarSelection();
  const results = await Promise.allSettled(accounts.map(async (account) => {
    if (tokenState(account.email) === "reconnect") {
      const error = new Error("Needs a reconnect.");
      error.auth = true;
      error.account = account.email;
      throw error;
    }
    const data = await listCalendarList(account.email);
    return { account, items: data?.items || [] };
  }));
  const calendars = [];
  const errors = [];
  results.forEach((result, index) => {
    const account = accounts[index];
    if (result.status === "rejected") {
      errors.push({
        email: result.reason?.account || account.email,
        message: result.reason?.message || "Couldn't load calendars.",
        auth: !!result.reason?.auth,
      });
      return;
    }
    result.value.items.forEach((item, itemIndex) => {
      const key = `${account.email}::${item.id}`;
      const stored = selection[key];
      const background = item.backgroundColor || ["#0075de", "#e5484d", "#30a46c", "#f76b15", "#8e4ec6"][itemIndex % 5];
      calendars.push({
        key,
        accountEmail: account.email,
        id: item.id,
        summary: item.summary || item.id,
        backgroundColor: background,
        foregroundColor: item.foregroundColor || contrastColor(background),
        accessRole: item.accessRole || "reader",
        primary: !!item.primary,
        selected: typeof stored === "boolean" ? stored : item.selected !== false,
        accountColor: account.color,
      });
    });
  });
  state.calendars = calendars;
  state.calErrors = errors;
  state.calLoading = false;
  notify("calendar");
  notify("accounts");
}

async function loadEvents() {
  const gen = ++state.calGen;
  state.calLoading = true;
  notify("calendar");
  const timeZone = getTimezone();
  const range = visibleRange(state.calMode, state.calDate, timeZone);
  const timeMin = startOfDay(range.start, timeZone);
  const timeMax = startOfDay(range.end, timeZone);
  const selected = state.calendars.filter((calendar) => calendar.selected);
  const results = await Promise.allSettled(selected.map(async (calendar) => {
    if (tokenState(calendar.accountEmail) === "reconnect") {
      const error = new Error("Needs a reconnect.");
      error.auth = true;
      error.account = calendar.accountEmail;
      throw error;
    }
    const items = await listEvents(calendar.accountEmail, calendar.id, timeMin, timeMax);
    return { calendar, items };
  }));
  if (gen !== state.calGen) return;
  const events = [];
  const errors = state.calErrors.filter((error) => error.scope !== "events");
  results.forEach((result) => {
    if (result.status === "rejected") {
      errors.push({
        email: result.reason?.account || "",
        message: result.reason?.message || "Couldn't load events.",
        auth: !!result.reason?.auth,
        scope: "events",
      });
      return;
    }
    const { calendar, items } = result.value;
    for (const item of items) {
      if (item.status === "cancelled" || !item.start) continue;
      const allDay = !!item.start.date;
      const startDate = item.start.date || "";
      const endDate = item.end?.date || (startDate ? addDays(startDate, 1) : "");
      events.push({
        key: `${calendar.key}::${item.id}`,
        accountEmail: calendar.accountEmail,
        calendarId: calendar.id,
        calendarSummary: calendar.summary,
        eventId: item.id,
        title: item.summary || "(no title)",
        location: item.location || "",
        description: item.description || "",
        allDay,
        startDate,
        endDate,
        startMs: allDay ? startOfDay(startDate, timeZone).getTime() : new Date(item.start.dateTime).getTime(),
        endMs: allDay
          ? startOfDay(endDate, timeZone).getTime()
          : new Date(item.end?.dateTime || item.start.dateTime).getTime(),
        color: calendar.backgroundColor,
        foreground: calendar.foregroundColor,
        accountColor: calendar.accountColor,
        canWrite: canWriteCalendar(calendar),
      });
    }
  });
  events.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
  state.events = events;
  state.calErrors = errors;
  state.calLoading = false;
  notify("calendar");
}

async function saveEvent(data) {
  const calendar = state.calendars.find((item) => item.key === data.calendarKey);
  if (!calendar || !canWriteCalendar(calendar)) {
    setEventError("Choose a calendar you can edit.");
    return;
  }
  let resource;
  try {
    resource = eventResource({ ...data, timeZone: getTimezone() });
  } catch (error) {
    setEventError(error.message);
    return;
  }
  try {
    const sameCalendar = data.existing
      && data.existing.calendarId === calendar.id
      && accountKey(data.existing.accountEmail) === accountKey(calendar.accountEmail);
    if (sameCalendar) await updateEvent(calendar.accountEmail, calendar.id, data.existing.eventId, resource);
    else {
      await createEvent(calendar.accountEmail, calendar.id, resource);
      if (data.existing?.canWrite) {
        try {
          await deleteEvent(data.existing.accountEmail, data.existing.calendarId, data.existing.eventId);
        } catch {
          /* the new copy is saved; the old one can be deleted by hand */
        }
      }
    }
    document.getElementById("event-dialog").close();
    toast("Event saved");
    await loadEvents();
  } catch (error) {
    setEventError(error.message || "Couldn't save the event.");
  }
}

async function removeEvent(event) {
  if (!event?.canWrite) return;
  if (!window.confirm(`Delete “${event.title}”?`)) return;
  try {
    await deleteEvent(event.accountEmail, event.calendarId, event.eventId);
    document.getElementById("event-dialog").close();
    toast("Event deleted");
    await loadEvents();
  } catch (error) {
    setEventError(error.message || "Couldn't delete the event.");
  }
}

function selectedKey() {
  return state.selectedKey || state.threads[0]?.key || "";
}

Object.assign(actions, {
  async setView(view) {
    state.sidebarOpen = false;
    if (state.view === view) {
      notify("shell");
      return;
    }
    state.view = view;
    notify("shell");
    if (view === "calendar") {
      await refreshCalendars(false);
      await loadEvents();
    } else if (!state.threads.length) {
      await loadMail();
    }
  },
  async addAccount() {
    try {
      await waitForGsi();
      const email = await addAccountInteractive();
      state.accounts = getAccounts();
      calendarStamp = "";
      notify("accounts");
      toast(`Added ${email}`);
      if (state.view === "calendar") {
        await refreshCalendars(true);
        await loadEvents();
      } else await loadMail();
    } catch (error) {
      toast(error.message || "Couldn't add that account.", { error: true });
    }
  },
  async removeAccount(email) {
    if (!window.confirm(`Remove ${email}? This revokes the app's token for that account.`)) return;
    const revoked = await revokeAndRemove(email);
    state.accounts = getAccounts();
    if (accountKey(state.accountFilter) === accountKey(email)) state.accountFilter = "all";
    state.calendars = state.calendars.filter((calendar) => accountKey(calendar.accountEmail) !== accountKey(email));
    calendarStamp = "";
    notify("accounts");
    toast(revoked ? `Removed ${email}.` : `Removed ${email} on this device.`);
    if (state.view === "calendar") {
      await refreshCalendars(true);
      await loadEvents();
    } else await loadMail();
  },
  async toggleAccount(email, enabled) {
    const account = accountOf(email);
    if (!account) return;
    upsertAccount({ ...account, enabled });
    state.accounts = getAccounts();
    calendarStamp = "";
    notify("accounts");
    if (enabled && tokenState(email) !== "ok") {
      try {
        await ensureAccessToken(email);
      } catch {
        /* reconnect chip shows from token state */
      }
    }
    if (state.view === "calendar") {
      await refreshCalendars(true);
      await loadEvents();
    } else await loadMail();
  },
  renameAccount(email, label) {
    const account = accountOf(email);
    if (!account) return;
    const clean = label.trim();
    upsertAccount({ ...account, label: !clean || accountKey(clean) === accountKey(account.email) ? "" : clean });
    state.accounts = getAccounts();
    notify("accounts");
  },
  async reconnect(email) {
    try {
      await reconnectInteractive(email);
      calendarStamp = "";
      notify("accounts");
      toast(`Reconnected ${email}`);
      if (state.view === "calendar") {
        await refreshCalendars(true);
        await loadEvents();
      } else await loadMail();
    } catch (error) {
      toast(error.message || `Couldn't reconnect ${email}.`, { error: true });
      notify("accounts");
    }
  },
  setFolder(folder) {
    state.folder = folder;
    state.sidebarOpen = false;
    notify("shell");
    loadMail();
  },
  setAccountFilter(email) {
    state.accountFilter = email || "all";
    loadMail();
  },
  setUnreadOnly(unreadOnly) {
    state.unreadOnly = !!unreadOnly;
    loadMail();
  },
  setQuery(query) {
    if (query === state.query) return;
    state.query = query;
    loadMail();
  },
  loadMore() {
    loadMail({ append: true });
  },
  openThread,
  closeReading() {
    state.mobileReading = false;
    state.open = null;
    state.openLoading = false;
    releaseBlobs();
    notify("reading");
  },
  moveSelection(delta) {
    if (!state.threads.length) return;
    let index = state.threads.findIndex((thread) => thread.key === state.selectedKey);
    if (index < 0) index = delta > 0 ? -1 : 0;
    index = Math.max(0, Math.min(state.threads.length - 1, index + delta));
    const next = state.threads[index];
    state.selectedKey = next.key;
    notify("selection");
    if (state.open) openThread(next.key, { focus: false });
  },
  openSelected() {
    const key = selectedKey();
    if (key) openThread(key, { focus: true });
  },
  archive,
  archiveSelected() {
    const key = state.open?.key || selectedKey();
    if (key) archive(key);
  },
  trash,
  star,
  setUnread,
  reply,
  replySelected() {
    const key = state.open?.key || selectedKey();
    if (key) reply(key, "reply");
  },
  compose: composeNew,
  send,
  downloadAttachment,
  async setCalMode(mode) {
    state.calMode = mode;
    await loadEvents();
  },
  async shiftCalendar(direction) {
    state.calDate = state.calMode === "month"
      ? addMonths(state.calDate, direction)
      : addDays(state.calDate, 7 * direction);
    await loadEvents();
  },
  async calToday() {
    state.calDate = todayKey(getTimezone());
    await loadEvents();
  },
  async showDay(day) {
    state.calDate = day;
    state.calMode = "agenda";
    await loadEvents();
  },
  toggleCalendar(key, selected) {
    const calendar = state.calendars.find((item) => item.key === key);
    if (!calendar) return;
    calendar.selected = selected;
    setCalendarSelected(key, selected);
    notify("calendar");
    loadEvents();
  },
  openEvent: showEvent,
  newEvent: showNewEvent,
  saveEvent,
  deleteEvent: removeEvent,
  needWritableCalendar() {
    toast("No calendar you can edit yet. Add an account, or turn a calendar on.", { error: true });
  },
  openSettings: openSettingsDialog,
  openHelp() {
    document.getElementById("help-dialog").showModal();
  },
  toggleTheme,
  openSidebar() {
    state.sidebarOpen = true;
    notify("shell");
    document.getElementById("sidebar-close").focus();
  },
  closeSidebar() {
    state.sidebarOpen = false;
    notify("shell");
  },
  afterSettings() {
    resetTokenClient();
    applyTheme();
    document.getElementById("settings-dialog").close();
    toast("Settings saved");
    if (!getClientId()) {
      showFirstRun();
      return;
    }
    state.calDate = state.calDate || todayKey(getTimezone());
    notify("all");
    if (state.view === "calendar") loadEvents();
    else loadMail();
  },
});

async function start() {
  if (started) return;
  started = true;
  initState();
  initShell();
  initMail();
  initCalendar();
  initShortcuts();
  subscribe(onTopic);
  state.accounts = getAccounts();
  hydrateTokens();
  notify("all");
  try {
    await waitForGsi();
  } catch (error) {
    toast(error.message, { error: true });
  }
  await connectAccounts();
  await loadMail();
}

function saveFirstClient(value) {
  const clientId = String(value || "").trim();
  if (!clientId) {
    showClientError("Paste the client ID from Google Cloud.");
    return;
  }
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    showClientError("That doesn't look like a Google client ID. It should end in .apps.googleusercontent.com. See SETUP.md.");
    return;
  }
  setClientId(clientId);
  showClientError("");
  showApp();
  start();
}

applyTheme();
watchSystemTheme();
document.getElementById("first-run-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveFirstClient(new FormData(event.currentTarget).get("clientId"));
});

if (!getClientId()) showFirstRun();
else {
  showApp();
  start();
}
