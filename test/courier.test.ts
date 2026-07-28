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
  it('sends exactly one sendPhoto call when an image is present', async () => {
    const sendPhotoSpy = vi.spyOn(telegram, 'sendPhoto').mockResolvedValueOnce({ ok: true, messageId: 5 });
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage');

    const messageId = await send('tok', '1', articleWithImage);

    expect(messageId).toBe(5);
    expect(sendPhotoSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('sends via sendMessage, with previews disabled, when there is no image', async () => {
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 6 });

    const messageId = await send('tok', '1', articleWithoutImage);

    expect(messageId).toBe(6);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to sendMessage when sendPhoto fails', async () => {
    vi.spyOn(telegram, 'sendPhoto').mockResolvedValueOnce({ ok: false });
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 7 });

    const messageId = await send('tok', '1', articleWithImage);

    expect(messageId).toBe(7);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
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

  it('renders a caption under the Telegram hard cap with all three buttons on two rows', async () => {
    let capturedMarkup: unknown;
    vi.spyOn(telegram, 'sendPhoto').mockImplementationOnce(async (_token, params) => {
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
        [{ text: '🔍 Дізнатися більше', callback_data: 'more' }],
      ],
    });
  });
});
