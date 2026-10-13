# Unified Inbox

Personal inbox and calendar for several Gmail accounts, in one browser tab.

Live site: https://janvanhal.github.io/unified-inbox/

## What it does

- One mail list across the Gmail accounts you add: Inbox, Starred, Sent, and All, plus search, an unread filter, and load-more.
- Read mail, reply, reply all, forward, archive, trash, star, and download attachments.
- One calendar across those accounts: agenda, week, and month. Create, edit, and delete events on calendars you can change.
- Light and dark theme. Times default to Asia/Bangkok. Change that in Settings.

## Privacy

This is a static site. There is no backend. The OAuth client ID and the account list live in `localStorage` in your browser. Access tokens are kept in memory and `sessionStorage` only. They are never written to `localStorage`. Email HTML is sanitized with DOMPurify and shown in a sandboxed frame with scripts disabled.

Setup is in [SETUP.md](SETUP.md). You paste the client ID into Settings. You do not put it in the code.

## Run locally

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. Modules do not work if you open `index.html` as a file. For sign-in to work locally, add that origin on the OAuth client as well (see SETUP.md).

## GitHub Pages

Publish the `main` branch from the repository root (`/`). The OAuth client's authorized JavaScript origin must be `https://janvanhal.github.io`.

## Scopes

The app asks only for `gmail.modify`, `gmail.send`, `calendar.events`, and `calendar.readonly`.
