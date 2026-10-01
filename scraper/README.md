# MotoMonitor fuel scraper

Checks Philippine news for pump price adjustments (gasoline, diesel, kerosene), saves them to Supabase,
and sends a push notification to MotoMonitor users through Firebase Cloud Messaging.

Runs on GitHub Actions (Node 22): every 3 hours Sunday–Tuesday (when PH price changes are announced) and once a day otherwise.

## How it works

1. `src/sources.js` reads Google News RSS (PH, last 7 days). Only the headline, link and outlet name are kept.
2. `src/parse.js` pulls out fuel, direction and ₱/liter amount, e.g.
   `"Diesel down P1.55, gasoline up P0.29"` → diesel ▼ 1.55, gasoline ▲ 0.29. LPG (per kilo) is ignored.
3. `src/dates.js` decides which Tuesday it applies to (explicit date → past-tense report → coming Tuesday).
4. `src/index.js` saves headlines and adjustments to Supabase. If a figure for an **upcoming** Tuesday is new
   (or flips direction), it sends one push to every phone with fuel alerts on, and cleans up uninstalled phones.

## Setup (one time)

1. **Supabase**: open SQL Editor → New query → paste `scraper/supabase/schema.sql` → Run.
2. **GitHub secrets** (Settings → Secrets and variables → Actions):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT` (whole JSON).
3. The workflow is `.github/workflows/scrape.yml` at the repo root (note the dot in `.github`).
   Actions → **Check fuel prices** → **Run workflow** (tick *Dry run* first).

## Local commands

```bash
cd scraper
npm install
npm test          # parser tests
npm run dry-run   # fetch + parse real headlines, print results; no secrets, no writes, no pushes
```

## Notes

- GitHub disables scheduled workflows in repos with no commits for 60 days; re-enable from the Actions tab if that happens.
- GitHub may run scheduled jobs a few minutes late at busy times.
- Headline parsing is heuristic. When outlets disagree, the most recently published headline wins.
  Add any headline it gets wrong to `test/parse.test.js`, then fix `src/parse.js`.
