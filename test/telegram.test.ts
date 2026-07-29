import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendPhoto,
  sendMessage,
  answerCallbackQuery,
  setWebhook,
  isValidSecretToken,
  READER_KEYBOARD,
} from '../src/telegram';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('sendPhoto', () => {
  it('posts photo, caption, HTML parse mode, and the reader keyboard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true, result: { message_id: 7 } }));

    const result = await sendPhoto('tok', {
      chatId: '1',
      photoUrl: 'https://img/x.jpg',
      captionHtml: '<b>Заголовок</b>',
      replyMarkup: READER_KEYBOARD,
    });

    expect(result).toEqual({ ok: true, messageId: 7 });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottok/sendPhoto');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.parse_mode).toBe('HTML');
    expect(body.reply_markup.inline_keyboard).toHaveLength(3);
  });
});

describe('sendMessage', () => {
  it('always disables link previews', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true, result: { message_id: 8 } }));

    await sendMessage('tok', { chatId: '1', textHtml: 'text', replyMarkup: READER_KEYBOARD });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.link_preview_options).toEqual({ is_disabled: true });
  });
});

describe('answerCallbackQuery', () => {
  it('posts the callback id and toast text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await answerCallbackQuery('tok', 'cbq-1', 'Дякую!');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ callback_query_id: 'cbq-1', text: 'Дякую!' });
  });
});

describe('setWebhook', () => {
  it('posts the webhook URL and secret token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await setWebhook('tok', 'https://worker.example/webhook', 'shh');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ url: 'https://worker.example/webhook', secret_token: 'shh' });
  });
});

describe('isValidSecretToken', () => {
  it('accepts a matching header and rejects a missing or wrong one', () => {
    const good = new Request('https://x/', { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'shh' } });
    const bad = new Request('https://x/', { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' } });
    const missing = new Request('https://x/');
    expect(isValidSecretToken(good, 'shh')).toBe(true);
    expect(isValidSecretToken(bad, 'shh')).toBe(false);
    expect(isValidSecretToken(missing, 'shh')).toBe(false);
  });
});
