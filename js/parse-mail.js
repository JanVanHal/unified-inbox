import { parseAddress } from "./rfc2822.js";
import { base64UrlToBytes, decodeEntities } from "./util.js";

export function headerMap(payload) {
  const map = {};
  for (const header of payload?.headers || []) {
    if (header?.name) map[header.name.toLowerCase()] = header.value || "";
  }
  return map;
}

function headerValue(part, name) {
  return headerMap(part)[name.toLowerCase()] || "";
}

function charsetOf(part) {
  const match = /charset="?([^";]+)/i.exec(headerValue(part, "content-type"));
  return (match?.[1] || "utf-8").trim().toLowerCase();
}

export function decodeBodyData(data, charset = "utf-8") {
  if (!data) return "";
  const bytes = base64UrlToBytes(data);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function walk(part, found) {
  if (!part) return;
  const mime = (part.mimeType || "").toLowerCase();
  const disposition = headerValue(part, "content-disposition").toLowerCase();
  const filename = part.filename || "";
  const isText = mime === "text/plain" || mime === "text/html";
  const attachmentLike = disposition.includes("attachment") || (filename && !isText);

  if (attachmentLike && (filename || part.body?.attachmentId)) {
    found.attachments.push(part);
  } else if (mime === "text/html" && !found.html && !found.htmlAttachment) {
    if (part.body?.data) found.html = decodeBodyData(part.body.data, charsetOf(part));
    else if (part.body?.attachmentId) found.htmlAttachment = part.body.attachmentId;
  } else if (mime === "text/plain" && !found.text && !found.textAttachment) {
    if (part.body?.data) found.text = decodeBodyData(part.body.data, charsetOf(part));
    else if (part.body?.attachmentId) found.textAttachment = part.body.attachmentId;
  }

  for (const child of part.parts || []) walk(child, found);
}

export function extractContent(payload) {
  const found = { html: "", text: "", htmlAttachment: "", textAttachment: "", attachments: [] };
  walk(payload, found);
  if (!found.html && !found.text && !found.htmlAttachment && !found.textAttachment && payload?.body?.data) {
    const mime = (payload.mimeType || "").toLowerCase();
    const decoded = decodeBodyData(payload.body.data, charsetOf(payload));
    if (mime.includes("html")) found.html = decoded;
    else found.text = decoded;
  }
  return found;
}

export function attachmentMeta(message) {
  const found = extractContent(message.payload);
  return found.attachments
    .filter((part) => part.body?.attachmentId || part.body?.data)
    .map((part) => ({
      filename: part.filename || "attachment",
      mimeType: part.mimeType || "application/octet-stream",
      size: part.body?.size || 0,
      attachmentId: part.body?.attachmentId || "",
      inlineData: part.body?.attachmentId ? "" : part.body?.data || "",
      messageId: message.id,
      contentId: headerValue(part, "content-id").replace(/[<>]/g, "").trim(),
    }));
}

export function parseMessage(message) {
  const headers = headerMap(message.payload);
  const content = extractContent(message.payload);
  return {
    id: message.id,
    from: headers.from || "",
    to: headers.to || "",
    cc: headers.cc || "",
    bcc: headers.bcc || "",
    subject: headers.subject || "",
    replyTo: headers["reply-to"] || "",
    messageIdHeader: headers["message-id"] || "",
    references: headers.references || "",
    date: Number(message.internalDate || 0),
    labelIds: message.labelIds || [],
    html: content.html,
    text: content.text,
    htmlAttachment: content.htmlAttachment,
    textAttachment: content.textAttachment,
    attachments: attachmentMeta(message),
  };
}

export function threadKey(email, id) {
  return `${email}::${id}`;
}

export function summarizeThread(raw, accountEmail, folder) {
  const messages = raw.messages || [];
  const last = messages[messages.length - 1] || {};
  const first = messages.find((message) => headerMap(message.payload).subject) || messages[0] || last;
  const lastHeaders = headerMap(last.payload);
  const firstHeaders = headerMap(first.payload);
  const labels = new Set();
  let latest = 0;
  for (const message of messages) {
    for (const label of message.labelIds || []) labels.add(label);
    const stamp = Number(message.internalDate || 0);
    if (stamp > latest) latest = stamp;
  }
  const whoRaw = folder === "sent" ? lastHeaders.to || lastHeaders.from || "" : lastHeaders.from || "";
  const who = parseAddress(decodeEntities(whoRaw));
  return {
    key: threadKey(accountEmail, raw.id),
    accountEmail,
    id: raw.id,
    subject: decodeEntities(firstHeaders.subject || lastHeaders.subject || "(no subject)"),
    person: who.name || who.email || "(unknown)",
    snippet: decodeEntities(raw.snippet || last.snippet || ""),
    date: latest,
    unread: labels.has("UNREAD"),
    starred: labels.has("STARRED"),
    count: messages.length || 1,
  };
}
