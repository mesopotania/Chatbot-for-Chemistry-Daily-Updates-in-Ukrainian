import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { parseRssItems } from '../src/rss';
import { collect, FEED_SOURCES } from '../src/collector';
import { markSeen } from '../src/db';
import chemistryWorldXml from './fixtures/chemistry-world.xml?raw';
import malformedXml from './fixtures/malformed.xml?raw';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('parseRssItems', () => {
  it('extracts title, link, description, pubDate, and image from each item', () => {
    const items = parseRssItems(chemistryWorldXml);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'New catalyst speeds up nitrogen fixation',
      link: 'https://www.chemistryworld.com/news/new-catalyst-nitrogen',
      description: 'Researchers report a cobalt-based catalyst that fixes nitrogen at room temperature.',
      pubDate: 'Mon, 27 Jul 2026 06:00:00 GMT',
      image: 'https://img.chemistryworld.com/nitrogen.jpg',
    });
    expect(items[1].image).toBe(''); // no image tag on the second item
  });

  it('decodes XML entities outside of CDATA', () => {
    const items = parseRssItems(chemistryWorldXml);
    expect(items[1].title).toBe('Old & well-known reaction gets a new mechanism');
  });

  it('returns an empty list for non-XML input rather than throwing', () => {
    expect(() => parseRssItems(malformedXml)).not.toThrow();
    expect(parseRssItems(malformedXml)).toEqual([]);
  });
});

describe('collect', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === FEED_SOURCES.find((s) => s.tier === 'core')!.url) {
        return new Response(chemistryWorldXml, { status: 200 });
      }
      return new Response('', { status: 500 });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns candidates from the core tier, skipping failing feeds', async () => {
    const candidates = await collect(env.DB, 'core', new Date('2026-07-27T08:00:00Z'));
    expect(candidates.some((c) => c.url === 'https://www.chemistryworld.com/news/new-catalyst-nitrogen')).toBe(true);
  });

  it('drops a URL that is already in sent', async () => {
    await env.DB
      .prepare('INSERT INTO sent (send_date, chat_id, url, message_id, headline, coined_term, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('2026-07-20', '100', 'https://www.chemistryworld.com/news/new-catalyst-nitrogen', 1, 'H', null, '2026-07-20T08:00:00Z')
      .run();
    const candidates = await collect(env.DB, 'core', new Date('2026-07-27T08:00:00Z'));
    expect(candidates.some((c) => c.url === 'https://www.chemistryworld.com/news/new-catalyst-nitrogen')).toBe(false);
  });

  it('keeps a candidate seen 3 days ago but drops one seen 8 days ago', async () => {
    const now = new Date('2026-07-27T08:00:00Z');
    await markSeen(env.DB, 'https://www.chemistryworld.com/news/new-catalyst-nitrogen', '2026-07-24T08:00:00Z');
    await markSeen(env.DB, 'https://www.chemistryworld.com/news/old-reaction-mechanism', '2026-07-19T08:00:00Z');
    const candidates = await collect(env.DB, 'core', now);
    expect(candidates.some((c) => c.url.endsWith('new-catalyst-nitrogen'))).toBe(true);
    expect(candidates.some((c) => c.url.endsWith('old-reaction-mechanism'))).toBe(false);
  });
});
