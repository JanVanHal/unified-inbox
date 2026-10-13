import { bytesToBase64, base64UrlEncodeBytes } from "./util.js";

function sanitizeHeader(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function encodeHeaderWord(value) {
  const clean = sanitizeHeader(value);
  if (/^[\t\x20-\x7E]*$/.test(clean)) return clean;
  const words = [];
  let chunk = "";
  for (const char of clean) {
    const next = chunk + char;
    if (bytesToBase64(new TextEncoder().encode(next)).length > 60 && chunk) {
      words.push(encodedWord(chunk));
      chunk = char;
    } else {
      chunk = next;
    }
  }
  if (chunk) words.push(encodedWord(chunk));
  return words.join(" ");
}

function encodedWord(text) {
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(text))}?=`;
}

export function parseAddress(raw) {
  const value = String(raw || "").trim();
  const wrapped = value.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
  if (wrapped) return { name: (wrapped[1] || "").trim(), email: wrapped[2].trim() };
  const bare = value.match(/[^\s<>,]+@[^\s<>,]+/);
  if (bare) {
    const name = value.replace(bare[0], "").replace(/["<>]/g, "").trim();
    return { name, email: bare[0] };
  }
  return { name: "", email: "" };
}

export function parseAddressList(headerValue) {
  if (!headerValue) return [];
  const parts = [];
  let current = "";
  let quoted = false;
  for (const char of String(headerValue)) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map(parseAddress).filter((address) => address.email);
}

export function formatAddress(address) {
  const email = sanitizeHeader(address.email);
  const name = sanitizeHeader(address.name || "");
  if (!email) return "";
  if (!name) return email;
  if (/^[\t\x20-\x7E]*$/.test(name)) {
    return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${email}>`;
  }
  return `${encodeHeaderWord(name)} <${email}>`;
}

export function formatAddressInput(list) {
  return list.map((address) => (address.name ? `${address.name} <${address.email}>` : address.email)).join(", ");
}

function fold(name, value) {
  const clean = sanitizeHeader(value);
  if (!clean) return "";
  const words = clean.split(/\s+/);
  const lines = [];
  let current = `${name}:`;
  for (const word of words) {
    if ((current + " " + word).length > 78 && current !== `${name}:`) {
      lines.push(current);
      current = ` ${word}`;
    } else {
      current += ` ${word}`;
    }
  }
  lines.push(current);
  return lines.join("\r\n");
}

function wrap76(value) {
  return value.replace(/.{1,76}/g, (line) => `${line}\r\n`).replace(/\r\n$/, "");
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function replySubject(subject) {
  const value = String(subject || "").trim();
  if (/^re:/i.test(value)) return value;
  return value ? `Re: ${value}` : "Re:";
}

export function forwardSubject(subject) {
  const value = String(subject || "").trim();
  if (/^(fwd|fw):/i.test(value)) return value;
  return value ? `Fwd: ${value}` : "Fwd:";
}

export function ensureAngle(id) {
  const value = String(id || "").trim();
  if (!value) return "";
  return value.startsWith("<") ? value : `<${value}>`;
}

export function buildReferences(existing, messageId) {
  const id = ensureAngle(messageId);
  const parts = String(existing || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(ensureAngle);
  if (id && !parts.includes(id)) parts.push(id);
  return parts.join(" ");
}

export function replyTargets({ from = [], to = [], cc = [], replyTo = [], selfEmail = "", mode }) {
  const self = selfEmail.toLowerCase();
  const notSelf = (address) => address.email && address.email.toLowerCase() !== self;
  const unique = (list) => {
    const seen = new Set();
    const out = [];
    for (const address of list) {
      const key = address.email.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(address);
    }
    return out;
  };
  if (mode === "reply") {
    const dest = (replyTo.length ? replyTo : from).filter((address) => address.email);
    const filtered = dest.filter(notSelf);
    return { to: unique(filtered.length ? filtered : dest), cc: [] };
  }
  if (mode === "reply-all") {
    const base = (replyTo.length ? replyTo : from).concat(to);
    const toList = unique(base.filter(notSelf));
    return {
      to: toList.length ? toList : unique(base),
      cc: unique(cc.filter(notSelf)),
    };
  }
  return { to: [], cc: [] };
}

export function quoteText(text, { when, who }) {
  const quoted = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${when}, ${who} wrote:\n${quoted}\n`;
}

export function buildRawMessage({ from, to, cc = [], bcc = [], subject, text, inReplyTo = "", references = "" }) {
  const fromLine = formatAddress(from);
  const toLine = to.map(formatAddress).filter(Boolean).join(", ");
  if (!fromLine || !toLine) throw new Error("A message needs a From address and at least one To address.");
  const lines = [
    `From: ${fromLine}`,
    `To: ${toLine}`,
  ];
  const ccLine = cc.map(formatAddress).filter(Boolean).join(", ");
  const bccLine = bcc.map(formatAddress).filter(Boolean).join(", ");
  if (ccLine) lines.push(`Cc: ${ccLine}`);
  if (bccLine) lines.push(`Bcc: ${bccLine}`);
  lines.push(fold("Subject", encodeHeaderWord(subject || "")) || "Subject:");
  lines.push(`Date: ${new Date().toUTCString().replace(/GMT$/, "+0000")}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: base64");
  if (inReplyTo) lines.push(`In-Reply-To: ${sanitizeHeader(ensureAngle(inReplyTo))}`);
  if (references) lines.push(fold("References", references));
  const domain = String(from.email).split("@")[1] || "unified-inbox.local";
  lines.push(`Message-ID: <${crypto.randomUUID()}@${domain}>`);
  lines.push("");
  const body = wrap76(bytesToBase64(new TextEncoder().encode(String(text ?? ""))));
  lines.push(body);
  return base64UrlEncodeBytes(new TextEncoder().encode(lines.filter((line) => line != null).join("\r\n")));
}
