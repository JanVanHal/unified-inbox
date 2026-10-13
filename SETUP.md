# Set up Unified Inbox

You only do this once. The app runs in your browser and talks to Gmail and Google Calendar directly. There is no server in the middle.

## 1. Create a Google Cloud project

1. Open https://console.cloud.google.com/
2. Create a project. Any name is fine, for example `Unified Inbox`.

## 2. Turn on the APIs

1. In the project, go to **APIs & Services → Library**.
2. Enable **Gmail API**.
3. Enable **Google Calendar API**.

## 3. OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. User type: **External**.
3. Keep the publishing status on **Testing**. You do not need to verify or publish the app.
4. App name: `Unified Inbox`. Use your email as the user support email.
5. You can leave the scopes list empty on this screen. The app requests these when you sign in:
   - Gmail modify (read mail, archive, trash, star, mark read)
   - Gmail send
   - Calendar events (create and edit events)
   - Calendar read-only (list calendars)
6. Under **Test users**, add every Gmail address you want to connect. Save.

An address that is not on the test-user list cannot sign in while the app is in Testing.

## 4. Create the OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Unified Inbox`.
4. Under **Authorized JavaScript origins**, add:

   `https://janvanhal.github.io`

   The origin is only the scheme and host. Do not add `/unified-inbox` or a trailing path.
5. You do not need a redirect URI. This app uses the Google Identity Services token flow, which does not redirect the page.
6. Create the client, then copy the **Client ID**. It looks like `1234567890-abc.apps.googleusercontent.com`.

The client ID is public. It is safe to paste into the app. Do not put it in git unless you want to. The copy in this repo is left blank on purpose.

## 5. Paste the client ID into the app

1. Open https://janvanhal.github.io/unified-inbox/
2. On the first screen, paste the client ID and save.
3. You can change it later under **Settings**. It is stored in this browser only. You do not edit any file.
4. Choose **Add Gmail account** and sign in with one of the test users. Repeat for each Gmail address.

## The "Google hasn't verified this app" warning

Testing mode always shows this warning. That is expected.

On the warning screen, choose **Advanced**, then **Go to Unified Inbox (unsafe)**. The app is yours, using the client ID you just created. Google shows the warning because you have not put the app through Google's public verification, which you do not need for personal use.

## Sign-in lasts about an hour

Google access tokens expire after about an hour. The app asks Google to refresh them quietly, with no extra click, when you come back or when a request is rejected. If that quiet refresh fails, that account shows a **Reconnect** button. Other accounts keep working.

## Try it on your computer

The live site is the link above. To run this folder locally:

```bash
python3 -m http.server 8080
```

Then add `http://localhost:8080` as another Authorized JavaScript origin on the same OAuth client. Opening the HTML file directly (`file://`) will not work.

## Remove access later

Remove an account in the sidebar. The app revokes that account's token. You can also open https://myaccount.google.com/permissions and remove **Unified Inbox** there.
