import { CONFIG } from "../config.js";
import { authedJson } from "./api.js";

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export function listThreads(email, { query = "", labelIds = [], pageToken = "", maxResults = 20 } = {}) {
  const base = queryString({ maxResults, q: query, pageToken });
  const labels = labelIds.map((id) => `labelIds=${encodeURIComponent(id)}`).join("&");
  const qs = [base, labels].filter(Boolean).join("&");
  return authedJson(email, `${CONFIG.GMAIL_API}/users/me/threads?${qs}`);
}

export function getThread(email, id, format = "full") {
  let qs = `format=${encodeURIComponent(format)}`;
  if (format === "metadata") {
    const headers = ["From", "To", "Cc", "Subject", "Date"];
    qs += `&${headers.map((header) => `metadataHeaders=${encodeURIComponent(header)}`).join("&")}`;
  }
  return authedJson(email, `${CONFIG.GMAIL_API}/users/me/threads/${encodeURIComponent(id)}?${qs}`);
}

export function modifyThread(email, id, addLabelIds = [], removeLabelIds = []) {
  return authedJson(email, `${CONFIG.GMAIL_API}/users/me/threads/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    body: { addLabelIds, removeLabelIds },
  });
}

export function trashThread(email, id) {
  return authedJson(email, `${CONFIG.GMAIL_API}/users/me/threads/${encodeURIComponent(id)}/trash`, {
    method: "POST",
  });
}

export function sendMessage(email, raw, threadId) {
  const body = { raw };
  if (threadId) body.threadId = threadId;
  return authedJson(email, `${CONFIG.GMAIL_API}/users/me/messages/send`, { method: "POST", body });
}

export function getAttachment(email, messageId, attachmentId) {
  return authedJson(
    email,
    `${CONFIG.GMAIL_API}/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
}

export function mailQuery({ folder, query, unreadOnly }) {
  const parts = [];
  if (query && query.trim()) parts.push(query.trim());
  if (unreadOnly) parts.push("is:unread");
  if (folder === "all" || folder === "starred") parts.push("-in:spam -in:trash");
  return parts.join(" ");
}

export function folderLabelIds(folder) {
  if (folder === "inbox") return ["INBOX"];
  if (folder === "starred") return ["STARRED"];
  if (folder === "sent") return ["SENT"];
  return [];
}
