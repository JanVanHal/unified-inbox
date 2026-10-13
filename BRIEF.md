# Unified Inbox — Build brief

## Purpose & audience
Personal web app for Jan: one unified Gmail inbox and one unified calendar across MULTIPLE Gmail accounts, in the browser. English UI. Hosted on GitHub Pages at https://janvanhal.github.io/unified-inbox/.

## Tech (hard rules)
- Static vanilla HTML/CSS/JS, no frameworks, no backend, no build step. Files: index.html, styles.css, config.js, js/*.js (ES modules ok), README.md, SETUP.md.
- Google Identity Services token client (implicit flow): `https://accounts.google.com/gsi/client`. Gmail REST + Calendar REST via fetch with Bearer token.
- Scopes (least privilege): gmail.modify, gmail.send, calendar.events, calendar.readonly. Nothing else.
- No secrets in the repo. OAuth client ID is public: config.js holds `CLIENT_ID: ""`; the app ALSO has a Settings field that saves the client ID to localStorage (preferred; overrides config.js). If none is set, show a friendly first-run screen pointing to SETUP.md.
- DOMPurify via CDN (pinned version, with SRI if possible) for email HTML.

## Accounts
- "Add Gmail account" → new token request per account with `prompt: 'select_account'` and `login_hint` when known. Get email via Gmail `users/me/profile`.
- localStorage: account list (email, colour, label, enabled). Access tokens ONLY in memory/sessionStorage, never localStorage.
- On expiry/401: silent re-auth (`prompt: ''`, login_hint=email); if that fails, show a "Reconnect" chip on that account. One account failing must never break the others.
- Remove account (revoke token via google.accounts.oauth2.revoke).
- Disabled placeholder row "Proton (coming later)" in the account list. No Proton code.

## Unified inbox
- Merge threads from all accounts, sorted by date; colour dot per account; filter by account; Unread filter; Inbox/Starred/Sent/All folders; search box passed as Gmail `q`.
- Pagination: "Load more" using each account's nextPageToken.
- Thread view: messages rendered via DOMPurify-sanitized HTML inside `<iframe sandbox>` (no allow-scripts; use srcdoc), plain-text fallback; remote images allowed but links open in new tab.
- Actions: mark read/unread, archive, trash, star/unstar.
- Compose / reply / reply-all / forward with From account selector; build RFC 2822 message (UTF-8, proper headers, In-Reply-To/References, threadId on reply) base64url → messages.send.
- Attachments: list with download (attachments.get → Blob → download).
- Keyboard shortcuts: j/k next/prev, Enter open, e archive, r reply, c compose, / search, Esc close. Ignore when typing in inputs. `?` shows help.

## Unified calendar
- calendarList from all accounts; all selected calendars merged; colour per calendar (Google colour or assigned), toggle calendars on/off.
- Views: Agenda, Week, Month; prev/next/today.
- Create/edit/delete events choosing the target calendar (only calendars with writer/owner access). Title, all-day, start/end, location, description.
- Default timezone Asia/Bangkok, changeable in Settings (saved in localStorage).

## Design
- Jan's Pulse/Notion style: reuse the token approach of JanVanHal/netpulse styles.css (Inter, Notion-like spacing, borders rgba(0,0,0,.08), blue #0075de accent).
- Light and Dark themes with toggle (respect prefers-color-scheme initially). Light: light slightly grey tones (e.g. #f7f7f8 canvas, #ffffff surface), NOT beige. Dark: near-black #191919 canvas, surfaces #202020/#252525, never pure black.
- Layout: sidebar (accounts, folders, calendar toggle) + list + reading pane on desktop; single column with back button on mobile. Fully responsive, accessible (labels, focus rings, aria).

## SETUP.md (plain language for Jan)
Steps: create Google Cloud project; enable Gmail API and Google Calendar API; OAuth consent screen External, Testing; add each Gmail address as test user; create OAuth client of type "Web application" with Authorized JavaScript origin `https://janvanhal.github.io`; copy the client ID; open the app → Settings → paste client ID (no code edit needed). Mention the "Google hasn't verified this app" warning in Testing mode and that tokens last ~1 hour then refresh silently.

## Check mode
Code-only review by the agent; Jan opens the live site himself.

## Fix list
