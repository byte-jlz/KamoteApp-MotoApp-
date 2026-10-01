import { XMLParser } from 'fast-xml-parser';

// Google News RSS search, limited to the Philippines and the last 7 days. It aggregates PH outlets
// (GMA, Inquirer, Philstar, ABS-CBN, PNA, ...) and is a public feed meant for readers like this one.
// We only keep the headline, link and outlet name — never article bodies.
const QUERIES = [
  'oil price hike rollback Philippines when:7d',
  'gasoline diesel kerosene price per liter Philippines when:7d',
];

const feedUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-PH&gl=PH&ceid=PH:en`;

const parser = new XMLParser({ ignoreAttributes: false });

/** Returns [{ title, url, source, published }] de-duplicated by URL and title. */
export async function fetchHeadlines() {
  const seen = new Set();
  const out = [];
  for (const q of QUERIES) {
    const res = await fetch(feedUrl(q), { headers: { 'User-Agent': 'MotoMonitor-fuel-scraper/1.0' } });
    if (!res.ok) throw new Error(`Feed ${res.status} for "${q}"`);
    const xml = parser.parse(await res.text());
    const items = [xml?.rss?.channel?.item ?? []].flat();
    for (const it of items) {
      const source = typeof it.source === 'object' ? it.source['#text'] : it.source;
      // Google appends " - Outlet" to titles; strip it so parsing sees only the headline.
      const raw = String(it.title ?? '');
      const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
      const url = String(it.link ?? '');
      const key = title.toLowerCase();
      if (!title || !url || seen.has(url) || seen.has(key)) continue;
      seen.add(url);
      seen.add(key);
      out.push({ title, url, source: source ?? null, published: it.pubDate ? new Date(it.pubDate) : null });
    }
  }
  return out;
}
