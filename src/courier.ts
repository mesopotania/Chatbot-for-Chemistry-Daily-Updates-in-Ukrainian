import { Article } from './types';
import { renderCaptionHtml } from './caption';
import { sendPhoto, sendMessage, READER_KEYBOARD } from './telegram';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(2 ** i * 500);
    }
  }
  throw lastError;
}

export async function send(token: string, chatId: string, article: Article): Promise<number> {
  const captionHtml = renderCaptionHtml(article);

  if (article.imageUrl) {
    const result = await sendPhoto(token, {
      chatId,
      photoUrl: article.imageUrl,
      captionHtml,
      replyMarkup: READER_KEYBOARD,
    });
    if (result.ok && result.messageId) return result.messageId;
  }

  const result = await withRetries(async () => {
    const r = await sendMessage(token, { chatId, textHtml: captionHtml, replyMarkup: READER_KEYBOARD });
    if (!r.ok || !r.messageId) throw new Error('sendMessage returned not-ok');
    return r;
  }, 5);

  return result.messageId!;
}
