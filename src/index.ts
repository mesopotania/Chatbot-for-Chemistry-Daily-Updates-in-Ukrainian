import { Env } from './types';
import { validateConfig, ConfigError } from './config';
import { shouldRunPipeline, isDigestTick } from './scheduling';
import { selectArticle, deliverOnDemandNews } from './pipeline';
import { send } from './courier';
import { handleWebhook } from './feedback';
import { sendWeeklyDigest } from './digest';
import { recordSent, pruneSeenOlderThan, getRecipientChatIds } from './db';
import { pickBacklogItem } from './backlog';
import { sendMessage } from './telegram';

async function alertAuthor(env: Env, message: string): Promise<void> {
  await sendMessage(env.TELEGRAM_BOT_TOKEN, {
    chatId: env.AUTHOR_CHAT_ID,
    textHtml: message,
    replyMarkup: { inline_keyboard: [] },
  });
}

async function runDailyPipeline(env: Env, sendDate: string, now: Date): Promise<void> {
  const recipients = await getRecipientChatIds(env.DB);
  if (recipients.length === 0) return; // nobody has activated yet — nothing to send

  let article = await selectArticle(env, now);
  let sentUrl: string | null = null;

  if (article) {
    sentUrl = article.url;
  } else {
    const backlogPick = await pickBacklogItem(env.DB, now);
    if (backlogPick) {
      article = backlogPick.article;
      sentUrl = `backlog:${backlogPick.slug}`;
    }
  }

  if (!article || !sentUrl) {
    await alertAuthor(env, `ALERT: no article could be produced for ${sendDate} (feeds, widening, and backlog all failed)`);
    return;
  }

  // Same article to every recipient; one recipient's send failure does not
  // block the others — each gets its own attempt and its own alert on failure.
  for (const chatId of recipients) {
    try {
      const messageId = await send(env.TELEGRAM_BOT_TOKEN, chatId, article);
      await recordSent(env.DB, {
        sendDate,
        chatId,
        url: sentUrl,
        messageId,
        headline: article.headline,
        coinedTerm: article.coinedTerm,
        sentAt: now.toISOString(),
      });
    } catch (err) {
      await alertAuthor(env, `ALERT: Telegram send failed for ${chatId} on ${sendDate}: ${(err as Error).message}`);
    }
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      validateConfig(env);
    } catch (err) {
      if (env.TELEGRAM_BOT_TOKEN && env.AUTHOR_CHAT_ID) {
        await alertAuthor(env, `ALERT: configuration error: ${(err as ConfigError).message}`);
      }
      return;
    }

    const now = new Date(event.scheduledTime);

    const { run, sendDate } = await shouldRunPipeline(env.DB, env.TIMEZONE, Number(env.SEND_HOUR), now);
    if (run) {
      // Await (not waitUntil): a cron invocation gets generous time, and the
      // daily send must actually complete, not be cancelled as a background task.
      await runDailyPipeline(env, sendDate, now);
    }

    if (isDigestTick(env.TIMEZONE, now)) {
      ctx.waitUntil(sendWeeklyDigest(env.DB, env.TELEGRAM_BOT_TOKEN, env.AUTHOR_CHAT_ID, now));
    }

    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      ctx.waitUntil(pruneSeenOlderThan(env.DB, cutoff));
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/webhook' && request.method === 'POST') {
      // Awaited inside handleWebhook — free-plan Workers cancel long waitUntil tasks.
      const deliverMoreNews = (chatId: string) => deliverOnDemandNews(env, new Date(), chatId);
      return handleWebhook(
        request,
        env.DB,
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_WEBHOOK_SECRET,
        env.AUTHOR_CHAT_ID,
        env.ACTIVATION_CODE_WORD,
        env.GEMINI_API_KEY,
        deliverMoreNews
      );
    }
    return new Response('ok');
  },
};
