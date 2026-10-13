import { CONFIG } from "../config.js";
import { PALETTE, accountKey } from "./util.js";

// ui.theme must match the inline script in index.html (it runs before modules).
const THEME_KEY = "ui.theme";
const CLIENT_KEY = "ui.clientId";
const ACCOUNTS_KEY = "ui.accounts";
const TZ_KEY = "ui.timezone";
const CAL_KEY = "ui.calendarSelection";
const TOKEN_KEY = "ui.sessionTokens";

export function getClientId() {
  try {
    const stored = localStorage.getItem(CLIENT_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* private mode or blocked storage */
  }
  return String(CONFIG.CLIENT_ID || "").trim();
}

export function clientIdSource() {
  try {
    const stored = localStorage.getItem(CLIENT_KEY);
    if (stored && stored.trim()) return "browser";
  } catch {
    /* ignore */
  }
  return CONFIG.CLIENT_ID ? "config" : "none";
}

export function setClientId(id) {
  const value = String(id || "").trim();
  if (!value) localStorage.removeItem(CLIENT_KEY);
  else localStorage.setItem(CLIENT_KEY, value);
}

export function getTheme() {
  const value = localStorage.getItem(THEME_KEY);
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

export function setTheme(value) {
  localStorage.setItem(THEME_KEY, value);
}

export function getTimezone() {
  return localStorage.getItem(TZ_KEY) || CONFIG.DEFAULT_TIMEZONE;
}

export function setTimezone(timeZone) {
  localStorage.setItem(TZ_KEY, timeZone || CONFIG.DEFAULT_TIMEZONE);
}

function cleanAccount(account) {
  const email = String(account?.email || "").trim();
  let color = String(account?.color || "");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = PALETTE[0];
  return {
    email,
    color,
    label: String(account?.label || "").slice(0, 80),
    enabled: account?.enabled !== false,
  };
}

export function getAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(cleanAccount).filter((account) => account.email);
  } catch {
    return [];
  }
}

export function saveAccounts(list) {
  // Accounts only. Tokens must never land in localStorage.
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.map(cleanAccount)));
}

export function nextColor(list) {
  const used = new Set(list.map((account) => account.color.toLowerCase()));
  return PALETTE.find((color) => !used.has(color)) || PALETTE[list.length % PALETTE.length];
}

export function upsertAccount(account) {
  const list = getAccounts();
  const clean = cleanAccount(account);
  const index = list.findIndex((item) => accountKey(item.email) === accountKey(clean.email));
  if (index >= 0) list[index] = { ...list[index], ...clean, color: clean.color || list[index].color };
  else list.push(clean);
  saveAccounts(list);
  return getAccounts();
}

export function removeStoredAccount(email) {
  saveAccounts(getAccounts().filter((account) => accountKey(account.email) !== accountKey(email)));
  return getAccounts();
}

export function getCalendarSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAL_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function setCalendarSelected(key, selected) {
  const all = getCalendarSelection();
  all[key] = !!selected;
  localStorage.setItem(CAL_KEY, JSON.stringify(all));
}

function readSessionTokens() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function loadSessionTokens() {
  return readSessionTokens();
}

export function saveSessionToken(email, token) {
  const all = readSessionTokens();
  all[email] = { accessToken: token.accessToken, expiresAt: token.expiresAt };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(all));
}

export function clearSessionToken(email) {
  const all = readSessionTokens();
  delete all[email];
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(all));
}
