import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { currentHourAndDateIn, shouldRunPipeline, isDigestTick } from '../src/scheduling';
import { recordSent } from '../src/db';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('currentHourAndDateIn', () => {
  it('resolves 08:00 Kyiv correctly on both sides of the March DST change', () => {
    // Ukraine goes EET (+2) -> EEST (+3) on 2026-03-29 at 01:00 UTC.
    // Before: 08:00 Kyiv = 06:00 UTC. After: 08:00 Kyiv = 05:00 UTC.
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-03-28T06:00:00Z')).hour).toBe(8);
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-03-30T05:00:00Z')).hour).toBe(8);
  });

  it('resolves 08:00 Kyiv correctly on both sides of the October DST change', () => {
    // Ukraine goes EEST (+3) -> EET (+2) on 2026-10-25 at 01:00 UTC.
    // Before: 08:00 Kyiv = 05:00 UTC. After: 08:00 Kyiv = 06:00 UTC.
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-10-24T05:00:00Z')).hour).toBe(8);
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-10-26T06:00:00Z')).hour).toBe(8);
  });

  it('does not fire on the wrong UTC tick either side of a boundary', () => {
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-03-28T05:00:00Z')).hour).not.toBe(8);
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-10-26T05:00:00Z')).hour).not.toBe(8);
  });
});

describe('shouldRunPipeline', () => {
  it('runs at the configured hour when nothing has been sent yet', async () => {
    const result = await shouldRunPipeline(env.DB, 'Europe/Kyiv', 8, new Date('2026-07-27T05:00:00Z'));
    expect(result).toEqual({ run: true, sendDate: '2026-07-27' });
  });

  it('does not run outside the configured hour', async () => {
    const result = await shouldRunPipeline(env.DB, 'Europe/Kyiv', 8, new Date('2026-07-27T09:00:00Z'));
    expect(result.run).toBe(false);
  });

  it('does not run twice on the same date even at the right hour', async () => {
    await recordSent(env.DB, {
      sendDate: '2026-07-27',
      chatId: '100',
      url: 'https://x/a',
      messageId: 1,
      headline: 'A',
      coinedTerm: null,
      sentAt: '2026-07-27T05:00:00Z',
    });
    const result = await shouldRunPipeline(env.DB, 'Europe/Kyiv', 8, new Date('2026-07-27T05:30:00Z'));
    expect(result.run).toBe(false);
  });
});

describe('isDigestTick', () => {
  it('is true only at 20:00 Kyiv on a Sunday', () => {
    // 2026-07-26 is a Sunday. 20:00 Kyiv in summer (EEST, +3) is 17:00 UTC.
    expect(isDigestTick('Europe/Kyiv', new Date('2026-07-26T17:00:00Z'))).toBe(true);
    expect(isDigestTick('Europe/Kyiv', new Date('2026-07-26T16:00:00Z'))).toBe(false);
    expect(isDigestTick('Europe/Kyiv', new Date('2026-07-27T17:00:00Z'))).toBe(false);
  });
});
