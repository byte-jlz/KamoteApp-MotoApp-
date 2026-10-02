// Every table in the public schema must have Row Level Security on, including the fuel tables from
// scraper/supabase/schema.sql (loaded before and after the migrations, as in production).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('../migrations', import.meta.url));
const FUEL = fileURLToPath(new URL('../../scraper/supabase/schema.sql', import.meta.url));
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key, email varchar(255), raw_user_meta_data jsonb, created_at timestamptz default now(),
    last_sign_in_at timestamptz, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
await db.exec(readFileSync(FUEL, 'utf8'));
for (const f of readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIG, f), 'utf8'));
await db.exec(readFileSync(FUEL, 'utf8'));

const { rows } = await db.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1`);
let failures = 0;
for (const r of rows) {
  if (!r.rowsecurity) failures++;
  console.log(`${r.rowsecurity ? 'PASS' : 'FAIL'}  RLS on ${r.tablename}`);
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
