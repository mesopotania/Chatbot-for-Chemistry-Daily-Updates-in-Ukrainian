import { Article } from './types';
import { renderCaptionHtml } from './caption';
import { sendMessage, READER_KEYBOARD } from './telegram';

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

  // Always a single text message so the full article is never truncated. When
  // there is an image, show it as a large preview above the text (Telegram
  // fetches it; if it can't, the text still sends). The preview url is set
  // explicitly to the image, so the article link never previews an English page.
  const linkPreview = article.imageUrl
    ? { url: article.imageUrl, show_above_text: true, prefer_large_media: true }
    : { is_disabled: true };

  const result = await withRetries(async () => {
    const r = await sendMessage(token, { chatId, textHtml: captionHtml, replyMarkup: READER_KEYBOARD, linkPreview });
    if (!r.ok || !r.messageId) throw new Error('sendMessage returned not-ok');
    return r;
  }, 5);

  return result.messageId!;
}
