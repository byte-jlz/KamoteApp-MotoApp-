globalThis.__deleted ??= [];
export function deleteMediaFile(f) { if (f) globalThis.__deleted.push(f); }
