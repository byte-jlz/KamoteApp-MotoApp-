# MotoMonitor — Release & Update Guide

How to build the APK, ship changes, and make old versions of the app ask users to update.

---

## How updates work (read this first)

There are **two kinds of updates**, and the app handles both automatically:

| Kind | When you use it | What the rider sees | How you ship it |
|---|---|---|---|
| **Quick update** (over-the-air) | You changed code in `src/` — screens, features, text, default intervals, bug fixes | "✨ Update ready — Restart now" | `npm run update -- --message "..."` (1–2 min, no new APK) |
| **New APK** | You added a native library, changed `app.json` (name, icon, permissions, plugins), or upgraded Expo | "⬇️ New version available — Download" | Build a new APK, upload it, edit `update-manifest.json` |

The app checks for both **every time it opens**, and again whenever it comes back to the screen after 30+ minutes. Riders can also check manually in **Settings → About → Check for updates**.

> Rule of thumb: if you only touched files inside `src/`, it's a quick update. If you ran `npx expo install <something>` or edited `app.json`, it needs a new APK. **When in doubt, build a new APK** — it always works.

---

## Part 1 — One-time setup

### 1. Create a free Expo account
Sign up at **https://expo.dev/signup**. Builds run on Expo's servers, so you don't need Android Studio.

### 2. Log in and link the project
Run these in the `MotoApp` folder:

```
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest update:configure
```

- `init` links this project to your Expo account (adds a `projectId` to `app.json`).
- `update:configure` turns on quick updates (adds `updates.url` to `app.json`).

**After running them, open `app.json` and check** that `runtimeVersion` still says:
```json
"runtimeVersion": { "policy": "fingerprint" }
```
If the command changed it, put it back. This setting is what makes sure a quick update is only sent to APKs that can run it.

### 3. Save your code with Git
EAS uses Git to know which files to upload.

```
git init
git add .
git commit -m "MotoMonitor 1.0.0"
```

Commit again before every build or update (`git add .` then `git commit -m "what changed"`).

### 4. Set up a place to host the APK (GitHub)
This is how old versions find out that a new APK exists.

1. Create a free account at **https://github.com** if you don't have one.
2. Create a **new public repository** named `motopms-releases` (it will only hold the APK and one small file, not your code).
3. Upload `update-manifest.json` from this folder into that repository.
   - First edit its `downloadUrl` and replace `YOUR-GITHUB-NAME` with your GitHub username.
4. Open the uploaded file on GitHub, click **Raw**, and copy the URL. It looks like:
   `https://raw.githubusercontent.com/YOUR-GITHUB-NAME/motopms-releases/main/update-manifest.json`
5. Paste that URL into `app.json`:
   ```json
   "extra": {
     "updateManifestUrl": "https://raw.githubusercontent.com/YOUR-GITHUB-NAME/motopms-releases/main/update-manifest.json"
   }
   ```

> Do step 5 **before** building your first APK. The URL is built into the APK, so an APK built without it can never show the "New version available" message.

---

## Part 2 — Build and share the first APK

```
npm run build:apk
```

- It asks a few questions the first time. Accept the defaults, and say **yes** to generating a new Android keystore.
- The build takes about 10–20 minutes. When it finishes, you get a link to download the `.apk`.

**Publish it:**
1. In your `motopms-releases` repo on GitHub, go to **Releases → Create a new release**.
2. Tag: `v1.0.0`. Title: `MotoMonitor 1.0.0`.
3. Attach the APK file and **rename it to exactly `MotoPMS.apk`**.
4. Publish.

The link `https://github.com/YOUR-GITHUB-NAME/motopms-releases/releases/latest/download/MotoPMS.apk` now always downloads the newest APK. Share it with riders.

**Installing on a phone:** open the link, download, tap the file, and allow **"Install unknown apps"** when Android asks. A Play Protect warning is normal for apps outside the Play Store. Tap **Install anyway**.

---

## Part 3 — Shipping changes

### A) Quick update (you only changed code in `src/`)

```
git add .
git commit -m "Add fuel log"
npm run update -- --message "Added fuel log screen"
```

That's it. The next time riders open the app, it downloads the change and shows **"Update ready — Restart now"**.

### B) New APK (native or `app.json` changes)

1. In `app.json`, raise `"version"`, e.g. `"1.0.0"` → `"1.1.0"`.
2. Commit, then build:
   ```
   git add .
   git commit -m "Version 1.1.0"
   npm run build:apk
   ```
3. On GitHub, create a new release (tag `v1.1.0`) and attach the APK, again named **`MotoPMS.apk`**.
4. Edit `update-manifest.json` **in the GitHub repo** (pencil icon):
   ```json
   {
     "latestVersion": "1.1.0",
     "minimumVersion": "1.0.0",
     "downloadUrl": "https://github.com/YOUR-GITHUB-NAME/motopms-releases/releases/latest/download/MotoPMS.apk",
     "releaseNotes": "• New fuel log\n• Faster loading"
   }
   ```
   Within a few minutes, every older APK shows **"New version available — Download"**.

**Forcing an update:** set `minimumVersion` to the new version (e.g. `"1.1.0"`). Older apps then show **"Update required"** with no "Later" button. Use this only for serious bugs.

Installing the new APK over the old one **keeps all the rider's data**.

---

## Part 4 — Test before riders see it (optional, recommended)

There is a separate **test channel**, so you can try updates on your own phone first:

```
npm run build:test-apk                              # build a test APK once and install it on your phone
npm run update:test -- --message "Trying fuel log"  # send quick updates only to test APKs
```

When it works, publish the same thing to riders with `npm run update -- --message "..."`.

---

## ⚠️ Important notes

1. **Always build with the same Expo account.** Expo stores the signing key for your APK. Android only installs an update over the old app if it's signed with the same key. A different key means riders must uninstall first, and **uninstalling deletes their data**.
2. **Never change `"package": "com.motopms.app"`** in `app.json`. Android would treat it as a completely different app.
3. **Only raise `version` when you build a new APK.** Leave it alone for quick updates.
4. **Rider data lives only on their phone.** Updates keep it, but uninstalling the app or clearing its data erases it. There is no cloud backup yet.
5. **Be careful when changing saved data.** If you change the shape of the data in `src/lib/types.ts` (rename or remove fields), old saved data still loads into the new code. Prefer adding new optional fields over renaming existing ones.
6. **A quick update that breaks the app** can be undone. Publish a fixed one right away, or roll back:
   ```
   npx eas-cli@latest update:rollback
   ```
7. **Update checks need internet.** Offline riders get the prompt the next time they open the app online.
8. **Notifications and update checks don't work in Expo Go or the browser.** They only work in the installed APK. Keep using `npm run dev` with Expo Go for everyday testing of screens and features.
9. **The free Expo plan** has monthly limits on builds and update users, and builds may wait in a queue. That's plenty for a personal or small-group app; see https://expo.dev/pricing.

---

## Command cheat sheet

| Task | Command |
|---|---|
| Run on phone with Expo Go | `npm run dev` |
| Preview in browser | `npm run web` |
| Check for code errors | `npm run typecheck` and `npm run lint` |
| Build APK for riders | `npm run build:apk` |
| Quick update to riders | `npm run update -- --message "what changed"` |
| Build test APK | `npm run build:test-apk` |
| Quick update to test APKs only | `npm run update:test -- --message "what changed"` |
| Undo a bad quick update | `npx eas-cli@latest update:rollback` |
