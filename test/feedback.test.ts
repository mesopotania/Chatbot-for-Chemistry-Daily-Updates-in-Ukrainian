import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { handleWebhook, TOAST_TEXT, NEWS_TOAST, ACTIVATED_TEXT, ALREADY_ACTIVATED_TEXT, ONBOARDING_TEXT, INFO_TEXT, STOPPED_TEXT } from '../src/feedback';
import { ONBOARDING_KEYBOARD, WELCOME_BACK_KEYBOARD } from '../src/telegram';
import { recordSent, getFeedbackBetween, addRecipient, isRecipient } from '../src/db';
import { isUkrainianOnly } from '../src/validation';
import * as telegram from '../src/telegram';
import * as gemini from '../src/gemini';

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await applySchema(env.DB);
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const READER_ID = 100;
const AUTHOR_ID = '999';
const CODE_WORD = 'молекула';
const noopDeliver = () => {};

function webhookRequest(body: unknown, secret = 'shh'): Request {
  return new Request('https://worker.example/webhook', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown, deliver: (chatId: string) => Promise<unknown> | void = noopDeliver) {
  return handleWebhook(webhookRequest(body), env.DB, 'tok', 'shh', AUTHOR_ID, CODE_WORD, 'gemini-key', deliver);
}

describe('handleWebhook — activation', () => {
  it('registers a chat that sends the exact code word, confirms in Ukrainian, and immediately delivers a real article', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const deliver = vi.fn();

    const res = await call({ message: { text: CODE_WORD, chat: { id: 100, first_name: 'Бабуся' } } }, deliver);

    expect(res.status).toBe(200);
    expect(await isRecipient(env.DB, '100')).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: ACTIVATED_TEXT }));
    expect(deliver).toHaveBeenCalledWith('100'); // first article, not just a text welcome
  });

  it('matches case-insensitively and trims whitespace', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    await call({ message: { text: `  ${CODE_WORD.toUpperCase()}  `, chat: { id: 100 } } });
    expect(await isRecipient(env.DB, '100')).toBe(true);
  });

  it('supports the /start deep-link form (t.me/bot?start=CODEWORD)', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    await call({ message: { text: `/start ${CODE_WORD}`, chat: { id: 100 } } });
    expect(await isRecipient(env.DB, '100')).toBe(true);
  });

  it('tells an already-registered chat it is already subscribed, without duplicating', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });

    await call({ message: { text: CODE_WORD, chat: { id: 100 } } });

    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: ALREADY_ACTIVATED_TEXT }));
  });

  it('notifies the author when someone new activates', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    await call({ message: { text: CODE_WORD, chat: { id: 100, first_name: 'Друг' } } });
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: AUTHOR_ID }));
  });

  it('prompts an unregistered chat for the code word with the info button, and registers nobody', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const res = await call({ message: { text: 'hello there', chat: { id: 100 } } });
    expect(res.status).toBe(200);
    expect(await isRecipient(env.DB, '100')).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ chatId: '100', textHtml: ONBOARDING_TEXT, replyMarkup: ONBOARDING_KEYBOARD })
    );
    expect(ONBOARDING_TEXT).not.toContain(CODE_WORD);
  });

  it('prompts for the code word on a bare /start with no payload — the bug where sharing the plain link produced silence', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const res = await call({ message: { text: '/start', chat: { id: 100 } } });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: ONBOARDING_TEXT }));
  });
});

describe('handleWebhook — /info and /help commands', () => {
  it.each(['/info', '/help', '/Info', '/help@ChemistryDaily_bot'])('%s answers with INFO_TEXT for an unregistered chat', async (cmd) => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const res = await call({ message: { text: cmd, chat: { id: 100 } } });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: INFO_TEXT }));
    expect(await isRecipient(env.DB, '100')).toBe(false); // does not activate
  });

  it('/info also works for an already-registered recipient', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    await call({ message: { text: '/info', chat: { id: 100 } } });
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: INFO_TEXT }));
  });
});

describe('handleWebhook — info button', () => {
  it('answers the ℹ️ button even for a chat that has never activated, revealing no protected data', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValueOnce();

    const res = await call({ callback_query: { id: 'cbq-info', data: 'info', from: { id: 424242 } } });

    expect(res.status).toBe(200);
    expect(answerSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '424242', textHtml: INFO_TEXT }));
    expect(await isRecipient(env.DB, '424242')).toBe(false); // pressing info does not activate
  });
});

describe('handleWebhook — /news command (manual trigger)', () => {
  it('triggers on-demand delivery for a registered recipient, same as the 📰 button', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const deliver = vi.fn();

    const res = await call({ message: { text: '/news', chat: { id: 100 } } }, deliver);

    expect(res.status).toBe(200);
    expect(deliver).toHaveBeenCalledWith('100');
  });

  it('works for the author too', async () => {
    const deliver = vi.fn();
    await call({ message: { text: '/news', chat: { id: Number(AUTHOR_ID) } } }, deliver);
    expect(deliver).toHaveBeenCalledWith(AUTHOR_ID);
  });

  it('does not deliver anything for an unregistered chat, and prompts for the code word instead', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const deliver = vi.fn();

    await call({ message: { text: '/news', chat: { id: 100 } } }, deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: ONBOARDING_TEXT }));
  });
});

describe('handleWebhook — /stop command (unsubscribe) and restarting', () => {
  it('removes a registered recipient and confirms in Ukrainian', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });

    const res = await call({ message: { text: '/stop', chat: { id: 100 } } });

    expect(res.status).toBe(200);
    expect(await isRecipient(env.DB, '100')).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: STOPPED_TEXT }));
  });

  it('notifies the author when someone stops', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    await call({ message: { text: '/stop', chat: { id: 100, first_name: 'Друг' } } });
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: AUTHOR_ID }));
  });

  it('sending the code word again after /stop re-activates and delivers a fresh article', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    const deliver = vi.fn();

    await call({ message: { text: '/stop', chat: { id: 100 } } }, deliver);
    expect(await isRecipient(env.DB, '100')).toBe(false);

    await call({ message: { text: CODE_WORD, chat: { id: 100 } } }, deliver);
    expect(await isRecipient(env.DB, '100')).toBe(true);
    expect(deliver).toHaveBeenCalledWith('100');
  });

  it('is a no-op (falls through to onboarding) for an unregistered chat', async () => {
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });
    await call({ message: { text: '/stop', chat: { id: 100 } } });
    expect(await isRecipient(env.DB, '100')).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith('tok', expect.objectContaining({ chatId: '100', textHtml: ONBOARDING_TEXT }));
  });
});

describe('handleWebhook — messages from already-activated recipients', () => {
  it('tells an already-registered chat it is already subscribed on a bare /start, with a real 📰 button to press', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });

    await call({ message: { text: '/start', chat: { id: 100 } } });

    expect(sendSpy).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ chatId: '100', textHtml: ALREADY_ACTIVATED_TEXT, replyMarkup: WELCOME_BACK_KEYBOARD })
    );
  });

  it('answers a free-form question from a registered recipient using Gemini, formatted with bold + subscripts', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    const genSpy = vi.spyOn(gemini, 'generateJson').mockResolvedValueOnce({
      kind: 'ok',
      data: { answer: '**CO2** розчиняється у воді, утворюючи H2CO3.' },
    });
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });

    const res = await call({ message: { text: 'Чому CO2 розчиняється у воді?', chat: { id: 100 } } });

    expect(res.status).toBe(200);
    expect(genSpy).toHaveBeenCalledTimes(1);
    const [, params] = sendSpy.mock.calls[0];
    expect(params.chatId).toBe('100');
    expect(params.textHtml).toContain('<b>CO₂</b>'); // bold + subscript applied
    expect(params.textHtml).toContain('H₂CO₃');
  });

  it('answers with a Ukrainian apology, never silence, when the Gemini call fails', async () => {
    await addRecipient(env.DB, '100', null, '2026-07-01T00:00:00Z');
    vi.spyOn(gemini, 'generateJson').mockResolvedValueOnce({ kind: 'quota_exceeded' });
    const sendSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: true, messageId: 1 });

    const res = await call({ message: { text: 'Питання про хімію', chat: { id: 100 } } });

    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, params] = sendSpy.mock.calls[0];
    expect(isUkrainianOnly(params.textHtml)).toBe(true);
  });
});

describe('handleWebhook — buttons', () => {
  it.each(['like', 'dislike', 'more'] as const)('records a %s tap from a registered recipient', async (button) => {
    await addRecipient(env.DB, String(READER_ID), null, '2026-07-01T00:00:00Z');
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: String(READER_ID), url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValueOnce();

    const res = await call({ callback_query: { id: 'cbq-1', data: button, from: { id: READER_ID }, message: { message_id: 42 } } });

    expect(res.status).toBe(200);
    const rows = await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01');
    expect(rows).toEqual([{ sendDate: '2026-07-27', chatId: String(READER_ID), button }]);
    expect(answerSpy).toHaveBeenCalledWith('tok', 'cbq-1', TOAST_TEXT[button]);
  });

  it('replaces rather than duplicates on a second, different tap for the same article', async () => {
    await addRecipient(env.DB, String(READER_ID), null, '2026-07-01T00:00:00Z');
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: String(READER_ID), url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValue();

    await call({ callback_query: { id: 'cbq-1', data: 'like', from: { id: READER_ID }, message: { message_id: 42 } } });
    await call({ callback_query: { id: 'cbq-2', data: 'dislike', from: { id: READER_ID }, message: { message_id: 42 } } });

    const rows = await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01');
    expect(rows).toEqual([{ sendDate: '2026-07-27', chatId: String(READER_ID), button: 'dislike' }]);
  });

  it('on «Ще новини» triggers delivery to the tapper and toasts immediately', async () => {
    await addRecipient(env.DB, String(READER_ID), null, '2026-07-01T00:00:00Z');
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValueOnce();
    const deliver = vi.fn();

    const res = await call({ callback_query: { id: 'cbq-n', data: 'news', from: { id: READER_ID } } }, deliver);

    expect(res.status).toBe(200);
    expect(deliver).toHaveBeenCalledWith(String(READER_ID));
    expect(answerSpy).toHaveBeenCalledWith('tok', 'cbq-n', NEWS_TOAST);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('the author (not just recipients) can also use buttons', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: AUTHOR_ID, url: 'https://x/a', messageId: 7, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValueOnce();

    const res = await call({ callback_query: { id: 'cbq-a', data: 'like', from: { id: Number(AUTHOR_ID) }, message: { message_id: 7 } } });

    expect(res.status).toBe(200);
    expect(answerSpy).toHaveBeenCalledWith('tok', 'cbq-a', TOAST_TEXT.like);
  });

  it('ignores a tap from a chat id that is neither a recipient nor the author (private bot)', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', chatId: String(READER_ID), url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValue();

    const res = await call({ callback_query: { id: 'cbq-x', data: 'like', from: { id: 999999 }, message: { message_id: 42 } } });

    expect(res.status).toBe(200);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
    expect(answerSpy).not.toHaveBeenCalled();
  });

  it('rejects a request with a wrong or missing secret token and writes nothing', async () => {
    const res = await handleWebhook(webhookRequest({}, 'wrong'), env.DB, 'tok', 'shh', AUTHOR_ID, CODE_WORD, 'gemini-key', noopDeliver);
    expect(res.status).toBe(401);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('acknowledges an update that is not a recognized feedback tap without writing anything', async () => {
    await addRecipient(env.DB, String(READER_ID), null, '2026-07-01T00:00:00Z');
    const res = await call({ callback_query: { id: 'cbq-z', data: 'bogus', from: { id: READER_ID } } });
    expect(res.status).toBe(200);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('every toast and activation message is Ukrainian only, aside from literal Telegram command names', () => {
    // /news, /stop, /start etc. are Telegram commands — they must stay Latin
    // (platform requirement), unlike everything else in these strings, which
    // is genuine prose the Ukrainian-only rule is meant to police.
    const stripCommandNames = (s: string) => s.replace(/\/(news|stop|start|info|help)\b/gi, '');
    for (const text of [...Object.values(TOAST_TEXT), NEWS_TOAST, ACTIVATED_TEXT, ALREADY_ACTIVATED_TEXT, ONBOARDING_TEXT, INFO_TEXT, STOPPED_TEXT]) {
      expect(isUkrainianOnly(stripCommandNames(text))).toBe(true);
    }
  });
});
