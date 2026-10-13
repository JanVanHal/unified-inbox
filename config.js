// Public config. The OAuth client ID is not a secret, but leave it empty here.
// Paste it in the app under Settings (stored in this browser) so the repo stays generic.
export const CONFIG = {
  CLIENT_ID: "",
  SCOPES: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  DEFAULT_TIMEZONE: "Asia/Bangkok",
  GMAIL_API: "https://gmail.googleapis.com/gmail/v1",
  CALENDAR_API: "https://www.googleapis.com/calendar/v3",
};
