// Copies the app modules under test (unchanged) next to the fakes. Run from here they load as ES modules,
// so the hooks in hooks.mjs can swap Supabase, AsyncStorage and photos for in-memory fakes.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const lib = new URL('./lib/', import.meta.url);
rmSync(lib, { recursive: true, force: true });
mkdirSync(lib);
for (const f of ['sync', 'syncData', 'localData', 'types']) {
  copyFileSync(new URL(`../../../src/lib/${f}.ts`, import.meta.url), new URL(`${f}.ts`, lib));
}
