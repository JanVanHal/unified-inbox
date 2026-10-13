import { actions } from "./actions.js";
import { tokenState } from "./auth.js";
import { state } from "./state.js";
import { clientIdSource, getTheme, getTimezone, setClientId, setTheme, setTimezone } from "./storage.js";
import { el } from "./util.js";

export function initShell() {
  document.getElementById("tab-mail").addEventListener("click", () => actions.setView("mail"));
  document.getElementById("tab-cal").addEventListener("click", () => actions.setView("calendar"));
  document.getElementById("add-account").addEventListener("click", () => actions.addAccount());
  document.getElementById("theme-toggle").addEventListener("click", () => actions.toggleTheme());
  document.getElementById("open-settings").addEventListener("click", () => actions.openSettings());
  document.getElementById("open-help").addEventListener("click", () => actions.openHelp());
  document.getElementById("menu-btn").addEventListener("click", () => actions.openSidebar());
  document.getElementById("menu-btn-cal").addEventListener("click", () => actions.openSidebar());
  document.getElementById("sidebar-close").addEventListener("click", () => actions.closeSidebar());
  document.getElementById("sidebar-backdrop").addEventListener("click", () => actions.closeSidebar());
  document.querySelectorAll("dialog [data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings(new FormData(event.currentTarget));
  });
}

export function showFirstRun() {
  document.getElementById("first-run").hidden = false;
  document.getElementById("app").hidden = true;
  if (location.protocol === "file:") {
    const error = document.getElementById("first-run-error");
    error.hidden = false;
    error.textContent = "Open this app from the GitHub Pages link or a local web server. A file:// address cannot sign in to Google.";
  }
}

export function showApp() {
  document.getElementById("first-run").hidden = true;
  document.getElementById("app").hidden = false;
}

export function applyTheme(pref = getTheme()) {
  const dark = pref === "dark" || (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const button = document.getElementById("theme-toggle");
  if (button) button.textContent = dark ? "Light theme" : "Dark theme";
}

export function watchSystemTheme() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}

export function syncShell() {
  const app = document.getElementById("app");
  app.classList.toggle("is-reading", !!(state.mobileReading && state.open));
  app.classList.toggle("is-sidebar", state.sidebarOpen);
  document.getElementById("sidebar-backdrop").hidden = !state.sidebarOpen;
  document.getElementById("mail-view").hidden = state.view !== "mail";
  document.getElementById("cal-view").hidden = state.view !== "calendar";
  document.getElementById("folder-section").hidden = state.view !== "mail";
  document.getElementById("calendar-section").hidden = state.view !== "calendar";
  document.getElementById("tab-mail").setAttribute("aria-selected", state.view === "mail" ? "true" : "false");
  document.getElementById("tab-cal").setAttribute("aria-selected", state.view === "calendar" ? "true" : "false");
  applyTheme();
}

export function renderAccounts() {
  const list = document.getElementById("account-list");
  list.replaceChildren();
  for (const account of state.accounts) {
    const row = el("li", { class: "account" });
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = account.enabled;
    box.setAttribute("aria-label", `Show mail and calendar for ${account.email}`);
    box.addEventListener("change", () => actions.toggleAccount(account.email, box.checked));
    const copy = el("span", { class: "account-copy" });
    const name = el("span", {
      class: "account-name",
      text: account.label || account.email,
      title: "Double-click to rename",
    });
    copy.append(name);
    if (account.label) copy.append(el("span", { class: "account-mail", text: account.email }));
    name.addEventListener("dblclick", (event) => beginRename(event, account, name));
    row.append(
      box,
      el("span", { class: "dot", style: `background:${account.color}`, title: account.email }),
      copy,
    );
    if (account.enabled && tokenState(account.email) === "reconnect") {
      row.append(el("button", {
        type: "button",
        class: "chip",
        text: "Reconnect",
        onClick: () => actions.reconnect(account.email),
      }));
    }
    row.append(el("button", {
      type: "button",
      class: "icon-quiet",
      "aria-label": `Remove ${account.email}`,
      text: "×",
      onClick: () => actions.removeAccount(account.email),
    }));
    list.append(row);
  }
  list.append(el("li", { class: "account proton", "aria-disabled": "true" }, [
    el("span", { class: "dot dot-muted", "aria-hidden": "true" }),
    el("span", { class: "account-name", text: "Proton (coming later)" }),
  ]));
}

function beginRename(event, account, name) {
  event.preventDefault();
  event.stopPropagation();
  const input = document.createElement("input");
  input.className = "rename";
  input.value = account.label || account.email;
  input.setAttribute("aria-label", `Label for ${account.email}`);
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const save = () => {
    if (done) return;
    done = true;
    actions.renameAccount(account.email, input.value);
  };
  input.addEventListener("blur", save);
  input.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      input.blur();
    } else if (keyEvent.key === "Escape") {
      input.value = account.label || "";
      input.blur();
    }
  });
}

export function renderCalendars() {
  const list = document.getElementById("calendar-list");
  list.replaceChildren();
  if (!state.calendars.length) {
    list.append(el("li", { class: "fine", text: state.calLoading ? "Loading calendars…" : "No calendars yet." }));
    return;
  }
  for (const calendar of state.calendars) {
    const row = el("li", { class: "cal-item" });
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = calendar.selected;
    box.setAttribute("aria-label", `${calendar.summary}, ${calendar.accountEmail}`);
    box.addEventListener("change", () => actions.toggleCalendar(calendar.key, box.checked));
    row.append(el("label", { class: "cal-main" }, [
      box,
      el("span", { class: "dot", style: `background:${calendar.backgroundColor}` }),
      el("span", { class: "cal-copy" }, [
        el("span", { class: "cal-name", text: calendar.summary }),
        el("span", { class: "cal-account", text: calendar.accountEmail }),
      ]),
    ]));
    list.append(row);
  }
}

export function openSettingsDialog() {
  const dialog = document.getElementById("settings-dialog");
  const client = document.getElementById("settings-client-id");
  try {
    client.value = localStorage.getItem("ui.clientId") || "";
  } catch {
    client.value = "";
  }
  client.placeholder = clientIdSource() === "config"
    ? "Using config.js until you paste one"
    : "123-abc.apps.googleusercontent.com";
  document.getElementById("settings-theme").value = getTheme();
  fillTimeZones(document.getElementById("settings-timezone"), getTimezone());
  const error = document.getElementById("settings-error");
  error.hidden = true;
  error.textContent = "";
  dialog.showModal();
  client.focus();
}

function fillTimeZones(select, current) {
  const zones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [current];
  const list = zones.includes(current) ? zones : [current, ...zones];
  select.replaceChildren();
  for (const zone of list) {
    const option = el("option", { value: zone, text: zone });
    if (zone === current) option.selected = true;
    select.append(option);
  }
}

function saveSettings(data) {
  const clientId = String(data.get("clientId") || "").trim();
  const error = document.getElementById("settings-error");
  if (clientId && !clientId.endsWith(".apps.googleusercontent.com")) {
    error.hidden = false;
    error.textContent = "That doesn't look like a Google client ID. It should end in .apps.googleusercontent.com.";
    return;
  }
  setClientId(clientId);
  setTimezone(String(data.get("timezone") || getTimezone()));
  setTheme(String(data.get("theme") || "system"));
  actions.afterSettings();
}

export function toggleTheme() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const next = dark ? "light" : "dark";
  setTheme(next);
  applyTheme(next);
}

export function showClientError(message) {
  const error = document.getElementById("first-run-error");
  error.hidden = !message;
  error.textContent = message || "";
}
