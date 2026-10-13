import { ensureAccessToken, markReconnect } from "./auth.js";

export class ApiError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.status = extra.status || 0;
    this.account = extra.account || "";
    this.auth = !!extra.auth;
  }
}

export async function authedJson(email, url, { method = "GET", body, retry = true } = {}) {
  let token;
  try {
    token = await ensureAccessToken(email);
  } catch (error) {
    throw new ApiError(error.message || `Reconnect ${email}`, { status: 401, account: email, auth: true });
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Couldn't reach Google for ${email}.`, { account: email });
  }
  if (response.status === 401 && retry) {
    try {
      await ensureAccessToken(email, { force: true });
    } catch (error) {
      throw new ApiError(error.message || `Reconnect ${email}`, { status: 401, account: email, auth: true });
    }
    return authedJson(email, url, { method, body, retry: false });
  }
  if (response.status === 401) {
    markReconnect(email);
    throw new ApiError(`Reconnect ${email}.`, { status: 401, account: email, auth: true });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) {
    let detail = "";
    try {
      detail = JSON.parse(text).error?.message || "";
    } catch {
      detail = text.slice(0, 180);
    }
    const prefix = response.status === 403 ? "Permission denied" : `Request failed (${response.status})`;
    throw new ApiError(detail ? `${prefix}: ${detail}` : prefix, {
      status: response.status,
      account: email,
    });
  }
  if (!text) return null;
  return JSON.parse(text);
}
