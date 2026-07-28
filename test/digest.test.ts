import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { sendWeeklyDigest } from '../src/digest';
import { recordSent, upsertFeedback } from '../src/db';
import * as telegram from '../src/telegram';

beforeEach(async () => {
  await applySchema(env.DB);
  vi.restoreAllMocks();
});

describe('sendWeeklyDigest', () => {
  it('sends the author a summary of the past week, including coined terms and taps', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-21', url: 'https://x/1', messageId: 1, headline: 'Заголовок 1', coinedTerm: 'нанопора', sentAt: '2026-07-21T08:00:00Z' });
    await recordSent(env.DB, { sendDate: '2026-07-25', url: 'https://x/2', messageId: 2, headline: 'Заголовок 2', coinedTerm: null, sentAt: '2026-07-25T08:00:00Z' });
    await upsertFeedback(env.DB, '2026-07-25', 'like', '2026-07-25T09:00:00Z');

    const spy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 99 });

    await sendWeeklyDigest(env.DB, 'tok', 'author-chat', new Date('2026-07-26T17:00:00Z'));

    expect(spy).toHaveBeenCalledTimes(1);
    const [, params] = spy.mock.calls[0];
    expect(params.chatId).toBe('author-chat');
    expect(params.textHtml).toContain('Заголовок 1');
    expect(params.textHtml).toContain('нанопора');
    expect(params.textHtml).toContain('Заголовок 2');
  });

  it('sends nothing but an empty-week message when there is no sent history', async () => {
    const spy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 100 });
    await sendWeeklyDigest(env.DB, 'tok', 'author-chat', new Date('2026-07-26T17:00:00Z'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
