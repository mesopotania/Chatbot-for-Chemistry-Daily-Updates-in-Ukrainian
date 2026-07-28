import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { handleWebhook, TOAST_TEXT } from '../src/feedback';
import { recordSent, getFeedbackBetween } from '../src/db';
import { isUkrainianOnly } from '../src/validation';
import * as telegram from '../src/telegram';

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await applySchema(env.DB);
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function webhookRequest(body: unknown, secret = 'shh'): Request {
  return new Request('https://worker.example/webhook', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleWebhook', () => {
  it('rejects a request with a wrong or missing secret token and writes nothing', async () => {
    const res = await handleWebhook(webhookRequest({}, 'wrong'), env.DB, 'tok', 'shh');
    expect(res.status).toBe(401);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it.each(['like', 'dislike', 'more'] as const)('records a %s tap against the sent article', async (button) => {
    await recordSent(env.DB, { sendDate: '2026-07-27', url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValueOnce();

    const res = await handleWebhook(
      webhookRequest({ callback_query: { id: 'cbq-1', data: button, message: { message_id: 42 } } }),
      env.DB,
      'tok',
      'shh'
    );

    expect(res.status).toBe(200);
    const rows = await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01');
    expect(rows).toEqual([{ sendDate: '2026-07-27', button }]);
    expect(answerSpy).toHaveBeenCalledWith('tok', 'cbq-1', TOAST_TEXT[button]);
  });

  it('replaces rather than duplicates on a second, different tap for the same article', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValue();

    await handleWebhook(webhookRequest({ callback_query: { id: 'cbq-1', data: 'like', message: { message_id: 42 } } }), env.DB, 'tok', 'shh');
    await handleWebhook(webhookRequest({ callback_query: { id: 'cbq-2', data: 'dislike', message: { message_id: 42 } } }), env.DB, 'tok', 'shh');

    const rows = await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01');
    expect(rows).toEqual([{ sendDate: '2026-07-27', button: 'dislike' }]);
  });

  it('acknowledges an update that is not a recognized feedback tap without writing anything', async () => {
    const res = await handleWebhook(webhookRequest({ message: { text: 'hello' } }), env.DB, 'tok', 'shh');
    expect(res.status).toBe(200);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('every toast is Ukrainian only', () => {
    for (const text of Object.values(TOAST_TEXT)) {
      expect(isUkrainianOnly(text)).toBe(true);
    }
  });
});
