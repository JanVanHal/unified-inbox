import { actions } from "./actions.js";
import { getAttachment } from "./gmail.js";
import { accountOf, releaseBlobs, state } from "./state.js";
import { getTimezone } from "./storage.js";
import { formatFull, formatMailDate } from "./time.js";
import { parseAddress } from "./rfc2822.js";
import { canSanitize, emailDocument, htmlToPlain, sanitizeEmailHtml, textToSafeHtml } from "./sanitize.js";
import { accountKey, base64UrlToBlob, debounce, el, formatBytes, toast } from "./util.js";

let warnedSanitizer = false;

export function initMail() {
  document.getElementById("compose-btn").addEventListener("click", () => actions.compose());
  document.getElementById("unread-toggle").addEventListener("click", () => {
    actions.setUnreadOnly(!state.unreadOnly);
  });
  document.getElementById("account-filter").addEventListener("change", (event) => {
    actions.setAccountFilter(event.target.value);
  });
  const search = document.getElementById("search");
  const applySearch = debounce(() => actions.setQuery(search.value), 350);
  search.addEventListener("input", applySearch);
  search.addEventListener("search", () => actions.setQuery(search.value));
  document.getElementById("load-more").addEventListener("click", () => actions.loadMore());
  document.querySelectorAll("[data-folder]").forEach((button) => {
    button.addEventListener("click", () => actions.setFolder(button.dataset.folder));
  });
  document.getElementById("compose-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const send = document.getElementById("compose-send");
    send.disabled = true;
    send.textContent = "Sending…";
    Promise.resolve(actions.send({
      from: document.getElementById("compose-from").value,
      to: document.getElementById("compose-to").value,
      cc: document.getElementById("compose-cc").value,
      bcc: document.getElementById("compose-bcc").value,
      subject: document.getElementById("compose-subject").value,
      body: document.getElementById("compose-body").value,
      threadId: form.dataset.threadId || "",
      accountEmail: form.dataset.accountEmail || "",
      inReplyTo: form.dataset.inReplyTo || "",
      references: form.dataset.references || "",
    })).finally(() => {
      if (document.getElementById("compose-dialog").open) {
        send.disabled = false;
        send.textContent = "Send";
      }
    });
  });
}

export function setComposeError(message) {
  const node = document.getElementById("compose-error");
  node.hidden = !message;
  node.textContent = message || "";
}

export function openCompose(draft) {
  const dialog = document.getElementById("compose-dialog");
  const form = document.getElementById("compose-form");
  document.getElementById("compose-title").textContent = draft.title || "New message";
  fillFrom(draft.from);
  document.getElementById("compose-to").value = draft.to || "";
  document.getElementById("compose-cc").value = draft.cc || "";
  document.getElementById("compose-bcc").value = draft.bcc || "";
  document.getElementById("compose-subject").value = draft.subject || "";
  document.getElementById("compose-body").value = draft.body || "";
  form.dataset.threadId = draft.threadId || "";
  form.dataset.accountEmail = draft.accountEmail || "";
  form.dataset.inReplyTo = draft.inReplyTo || "";
  form.dataset.references = draft.references || "";
  setComposeError("");
  const send = document.getElementById("compose-send");
  send.disabled = false;
  send.textContent = "Send";
  if (!dialog.open) dialog.showModal();
  const focusTarget = draft.to ? document.getElementById("compose-body") : document.getElementById("compose-to");
  focusTarget.focus();
}

function fillFrom(selected) {
  const select = document.getElementById("compose-from");
  select.replaceChildren();
  const accounts = state.accounts.filter((account) => account.enabled);
  if (!accounts.length) {
    select.append(el("option", { value: "", text: "No account yet" }));
    return;
  }
  for (const account of accounts) {
    const option = el("option", {
      value: account.email,
      text: account.label ? `${account.label} (${account.email})` : account.email,
    });
    if (accountKey(account.email) === accountKey(selected)) option.selected = true;
    select.append(option);
  }
}

export function renderList() {
  const list = document.getElementById("thread-list");
  const pane = document.querySelector(".list-pane");
  const scrollTop = pane ? pane.scrollTop : 0;
  const more = document.getElementById("load-more");
  const errors = document.getElementById("list-errors");
  const status = document.getElementById("mail-status");
  errors.replaceChildren();
  for (const error of state.listErrors) {
    const banner = el("div", { class: "banner" });
    banner.append(el("span", { text: `${error.email}: ${error.message}` }));
    if (error.auth) {
      banner.append(el("button", {
        type: "button",
        class: "chip",
        text: "Reconnect",
        onClick: () => actions.reconnect(error.email),
      }));
    }
    errors.append(banner);
  }
  list.replaceChildren();
  const active = state.accounts.some((account) => {
    if (!account.enabled) return false;
    return state.accountFilter === "all" || accountKey(account.email) === accountKey(state.accountFilter);
  });
  if (!state.accounts.length) {
    list.append(el("p", { class: "empty", text: "Add a Gmail account to see your mail." }));
  } else if (!active) {
    list.append(el("p", { class: "empty", text: "Enable an account in the sidebar to load its mail." }));
  } else if (state.listLoading && !state.threads.length) {
    list.append(el("p", { class: "empty", text: "Loading mail…" }));
  } else if (!state.threads.length) {
    list.append(el("p", { class: "empty", text: "No conversations." }));
  } else {
    for (const thread of state.threads) list.append(renderThread(thread));
  }
  const canMore = Object.values(state.cursors).some((cursor) => cursor?.next && !cursor.done);
  more.hidden = !canMore;
  more.disabled = state.listLoading;
  more.textContent = state.listLoading && state.threads.length ? "Loading…" : "Load more";
  if (state.listLoading && !state.threads.length) status.textContent = "Loading mail…";
  else if (state.threads.length) status.textContent = `${state.threads.length} conversation${state.threads.length === 1 ? "" : "s"}`;
  else status.textContent = "";
  syncChrome();
  if (pane && state.threads.length) pane.scrollTop = scrollTop;
  syncSelection();
}

function renderThread(thread) {
  const account = accountOf(thread.accountEmail);
  const row = el("div", {
    class: `thread${thread.unread ? " is-unread" : ""}`,
    "data-key": thread.key,
  });
  const main = el("button", { type: "button", class: "thread-main" });
  const subject = el("span", { class: "subject" });
  subject.append(document.createTextNode(thread.subject));
  if (thread.count > 1) subject.append(el("span", { class: "count", text: ` (${thread.count})` }));
  main.append(
    el("span", { class: "dot", style: `background:${account?.color || "#0075de"}`, title: thread.accountEmail }),
    el("span", { class: "who", text: thread.person }),
    el("time", { class: "when", datetime: new Date(thread.date).toISOString(), text: formatMailDate(thread.date, getTimezone()) }),
    subject,
    el("span", { class: "snippet", text: thread.snippet }),
  );
  main.addEventListener("click", () => actions.openThread(thread.key, { focus: true }));
  const star = el("button", {
    type: "button",
    class: thread.starred ? "star is-on" : "star",
    "aria-label": thread.starred ? `Unstar ${thread.subject}` : `Star ${thread.subject}`,
    "aria-pressed": thread.starred ? "true" : "false",
    text: "★",
  });
  star.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.star(thread.key);
  });
  row.append(main, star);
  return row;
}

export function syncChrome() {
  const names = { inbox: "Inbox", starred: "Starred", sent: "Sent", all: "All" };
  document.getElementById("mail-heading").textContent = names[state.folder] || "Inbox";
  document.getElementById("unread-toggle").setAttribute("aria-pressed", state.unreadOnly ? "true" : "false");
  const select = document.getElementById("account-filter");
  const options = [["all", "All accounts"], ...state.accounts.map((account) => [account.email, account.label || account.email])];
  const signature = options.map((option) => option.join("\n")).join("\t");
  if (select.dataset.sig !== signature) {
    select.replaceChildren();
    for (const [value, label] of options) select.append(el("option", { value, text: label }));
    select.dataset.sig = signature;
  }
  select.value = options.some(([value]) => value === state.accountFilter) ? state.accountFilter : "all";
  document.querySelectorAll("[data-folder]").forEach((button) => {
    if (button.dataset.folder === state.folder) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

export function syncSelection() {
  document.querySelectorAll(".thread").forEach((row) => {
    const selected = row.dataset.key === state.selectedKey;
    row.classList.toggle("is-selected", selected);
    const main = row.querySelector(".thread-main");
    if (main) main.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) row.scrollIntoView({ block: "nearest" });
  });
}

function updateReadingActions(open) {
  const read = document.querySelector('#reading-body [data-action="read"]');
  const star = document.querySelector('#reading-body [data-action="star"]');
  if (read) read.textContent = open.unread ? "Mark read" : "Mark unread";
  if (star) star.textContent = open.starred ? "Unstar" : "Star";
}

export function renderReading() {
  const empty = document.getElementById("reading-empty");
  const body = document.getElementById("reading-body");
  const open = state.open;
  if (!open) {
    empty.hidden = false;
    body.hidden = true;
    body.replaceChildren();
    delete body.dataset.key;
    delete body.dataset.rev;
    return;
  }
  const revision = open.loading || state.openLoading ? "loading" : open.error ? "error" : String(open.messages?.length || 0);
  if (body.dataset.key === open.key && body.dataset.rev === revision && body.childElementCount) {
    updateReadingActions(open);
    return;
  }
  empty.hidden = true;
  body.hidden = false;
  body.replaceChildren();
  body.dataset.key = open.key;
  body.dataset.rev = revision;
  const head = el("div", { class: "reading-head" });
  const title = el("h2", { tabindex: "-1", text: open.subject || "(no subject)" });
  const row = el("div", { class: "action-row" });
  row.append(
    el("button", { type: "button", class: "btn btn-ghost back", text: "Back", onClick: () => actions.closeReading() }),
    el("button", { type: "button", class: "btn btn-ghost", "data-action": "archive", text: "Archive", onClick: () => actions.archive(open.key) }),
    el("button", { type: "button", class: "btn btn-ghost", "data-action": "trash", text: "Trash", onClick: () => actions.trash(open.key) }),
    el("button", {
      type: "button",
      class: "btn btn-ghost",
      "data-action": "read",
      text: open.unread ? "Mark read" : "Mark unread",
      onClick: () => actions.setUnread(open.key, !state.open?.unread),
    }),
    el("button", {
      type: "button",
      class: "btn btn-ghost",
      "data-action": "star",
      text: open.starred ? "Unstar" : "Star",
      onClick: () => actions.star(open.key),
    }),
    el("button", { type: "button", class: "btn btn-ghost", text: "Reply", onClick: () => actions.reply(open.key, "reply") }),
    el("button", { type: "button", class: "btn btn-ghost", text: "Reply all", onClick: () => actions.reply(open.key, "reply-all") }),
    el("button", { type: "button", class: "btn btn-ghost", text: "Forward", onClick: () => actions.reply(open.key, "forward") }),
  );
  head.append(title, row);
  body.append(head);
  if (open.loading || state.openLoading) {
    body.append(el("p", { class: "empty", text: "Loading conversation…" }));
  } else if (open.error) {
    body.append(el("p", { class: "form-error", text: open.error }));
  } else if (!open.messages?.length) {
    body.append(el("p", { class: "empty", text: "This conversation has no readable messages." }));
  } else {
    const account = accountOf(open.accountEmail);
    (open.messages || []).forEach((message, index) => {
      body.append(renderMessage(open, message, index, account));
    });
  }
  if (state.focusReading && !state.openLoading && !open.loading) {
    title.focus();
    state.focusReading = false;
  }
}

function renderMessage(thread, message, index, account) {
  const collapsed = (thread.messages || []).length > 1 && index < thread.messages.length - 1;
  const article = el("article", { class: collapsed ? "message is-collapsed" : "message" });
  const from = parseAddress(message.from);
  const head = el("button", {
    type: "button",
    class: "message-head",
    "aria-expanded": collapsed ? "false" : "true",
  });
  head.append(
    el("span", { class: "dot", style: `background:${account?.color || "#0075de"}`, title: thread.accountEmail }),
    el("span", { class: "message-from", text: from.name || from.email || "Unknown" }),
    el("span", { class: "message-to", text: message.to ? `to ${message.to}` : "" }),
    el("time", { class: "message-date", datetime: new Date(message.date || 0).toISOString(), text: formatFull(message.date, getTimezone()) }),
  );
  const frame = el("iframe", {
    class: "mail-frame",
    // Same origin so the frame can be sized. No allow-scripts: message HTML cannot run.
    sandbox: "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    referrerpolicy: "no-referrer",
    title: `Message from ${from.name || from.email || "sender"}`,
  });
  const bodyWrap = el("div", { class: "message-body" }, [
    frame,
    el("div", { class: "action-row" }, [
      el("button", { type: "button", class: "btn btn-ghost", text: "Reply", onClick: () => actions.reply(thread.key, "reply", message.id) }),
      el("button", { type: "button", class: "btn btn-ghost", text: "Reply all", onClick: () => actions.reply(thread.key, "reply-all", message.id) }),
      el("button", { type: "button", class: "btn btn-ghost", text: "Forward", onClick: () => actions.reply(thread.key, "forward", message.id) }),
    ]),
  ]);
  article.append(head);
  article.append(bodyWrap);
  if (message.attachments?.length) {
    const list = el("ul", { class: "attachments" });
    for (const attachment of message.attachments) {
      const button = el("button", { type: "button" });
      button.append(
        el("span", { class: "att-name", text: attachment.filename }),
        el("span", { class: "att-size", text: formatBytes(attachment.size) }),
      );
      button.addEventListener("click", () => actions.downloadAttachment(thread.accountEmail, attachment));
      list.append(el("li", {}, button));
    }
    article.append(list);
  }
  head.addEventListener("click", () => {
    const isCollapsed = article.classList.toggle("is-collapsed");
    head.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    if (!frame.dataset.filled) fillFrame(frame, message, thread.accountEmail);
  });
  if (!collapsed) fillFrame(frame, message, thread.accountEmail);
  return article;
}

function messageInner(message) {
  if (message.html && canSanitize()) return sanitizeEmailHtml(message.html);
  if (!canSanitize() && message.html && !warnedSanitizer) {
    warnedSanitizer = true;
    toast("Couldn't load the HTML cleaner. Showing plain text instead.", { error: true });
  }
  if (message.text) return textToSafeHtml(message.text);
  if (message.html) return textToSafeHtml(message.html.replace(/<[^>]+>/g, ""));
  return "<p class=\"plain\">(empty message)</p>";
}

function fillFrame(frame, message, email) {
  frame.dataset.filled = "1";
  const html = messageInner(message);
  mountFrame(frame, html);
  hydrateCid(frame, html, message, email);
}

function mountFrame(frame, html) {
  frame.srcdoc = emailDocument(html);
  frame.addEventListener("load", () => fitFrame(frame), { once: true });
}

function fitFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const apply = () => {
    const height = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0);
    frame.style.height = `${Math.max(48, Math.min(height + 8, 12000))}px`;
  };
  apply();
  doc.querySelectorAll("img").forEach((image) => {
    if (image.dataset.fit) return;
    image.dataset.fit = "1";
    image.addEventListener("load", apply);
  });
}

async function hydrateCid(frame, html, message, email) {
  const inline = (message.attachments || []).filter((attachment) => attachment.contentId);
  if (!inline.length || !/cid:/i.test(html)) return;
  let next = html;
  await Promise.all(inline.map(async (attachment) => {
    try {
      let data = attachment.inlineData;
      if (!data && attachment.attachmentId) {
        const fetched = await getAttachment(email, attachment.messageId, attachment.attachmentId);
        data = fetched?.data || "";
      }
      if (!data) return;
      const url = URL.createObjectURL(base64UrlToBlob(data, attachment.mimeType));
      state.blobUrls.push(url);
      const escaped = attachment.contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`cid:${escaped}`, "gi"), url);
    } catch {
      /* a missing inline image should not block the message */
    }
  }));
  if (next !== html && frame.isConnected) mountFrame(frame, next);
}

export function plainFromMessage(message) {
  if (message.text) return message.text;
  if (message.html) return htmlToPlain(message.html);
  return "";
}
