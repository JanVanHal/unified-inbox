import { CONFIG } from "../config.js";
import {
  clearSessionToken,
  getAccounts,
  getClientId,
  loadSessionTokens,
  nextColor,
  removeStoredAccount,
  saveSessionToken,
  upsertAccount,
} from "./storage.js";
import { accountKey } from "./util.js";

// Access tokens live here and in sessionStorage. Never copy them to localStorage.
const memory = new Map();
const listeners = new Set();

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitAuth() {
  listeners.forEach((fn) => fn());
}

export function hydrateTokens() {
  const saved = loadSessionTokens();
  const now = Date.now();
  for (const [email, token] of Object.entries(saved)) {
    if (token?.accessToken && token.expiresAt > now) {
      memory.set(accountKey(email), {
        email,
        accessToken: token.accessToken,
        expiresAt: token.expiresAt,
        needsReconnect: false,
      });
    } else {
      clearSessionToken(email);
    }
  }
}

export function tokenState(email) {
  const record = memory.get(accountKey(email));
  if (!record || record.needsReconnect || !record.accessToken) return record?.needsReconnect ? "reconnect" : "unknown";
  if (record.expiresAt <= Date.now()) return "unknown";
  return "ok";
}

export function markReconnect(email) {
  const key = accountKey(email);
  const prev = memory.get(key);
  memory.set(key, {
    email: prev?.email || email,
    accessToken: "",
    expiresAt: 0,
    needsReconnect: true,
  });
  clearSessionToken(prev?.email || email);
  emitAuth();
}

function remember(email, response) {
  const record = {
    email,
    accessToken: response.access_token,
    expiresAt: Date.now() + Math.max(60, (Number(response.expires_in) || 3600) - 60) * 1000,
    needsReconnect: false,
  };
  memory.set(accountKey(email), record);
  saveSessionToken(email, record);
  emitAuth();
  return record.accessToken;
}

let tokenClient = null;
let clientFor = "";
const queue = [];
let active = null;

export function resetTokenClient() {
  tokenClient = null;
  clientFor = "";
}

export function waitForGsi(timeoutMs = 12000) {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Google sign-in did not load. Check your connection and reload."));
      }
    }, 40);
  });
}

function client() {
  const id = getClientId();
  if (!id) throw new Error("Add your OAuth client ID in Settings first.");
  if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in is not ready yet.");
  if (tokenClient && clientFor === id) return tokenClient;
  clientFor = id;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: id,
    scope: CONFIG.SCOPES.join(" "),
    callback: () => {},
    error_callback: () => {},
  });
  return tokenClient;
}

function friendlyAuthError(error) {
  const type = error?.type || "";
  const message = error?.message || error?.error_description || error?.error || "";
  if (type === "popup_closed" || /popup_closed/i.test(String(message))) {
    return new Error("Sign-in window was closed before it finished.");
  }
  if (type === "popup_failed_to_open") {
    return new Error("The browser blocked the Google sign-in window. Allow popups for this site.");
  }
  if (/access_denied/i.test(String(message))) {
    return new Error("Access was denied. On the unverified-app warning, choose Advanced and continue. See SETUP.md.");
  }
  return new Error(message || "Google sign-in failed.");
}

export function requestToken({ prompt = "", loginHint = "" } = {}) {
  return new Promise((resolve, reject) => {
    queue.push({ prompt, loginHint, resolve, reject });
    pump();
  });
}

function pump() {
  if (active || queue.length === 0) return;
  active = queue.shift();
  let oauth;
  try {
    oauth = client();
  } catch (error) {
    const job = active;
    active = null;
    job.reject(error instanceof Error ? error : new Error(String(error)));
    pump();
    return;
  }
  let settled = false;
  const finish = (fn) => {
    if (settled) return;
    settled = true;
    const job = active;
    active = null;
    if (job) fn(job);
    pump();
  };
  oauth.callback = (response) => {
    finish((job) => {
      if (response?.error) job.reject(friendlyAuthError(response));
      else if (!response?.access_token) job.reject(new Error("Google did not return an access token."));
      else job.resolve(response);
    });
  };
  oauth.error_callback = (error) => {
    finish((job) => job.reject(friendlyAuthError(error)));
  };
  try {
    const overrides = { prompt: active.prompt ?? "" };
    if (active.loginHint) overrides.login_hint = active.loginHint;
    oauth.requestAccessToken(overrides);
  } catch (error) {
    finish((job) => job.reject(error instanceof Error ? error : new Error(String(error))));
  }
}

async function profileEmail(accessToken) {
  const response = await fetch(`${CONFIG.GMAIL_API}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) {
    const error = new Error("Gmail rejected the token.");
    error.status = 401;
    throw error;
  }
  if (!response.ok) throw new Error("Couldn't read the Gmail profile for that sign-in.");
  const data = await response.json();
  if (!data.emailAddress) throw new Error("Gmail did not return an email address.");
  return data.emailAddress;
}

export async function ensureAccessToken(email, { interactive = false, force = false } = {}) {
  const record = memory.get(accountKey(email));
  if (!force && record?.accessToken && record.expiresAt > Date.now() && !record.needsReconnect) {
    return record.accessToken;
  }
  try {
    const response = await requestToken({
      prompt: interactive ? "select_account" : "",
      loginHint: email,
    });
    const who = await profileEmail(response.access_token);
    if (accountKey(who) !== accountKey(email)) {
      throw new Error(`Google signed in ${who} instead of ${email}. Use Reconnect and pick ${email}.`);
    }
    return remember(who, response);
  } catch (error) {
    markReconnect(email);
    throw error;
  }
}

export async function addAccountInteractive() {
  await waitForGsi();
  const response = await requestToken({ prompt: "select_account" });
  const email = await profileEmail(response.access_token);
  const existing = getAccounts();
  const previous = existing.find((account) => accountKey(account.email) === accountKey(email));
  upsertAccount({
    email,
    color: previous?.color || nextColor(existing),
    label: previous?.label || "",
    enabled: true,
  });
  remember(email, response);
  return email;
}

export async function reconnectInteractive(email) {
  await waitForGsi();
  const response = await requestToken({ prompt: "select_account", loginHint: email });
  const who = await profileEmail(response.access_token);
  if (accountKey(who) !== accountKey(email)) {
    markReconnect(email);
    throw new Error(`That was ${who}. Pick ${email} to reconnect it.`);
  }
  return remember(who, response);
}

export async function revokeAndRemove(email) {
  let token = memory.get(accountKey(email))?.accessToken || "";
  if (!token) {
    try {
      const response = await requestToken({ prompt: "", loginHint: email });
      const who = await profileEmail(response.access_token);
      if (accountKey(who) === accountKey(email)) token = response.access_token;
    } catch {
      token = "";
    }
  }
  if (token && window.google?.accounts?.oauth2?.revoke) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      try {
        google.accounts.oauth2.revoke(token, () => {
          clearTimeout(timer);
          resolve();
        });
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
  memory.delete(accountKey(email));
  clearSessionToken(email);
  removeStoredAccount(email);
  emitAuth();
  return !!token;
}
