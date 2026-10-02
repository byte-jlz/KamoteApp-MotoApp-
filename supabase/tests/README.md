# Database and sync tests

These run on your computer only. They use [PGlite](https://pglite.dev) (Postgres in Node), so they never touch
your real Supabase project, and they are kept separate from the app so they can't affect the APK.

## Run them

From the `MotoApp` folder:

```
cd supabase/tests
npm install        # first time only
npm test           # runs all five; each prints PASS/FAIL lines and ends with ALL PASSED
```

Or one at a time:

| Command | What it checks |
|---|---|
| `npm run test:accounts` | Profiles, sign-up trigger, Row Level Security on rider data, "newest wins" sync rule, admin functions |
| `npm run test:friends` | Friends, requests, blocking, online status and privacy switch, rate limits, QR codes and Quick add, deleting an account |
| `npm run test:nudges` | Linking phones to accounts, Nudge/Alarm rules (friends only, blocks, limits, 60/hour cap), mutes and settings, one reply within 30 minutes, admin count, deleting an account |
| `npm run test:rls` | Every table (including the fuel tables from `scraper/supabase/schema.sql`) has Row Level Security on |
| `npm run test:sync` | The app's sync code (`src/lib/sync.ts` and friends) with simulated phones and a fake server |

Run them after changing anything in `supabase/migrations/` or `src/lib/sync*.ts`.

## How they work

- Each database test creates a fresh in-memory database and stands in for Supabase with the `anon`, `authenticated`
  and `service_role` roles, an `auth.users` table and `auth.uid()` (the logged-in rider is set per query).
- Every migration in `supabase/migrations/` runs **twice**, to prove the files are safe to re-run.
- The sync test copies the sync modules from `src/lib/` into `sync/lib/` (ignored by Git) and swaps Supabase,
  AsyncStorage and photo files for in-memory fakes in `sync/fakes/`.
