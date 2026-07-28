import { Env } from './types';
import { validateConfig, ConfigError } from './config';
import { shouldRunPipeline, isDigestTick } from './scheduling';
import { collect } from './collector';
import { edit } from './editor';
import { send } from './courier';
import { handleWebhook } from './feedback';
import { sendWeeklyDigest } from './digest';
import { recordSent, pruneSeenOlderThan } from './db';
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
  let article = null;
  let sentUrl: string | null = null;

  const coreCandidates = await collect(env.DB, 'core', now);
  if (coreCandidates.length > 0) {
    article = await edit(coreCandidates, env.GEMINI_API_KEY);
  }

  if (!article) {
    const wideningCandidates = await collect(env.DB, 'widening', now);
    if (wideningCandidates.length > 0) {
      article = await edit(wideningCandidates, env.GEMINI_API_KEY);
    }
  }

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

  let messageId: number;
  try {
    messageId = await send(env.TELEGRAM_BOT_TOKEN, env.READER_CHAT_ID, article);
  } catch (err) {
    await alertAuthor(env, `ALERT: Telegram send failed for ${sendDate}: ${(err as Error).message}`);
    return;
  }

  await recordSent(env.DB, {
    sendDate,
    url: sentUrl,
    messageId,
    headline: article.headline,
    coinedTerm: article.coinedTerm,
    sentAt: now.toISOString(),
  });
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
      ctx.waitUntil(runDailyPipeline(env, sendDate, now));
    }

    if (isDigestTick(env.TIMEZONE, now)) {
      ctx.waitUntil(sendWeeklyDigest(env.DB, env.TELEGRAM_BOT_TOKEN, env.AUTHOR_CHAT_ID, now));
    }

    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      ctx.waitUntil(pruneSeenOlderThan(env.DB, cutoff));
    }
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env.DB, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET);
    }
    return new Response('ok');
  },
};
