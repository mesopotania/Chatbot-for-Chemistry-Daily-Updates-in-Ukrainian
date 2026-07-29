import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import {
  isUrlSent,
  getSeenRow,
  markSeen,
  getSentForDate,
  getSentByChatAndMessageId,
  recordSent,
  getSentBetween,
  upsertFeedback,
  getFeedbackBetween,
  isBacklogUsed,
  markBacklogUsed,
  pruneSeenOlderThan,
  addRecipient,
  isRecipient,
  getRecipientChatIds,
} from '../src/db';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('recipients', () => {
  it('tracks who has activated and lists their chat ids', async () => {
    expect(await isRecipient(env.DB, '100')).toBe(false);
    await addRecipient(env.DB, '100', 'Grandma', '2026-07-29T00:00:00Z');
    expect(await isRecipient(env.DB, '100')).toBe(true);
    await addRecipient(env.DB, '200', null, '2026-07-29T00:00:01Z');
    expect(await getRecipientChatIds(env.DB)).toEqual(expect.arrayContaining(['100', '200']));
  });

  it('is idempotent: adding the same chat id twice does not duplicate', async () => {
    await addRecipient(env.DB, '100', 'Grandma', '2026-07-29T00:00:00Z');
    await addRecipient(env.DB, '100', 'Grandma', '2026-07-29T00:00:01Z');
    expect(await getRecipientChatIds(env.DB)).toEqual(['100']);
  });
});

describe('seen / sent', () => {
  it('tracks seen URLs and their first-seen timestamp', async () => {
    expect(await getSeenRow(env.DB, 'https://x/a')).toBeNull();
    await markSeen(env.DB, 'https://x/a', '2026-07-01T00:00:00Z');
    expect(await getSeenRow(env.DB, 'https://x/a')).toEqual({ firstSeenAt: '2026-07-01T00:00:00Z' });
  });

  it('reports a URL as sent only after recordSent', async () => {
    expect(await isUrlSent(env.DB, 'https://x/a')).toBe(false);
    await recordSent(env.DB, {
      sendDate: '2026-07-27',
      chatId: '100',
      url: 'https://x/a',
      messageId: 42,
      headline: 'Заголовок',
      coinedTerm: null,
      sentAt: '2026-07-27T08:00:00Z',
    });
    expect(await isUrlSent(env.DB, 'https://x/a')).toBe(true);
  });

  it('looks up a sent row by date or by (chatId, messageId)', async () => {
    await recordSent(env.DB, {
      sendDate: '2026-07-27',
      chatId: '100',
      url: 'https://x/a',
      messageId: 42,
      headline: 'Заголовок',
      coinedTerm: 'нановорот',
      sentAt: '2026-07-27T08:00:00Z',
    });
    expect(await getSentForDate(env.DB, '2026-07-27')).not.toBeNull();
    expect(await getSentForDate(env.DB, '2026-07-28')).toBeNull();
    expect((await getSentByChatAndMessageId(env.DB, '100', 42))?.sendDate).toBe('2026-07-27');
    expect(await getSentByChatAndMessageId(env.DB, '100', 999)).toBeNull();
    expect(await getSentByChatAndMessageId(env.DB, '200', 42)).toBeNull(); // different chat, same message_id
  });

  it('allows two recipients to each have their own row for the same day', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: '100', url: 'https://x/a', messageId: 1, headline: 'A', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: '200', url: 'https://x/a', messageId: 2, headline: 'A', coinedTerm: null, sentAt: '2026-07-27T08:00:01Z' });
    expect((await getSentByChatAndMessageId(env.DB, '100', 1))?.chatId).toBe('100');
    expect((await getSentByChatAndMessageId(env.DB, '200', 2))?.chatId).toBe('200');
  });

  it('returns sent rows within a date range for the digest', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-20', chatId: '100', url: 'https://x/1', messageId: 1, headline: 'A', coinedTerm: null, sentAt: '2026-07-20T08:00:00Z' });
    await recordSent(env.DB, { sendDate: '2026-07-26', chatId: '100', url: 'https://x/2', messageId: 2, headline: 'B', coinedTerm: null, sentAt: '2026-07-26T08:00:00Z' });
    const rows = await getSentBetween(env.DB, '2026-07-21', '2026-07-27');
    expect(rows.map((r) => r.sendDate)).toEqual(['2026-07-26']);
  });

  it('prunes seen rows older than a cutoff', async () => {
    await markSeen(env.DB, 'https://old', '2026-06-01T00:00:00Z');
    await markSeen(env.DB, 'https://new', '2026-07-25T00:00:00Z');
    await pruneSeenOlderThan(env.DB, '2026-07-01T00:00:00Z');
    expect(await getSeenRow(env.DB, 'https://old')).toBeNull();
    expect(await getSeenRow(env.DB, 'https://new')).not.toBeNull();
  });
});

describe('feedback', () => {
  it('upserts feedback so a changed mind replaces rather than duplicates', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: '100', url: 'https://x/a', messageId: 1, headline: 'A', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    await upsertFeedback(env.DB, '2026-07-27', '100', 'like', '2026-07-27T09:00:00Z');
    await upsertFeedback(env.DB, '2026-07-27', '100', 'dislike', '2026-07-27T10:00:00Z');
    const rows = await getFeedbackBetween(env.DB, '2026-07-01', '2026-07-31');
    expect(rows).toEqual([{ sendDate: '2026-07-27', chatId: '100', button: 'dislike' }]);
  });

  it('keeps each recipient\'s reaction independent for the same day', async () => {
    await upsertFeedback(env.DB, '2026-07-27', '100', 'like', '2026-07-27T09:00:00Z');
    await upsertFeedback(env.DB, '2026-07-27', '200', 'dislike', '2026-07-27T09:00:01Z');
    const rows = await getFeedbackBetween(env.DB, '2026-07-01', '2026-07-31');
    expect(rows).toEqual(
      expect.arrayContaining([
        { sendDate: '2026-07-27', chatId: '100', button: 'like' },
        { sendDate: '2026-07-27', chatId: '200', button: 'dislike' },
      ])
    );
  });
});

describe('backlog_used', () => {
  it('tracks which evergreen items have been used', async () => {
    expect(await isBacklogUsed(env.DB, 'perkin-mauve')).toBe(false);
    await markBacklogUsed(env.DB, 'perkin-mauve', '2026-07-27T08:00:00Z');
    expect(await isBacklogUsed(env.DB, 'perkin-mauve')).toBe(true);
  });
});
