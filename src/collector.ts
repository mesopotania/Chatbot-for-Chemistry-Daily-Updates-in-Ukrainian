import { Candidate, Tier } from './types';
import { isUrlSent, getSeenRow, markSeen } from './db';
import { parseRssItems } from './rss';

interface FeedSource {
  tier: Tier;
  name: string;
  url: string;
}

export const FEED_SOURCES: FeedSource[] = [
  { tier: 'core', name: 'Chemistry World', url: 'https://www.chemistryworld.com/rss/news.rss' },
  { tier: 'core', name: 'C&EN', url: 'https://cen.acs.org/rss.xml' },
  { tier: 'core', name: 'Nature Chemistry', url: 'https://www.nature.com/nchem.rss' },
  { tier: 'core', name: 'Phys.org — хімія', url: 'https://phys.org/rss-feed/chemistry-news/' },
  { tier: 'core', name: 'ScienceDaily — хімія', url: 'https://www.sciencedaily.com/rss/matter_energy/chemistry.xml' },
  { tier: 'widening', name: 'Phys.org — матеріалознавство', url: 'https://phys.org/rss-feed/physics-news/materials-science/' },
  { tier: 'widening', name: 'ScienceDaily — фармакологія', url: 'https://www.sciencedaily.com/rss/health_medicine/pharmacology.xml' },
];

const FEED_TIMEOUT_MS = 10_000;
const ELIGIBILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
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
  const candidates: Candidate[] = [];

  for (const source of sources) {
    const xml = await fetchFeed(source.url);
    if (!xml) continue;

    let items;
    try {
      items = parseRssItems(xml);
    } catch {
      continue;
    }

    for (const item of items) {
      if (await isUrlSent(db, item.link)) continue;

      const seenRow = await getSeenRow(db, item.link);
      if (seenRow) {
        if (!isWithinEligibilityWindow(seenRow.firstSeenAt, now)) continue;
      } else {
        await markSeen(db, item.link, now.toISOString());
      }

      candidates.push({
        url: item.link,
        title: item.title,
        blurb: item.description,
        publishedAt: item.pubDate,
        sourceName: source.name,
      });
    }
  }

  return candidates;
}
