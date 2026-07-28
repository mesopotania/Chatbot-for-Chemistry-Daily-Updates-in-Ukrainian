import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { BACKLOG_ITEMS } from '../src/backlogData';
import { pickBacklogItem } from '../src/backlog';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('backlog data', () => {
  it('has at least 14 items so a fortnight of failure produces no repeats', () => {
    expect(BACKLOG_ITEMS.length).toBeGreaterThanOrEqual(14);
  });

  it('has a unique slug for every item', () => {
    const slugs = BACKLOG_ITEMS.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('pickBacklogItem', () => {
  it('produces 14 distinct items across 14 consecutive total-failure days', async () => {
    const picked = new Set<string>();
    for (let day = 0; day < 14; day++) {
      const now = new Date(Date.UTC(2026, 0, day + 1, 8, 0, 0));
      const item = await pickBacklogItem(env.DB, now);
      expect(item).not.toBeNull();
      picked.add(item!.slug);
    }
    expect(picked.size).toBe(14);
  });

  it('returns null once every item has been used', async () => {
    for (let day = 0; day < BACKLOG_ITEMS.length; day++) {
      await pickBacklogItem(env.DB, new Date(Date.UTC(2026, 0, day + 1)));
    }
    expect(await pickBacklogItem(env.DB, new Date(Date.UTC(2026, 1, 1)))).toBeNull();
  });
});
