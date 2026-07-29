import { Article, Env } from './types';
import { collect } from './collector';
import { edit } from './editor';
import { send } from './courier';
import { markExtraSent } from './db';
import { sendMessage } from './telegram';

// Collects the core tier and, only if that yields nothing the editor will take,
// the widening tier — returning one written Ukrainian article, or null. Shared
// by the daily scheduled send and the on-demand «Ще новини» button.
export async function selectArticle(env: Env, now: Date): Promise<Article | null> {
  const core = await collect(env.DB, 'core', now);
  let article = core.length > 0 ? await edit(core, env.GEMINI_API_KEY) : null;
  if (!article) {
    const widening = await collect(env.DB, 'widening', now);
    article = widening.length > 0 ? await edit(widening, env.GEMINI_API_KEY) : null;
  }
  return article;
}

// Handles a tap on «Ще новини»: picks a fresh, not-yet-sent article and sends it
// to the reader. Records the URL so neither the button nor the daily send will
// repeat it. When nothing new is available, tells the reader plainly.
export async function deliverOnDemandNews(env: Env, now: Date, chatId: string): Promise<'sent' | 'none'> {
  const article = await selectArticle(env, now);
  if (!article) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, {
      chatId,
      textHtml: 'Наразі немає нових новин — усе свіже вже надіслано. Спробуйте трохи згодом.',
      replyMarkup: { inline_keyboard: [] },
    });
    return 'none';
  }

  await send(env.TELEGRAM_BOT_TOKEN, chatId, article);
  await markExtraSent(env.DB, article.url, now.toISOString());
  return 'sent';
}
