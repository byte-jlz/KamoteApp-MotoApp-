const m = new Map();
const AsyncStorage = {
  async getItem(k) { return m.has(k) ? m.get(k) : null; },
  async setItem(k, v) { m.set(k, v); },
  async removeItem(k) { m.delete(k); },
  async multiRemove(ks) { ks.forEach((k) => m.delete(k)); },
  _map: m,
};
export default AsyncStorage;
