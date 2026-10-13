import { escapeHtml } from "./util.js";

let hooked = false;

function installHook() {
  if (hooked || !window.DOMPurify) return;
  window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
      const href = node.getAttribute("href") || "";
      if (/^\s*javascript:/i.test(href)) node.removeAttribute("href");
    }
    if (node.tagName === "IMG" || node.tagName === "VIDEO" || node.tagName === "SOURCE") {
      const src = node.getAttribute("src") || "";
      if (src && !/^(https?:|cid:|data:image\/)/i.test(src)) node.removeAttribute("src");
    }
  });
  hooked = true;
}

export function canSanitize() {
  return typeof window !== "undefined" && !!window.DOMPurify;
}

export function sanitizeEmailHtml(html) {
  if (!canSanitize()) return "";
  installHook();
  return window.DOMPurify.sanitize(html || "", {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "iframe", "object", "embed", "base", "link", "meta", "script"],
  });
}

export function textToSafeHtml(text) {
  const escaped = escapeHtml(text || "");
  const linked = escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  return `<div class="plain">${linked}</div>`;
}

export function htmlToPlain(html) {
  const clean = sanitizeEmailHtml(html);
  if (!clean) return "";
  const doc = new DOMParser().parseFromString(clean, "text/html");
  return doc.body.textContent || "";
}

export function emailDocument(innerHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html,body{margin:0;padding:0;background:#fff;color:#191919}
    body{font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}
    img,video{max-width:100%;height:auto}
    a{color:#0075de}
    pre,.plain{white-space:pre-wrap;font:inherit;margin:0}
    blockquote{margin:.4em 0 .4em .2em;padding-left:.7em;border-left:2px solid rgba(0,0,0,.15);color:rgba(0,0,0,.72)}
    table{max-width:100%}
  </style></head><body>${innerHtml}</body></html>`;
}
