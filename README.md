# PortL share pages (GitHub Pages)

This folder is the website for PortL share links:

| File | Purpose |
|---|---|
| `add.html` | Opened by `https://<domain>/add?name=…&host=…&port=…`. Shows the server, **Open in PortL** (`portl://add?…`) and **Get PortL on Google Play** (with `&referrer=<share link>`). GitHub Pages serves `/add` from `add.html`. |
| `index.html` | Simple landing page. |
| `.well-known/assetlinks.json` | Lets Android verify the App Link so `https://<domain>/add` opens PortL directly. |
| `.nojekyll` | Stops GitHub's Jekyll from hiding the `.well-known` folder. Keep it. |
| `style.css`, `fonts/` | Look and feel (Monocraft font, SIL OFL licence included). |
| `discover/` | Discover page: all **Public** servers, with search and tag filters. Blocky sky background. |
| `server/` | Server page `/server/?id=…`: details, **Open in PortL**, QR code (the normal `/add?…` share link), Play Store link, **Report**. |
| `my/` | My Servers: Google sign-in; owners add/edit/delete their servers (Private = link/QR only, Public = also in Discover). |
| `js/` | Firebase setup (`firebase.js`), shared limits/tags/share-link helpers (`common.js`), one script per page, sky Easter eggs (`sky.js`). |
| `firestore.rules` | Firestore security rules. **Not deployed automatically** - paste into Firebase console > Firestore > Rules after changing. |

## Server listing (Firebase, Spark plan)

- Firebase project `portal-servers`, client SDK only (no Cloud Functions/Storage).
- Firestore `servers/{id}`: `ownerUid, name, host, port, description, tags, visibility, createdAt, updatedAt`.
  Anyone can open a server by ID; lists only return public servers or the signed-in owner's own.
- Firestore `reports/{serverId}_{uid}`: `serverId, reason, details, reporterUid, status, createdAt`.
  Reporters must sign in with Google; one report per account per server; owners can't report their own.
  Create-only from the site; read them in the Firebase console.
- **Report checker** (`.github/workflows/check-reports.yml` + `.github/report-checker/`): every 15 min,
  a Public server with **3 open reports for the same reason** is made Private, gets a `moderation`
  notice (shown on My Servers until the owner makes it Public again) and the owner is emailed via
  Resend. Those reports become `actioned`. Secrets: `FIREBASE_SERVICE_ACCOUNT` (required),
  `RESEND_API_KEY` + `MAIL_FROM` (email), `ADMIN_EMAIL` (optional copy to you). Without the
  service account it does nothing.
- **Status checker** (`.github/report-checker/check-status.mjs`, same workflow, every 15 min): pings
  every server like the app does (Bedrock ping; MineKeep via Java ping with the asleep check) and
  writes `meta/status` = `{ servers: { <sha256(id) first 20 hex>: { s, p, m } }, checkedAt }`.
  Hashed keys keep private server IDs secret. Costs one read per server per run, so about
  300 servers fit in the Spark daily read quota alongside normal traffic.
- **Likes**: `servers/{id}/likes/{uid}` + `likeCount` (Google account, one per account).
  **Adds**: `servers/{id}/adds/{uid}` + `addCount`, counted on "Open in PortL" once per browser
  (anonymous sign-in). **Favourites**: `users/{uid}/favorites/{serverId}`, private to the user.
  **Recent**: this browser's localStorage only.
- **Saved** (`users/{uid}/saved/{serverId}`): the PortL app's server list, synced both ways by the
  app's Google sign-in (`CloudSync.kt`). `{name, host, port, favourite, updatedAt(ms)}`, or a
  tombstone `{deleted: true, updatedAt}`; the newest `updatedAt` wins.
- **Share to Discover** in the app opens `/my/?add=1&name=&host=&port=`, which opens the Add form
  filled in (Public).
- **Cache busting:** every page links `style.css?v=N` and `/js/*.js?v=N`, and the JS files import
  `./firebase.js?v=N` / `./common.js?v=N`. After changing any CSS/JS, bump **N everywhere** (same
  number in every file, or the shared modules load twice). Otherwise phones keep old cached files
  and pages can get stuck on "Loading".
- Limits and the tag list live in both `js/common.js` and `firestore.rules`; keep them in sync.
- Discover Easter eggs: tap the sun 5 times quickly (day → sunset → night), or type
  `/time set sunset` / `/time set night` / `/time set day` in the search box and press Enter.

## Setup

1. **Domain.** App Links need `assetlinks.json` at the root of the domain:
   `https://<domain>/.well-known/assetlinks.json`. That works with either
   - a **custom domain** (e.g. `portl.yourdomain.com`), or
   - a repo named **`<username>.github.io`** (served at `https://<username>.github.io/`).

   A normal project repo (`https://<username>.github.io/<repo>/`) does **not** work for App Links,
   because the file would be under `/<repo>/` instead of the root.

2. **Publish this folder.** Push the contents of `web/` to the repo (at the repo root, or in `/docs`),
   then in the repo's **Settings > Pages**, choose *Deploy from a branch*, pick the branch and
   folder (`/ (root)` or `/docs`), and save. For a custom domain, enter it there, add the DNS
   record GitHub shows (a `CNAME` to `<username>.github.io`), and tick **Enforce HTTPS**.

3. **Fingerprint.** Edit `.well-known/assetlinks.json` and replace the placeholder with the
   SHA-256 of the key that signs the installed app:
   - Debug builds from this PC: `A1:79:DF:6A:5F:02:A0:B8:BC:20:16:D9:A2:24:B3:7B:0C:EB:F7:C7:2B:57:47:F8:10:85:DE:E5:0E:B5:6E:C4`
   - Play Store builds: Play Console > your app > **Test and release > App integrity > App signing**,
     copy the *App signing key certificate* SHA-256.
   You can list several fingerprints in the array (debug and release).

4. **Point the app at the domain.** In `app/build.gradle.kts`, set
   `val PORTL_SHARE_DOMAIN = "<domain>"` (host only, no `https://`, no path), rebuild and reinstall.

5. **Check it.**
   - Open `https://<domain>/.well-known/assetlinks.json` in a browser; it must load as JSON.
   - Google's checker: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<domain>&relation=delegate_permission/common.handle_all_urls`
   - On the phone after reinstalling: `adb shell pm get-app-links com.portl.link` should show the domain as `verified`.
     To re-run verification: `adb shell pm verify-app-links --re-verify com.portl.link`.
