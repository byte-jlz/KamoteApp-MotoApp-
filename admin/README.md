# MotoMonitor Admin

A small website for admins: dashboard (riders, motorcycles, service logs this month, items overdue, friendships),
every account with its status, each rider's bikes / service logs / clubs and friend counts (never who their friends
are), and actions: **Create user**, **Reset temporary
password**, **Email a reset code**, **Disable / Enable account**.

Plain HTML/CSS/JS, no build step. Works on phone and desktop browsers.

## How it stays safe

- Only the public anon key is in `config.js`. Rider data can only be read by accounts whose `profiles.role` is
  `admin` (database rules), and every change goes through the `admin-users` Edge Function, which checks the admin
  role again on the server. The service key never leaves Supabase.
- Passwords are never shown or stored. A temporary password is generated on the server, shown **once**, and wiped
  from the page when you close the box (or after 10 minutes).
- Rider-entered text is always shown as text, so it can't run code on this page.

## One-time setup

1. **Deploy the Edge Function** `admin-users` (Supabase → Edge Functions → Deploy a new function → Via Editor →
   name `admin-users` → paste `supabase/functions/admin-users/index.ts` → Deploy). Then in its settings turn
   **OFF "Verify JWT with legacy secret"** (the function checks the login itself).
2. **Make yourself admin** (Supabase → SQL Editor), using your own email:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

## Deploy (free)

**Netlify, automatic from GitHub (recommended):** `netlify.toml` in the MotoApp folder tells Netlify to publish
this `admin` folder as it is (no build step). Link the site to the GitHub repo once, and every `git push` that
changes something in `admin/` updates the site within a minute or two. Pushes that only change the app are skipped.

1. In Netlify, open your site → **Site configuration** → **Build & deploy** → **Continuous deployment** →
   **Link repository**.
2. Choose **GitHub**, allow Netlify access (you can limit it to this one repository), and pick the MotoApp repo.
3. Branch to deploy: **main**. Leave the build settings as Netlify fills them in from `netlify.toml`
   (base directory `admin`, no build command, publish directory `admin`). Save, and Netlify deploys right away.

The site keeps its address. Deploys and rollbacks are listed under **Deploys**.

**Netlify by hand:** go to https://app.netlify.com/drop and drag the whole `admin` folder onto the page.

**Vercel:** `npx vercel deploy admin --prod` from the MotoApp folder, or import the GitHub repo in Vercel with
**Root Directory** set to `admin` and **Framework Preset** "Other" (no build command).

Both use the security headers in `_headers` (Netlify) / `vercel.json` (Vercel).

## Try it locally

From the MotoApp folder: `npx serve admin` and open the address it prints. (Opening `index.html` directly from
disk won't work; browsers block modules on `file://`.)
