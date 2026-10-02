// Redirect the app's native/network modules to fakes. Each "phone" loads src/lib with its own ?phone=X query,
// so module-level state (sync bookkeeping, AsyncStorage) is separate per phone; the fake server is shared.
import { pathToFileURL } from 'node:url';
const FAKES = new URL('./fakes/', import.meta.url);
const LIB = new URL('./lib/', import.meta.url).href; // copied from src/lib by copy-lib.mjs
const q = (parent) => { const i = parent?.indexOf('?') ?? -1; return i >= 0 ? parent.slice(i) : ''; };

export async function resolve(spec, ctx, next) {

  const query = q(ctx.parentURL);
  if (spec === 'react-native') return { url: new URL('react-native.mjs', FAKES).href, shortCircuit: true };
  if (spec === '@react-native-async-storage/async-storage') return { url: new URL('async-storage.mjs', FAKES).href + query, shortCircuit: true };
  if (ctx.parentURL?.toLowerCase().startsWith(LIB.toLowerCase()) && spec.startsWith('./')) {
    const name = spec.slice(2);
    if (name === 'supabase') return { url: new URL('supabase.mjs', FAKES).href, shortCircuit: true };
    if (name === 'photos') return { url: new URL('photos.mjs', FAKES).href, shortCircuit: true };
    return { url: LIB + name + '.ts' + query, shortCircuit: true };
  }
  return next(spec, ctx);
}
