import { getTimezone } from "./storage.js";
import { todayKey } from "./time.js";
import { accountKey } from "./util.js";

export const state = {
  view: "mail",
  accounts: [],
  folder: "inbox",
  accountFilter: "all",
  unreadOnly: false,
  query: "",
  threads: [],
  cursors: {},
  listLoading: false,
  listErrors: [],
  selectedKey: "",
  open: null,
  openLoading: false,
  mobileReading: false,
  focusReading: false,
  listGen: 0,
  openGen: 0,
  calMode: "week",
  calDate: "",
  calendars: [],
  events: [],
  calLoading: false,
  calErrors: [],
  calGen: 0,
  sidebarOpen: false,
  blobUrls: [],
};

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function notify(topic = "all") {
  for (const fn of subscribers) fn(topic);
}

export function initState() {
  state.calDate = todayKey(getTimezone());
  if (window.matchMedia("(max-width: 900px)").matches) state.calMode = "agenda";
}

export function accountOf(email) {
  return state.accounts.find((account) => accountKey(account.email) === accountKey(email));
}

export function enabledAccounts() {
  return state.accounts.filter((account) => account.enabled);
}

export function releaseBlobs() {
  for (const url of state.blobUrls) URL.revokeObjectURL(url);
  state.blobUrls = [];
}
