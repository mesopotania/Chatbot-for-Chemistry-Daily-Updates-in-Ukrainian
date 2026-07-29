import { Candidate, Tier } from './types';
import { getSentUrlSet, getAllSeen, markSeenBatch } from './db';
import { parseRssItems, RawRssItem } from './rss';

interface FeedSource {
  tier: Tier;
  name: string;
  url: string;
}

// Feed URLs verified live and returning fresh, parseable RSS 2.0 (2026-07-28).
// Core: chemistry-direct news prose. Widening: adjacent fields, collected only
// when the core tier yields nothing the selector will take.
export const FEED_SOURCES: FeedSource[] = [
  // Chemistry World (RSC) — the premium magazine; numeric .rss paths.
  { tier: 'core', name: 'Chemistry World — новини', url: 'https://www.chemistryworld.com/409.rss' },
  { tier: 'core', name: 'Chemistry World — дослідження', url: 'https://www.chemistryworld.com/410.rss' },
  { tier: 'core', name: 'Phys.org — хімія', url: 'https://phys.org/rss-feed/chemistry-news/' },
  { tier: 'core', name: 'Phys.org — аналітична хімія', url: 'https://phys.org/rss-feed/chemistry-news/analytical-chemistry/' },
  { tier: 'core', name: 'ScienceDaily — хімія', url: 'https://www.sciencedaily.com/rss/matter_energy/chemistry.xml' },
  { tier: 'widening', name: 'Phys.org — матеріалознавство', url: 'https://phys.org/rss-feed/physics-news/materials-science/' },
  { tier: 'widening', name: 'Phys.org — нанотехнології', url: 'https://phys.org/rss-feed/nanotech-news/' },
  { tier: 'widening', name: 'Phys.org — полімери', url: 'https://phys.org/rss-feed/chemistry-news/polymers/' },
  { tier: 'widening', name: 'ScienceDaily — біохімія', url: 'https://www.sciencedaily.com/rss/matter_energy/biochemistry.xml' },
  { tier: 'widening', name: 'ScienceDaily — фармакологія', url: 'https://www.sciencedaily.com/rss/health_medicine/pharmacology.xml' },
];

const FEED_TIMEOUT_MS = 10_000;
const ELIGIBILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FEED_USER_AGENT = 'Mozilla/5.0 (compatible; KhimiyaShchodnyaBot/1.0)';
// Newest N items per feed. Keeps the candidate set (and the Gemini selection
// prompt) focused, and bounds the work per run.
const MAX_ITEMS_PER_FEED = 8;

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: { 'User-Agent': FEED_USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function isWithinEligibilityWindow(firstSeenAt: string, now: Date): boolean {
  return now.getTime() - new Date(firstSeenAt).getTime() <= ELIGIBILITY_WINDOW_MS;
}

export async function collect(db: D1Database, tier: Tier, now: Date = new Date()): Promise<Candidate[]> {
  const sources = FEED_SOURCES.filter((s) => s.tier === tier);

  // Fetch and parse every feed first (network only, no DB).
  const raw: { item: RawRssItem; sourceName: string }[] = [];
  for (const source of sources) {
    const xml = await fetchFeed(source.url);
    if (!xml) continue;
    let items: RawRssItem[];
    try {
      items = parseRssItems(xml);
    } catch {
      continue;
    }
    for (const item of items.slice(0, MAX_ITEMS_PER_FEED)) {
      raw.push({ item, sourceName: source.name });
    }
  }

  // Load dedup state in a couple of queries, then filter in memory — this keeps
  // the per-invocation D1 call count tiny regardless of how many items we saw.
  const sentUrls = await getSentUrlSet(db);
  const seen = await getAllSeen(db);

  const candidates: Candidate[] = [];
  const toMark: string[] = [];
  for (const { item, sourceName } of raw) {
    if (sentUrls.has(item.link)) continue;

    const firstSeenAt = seen.get(item.link);
    if (firstSeenAt !== undefined) {
      if (!isWithinEligibilityWindow(firstSeenAt, now)) continue;
    } else {
      toMark.push(item.link);
      seen.set(item.link, now.toISOString()); // avoid re-marking a dupe in this run
    }

    candidates.push({
      url: item.link,
      title: item.title,
      blurb: item.description,
      publishedAt: item.pubDate,
      sourceName,
      imageUrl: item.image || null,
    });
  }

  await markSeenBatch(db, toMark, now.toISOString());
  return candidates;
}
