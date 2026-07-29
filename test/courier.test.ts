import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { send } from '../src/courier';
import * as telegram from '../src/telegram';
import { Article } from '../src/types';

const articleWithImage: Article = {
  headline: 'Заголовок',
  paragraphs: ['Абзац один.', 'Абзац два.'],
  whyMatters: 'Це важливо.',
  coinedTerm: null,
  url: 'https://x/a',
  sourceName: 'Chemistry World',
  imageUrl: 'https://img/a.jpg',
};

const articleWithoutImage: Article = { ...articleWithImage, imageUrl: null };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('send', () => {
  it('sends one message with the image as an above-text preview when present', async () => {
    let captured: telegram.SendMessageParams | undefined;
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage').mockImplementationOnce(async (_t, p) => {
      captured = p;
      return { ok: true, messageId: 5 };
    });

    const messageId = await send('tok', '1', articleWithImage);

    expect(messageId).toBe(5);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(captured?.linkPreview).toEqual({ url: 'https://img/a.jpg', show_above_text: true, prefer_large_media: true });
  });

  it('disables the preview when there is no image', async () => {
    let captured: telegram.SendMessageParams | undefined;
    vi.spyOn(telegram, 'sendMessage').mockImplementationOnce(async (_t, p) => {
      captured = p;
      return { ok: true, messageId: 6 };
    });

    const messageId = await send('tok', '1', articleWithoutImage);

    expect(messageId).toBe(6);
    expect(captured?.linkPreview).toEqual({ is_disabled: true });
  });

  it('retries sendMessage with backoff and succeeds on the third attempt', async () => {
    const spy = vi
      .spyOn(telegram, 'sendMessage')
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, messageId: 8 });

    const promise = send('tok', '1', articleWithoutImage);
    await vi.runAllTimersAsync();
    const messageId = await promise;

    expect(messageId).toBe(8);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all 5 attempts', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: false });

    const promise = send('tok', '1', articleWithoutImage);
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('sends with the full reader keyboard: like/dislike, «Ще новини», and «Дізнатися більше»', async () => {
    let capturedMarkup: unknown;
    vi.spyOn(telegram, 'sendMessage').mockImplementationOnce(async (_token, params) => {
      capturedMarkup = params.replyMarkup;
      return { ok: true, messageId: 9 };
    });

    await send('tok', '1', articleWithImage);

    expect(capturedMarkup).toEqual({
      inline_keyboard: [
        [
          { text: '❤️ Подобається', callback_data: 'like' },
          { text: '👎 Не цікаво', callback_data: 'dislike' },
        ],
        [{ text: '📰 Ще новини', callback_data: 'news' }],
        [{ text: '🔍 Дізнатися більше', callback_data: 'more' }],
      ],
    });
  });
});
