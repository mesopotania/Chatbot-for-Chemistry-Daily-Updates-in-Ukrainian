import { FeedbackButton, getSentByMessageId, upsertFeedback } from './db';
import { answerCallbackQuery, isValidSecretToken } from './telegram';

interface TelegramUpdate {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number };
  };
}

export const TOAST_TEXT: Record<FeedbackButton, string> = {
  like: 'Дякую!',
  dislike: 'Зрозуміло, врахую.',
  more: 'Дякую! Автору передано — очікуйте більше про цю тему.',
};

function isFeedbackButton(value: string | undefined): value is FeedbackButton {
  return value === 'like' || value === 'dislike' || value === 'more';
}

export async function handleWebhook(
  request: Request,
  db: D1Database,
  botToken: string,
  webhookSecret: string
): Promise<Response> {
  if (!isValidSecretToken(request, webhookSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const callback = update.callback_query;
  if (!callback || !isFeedbackButton(callback.data)) {
    return new Response('ok');
  }

  const messageId = callback.message?.message_id;
  if (messageId !== undefined) {
    const sentRow = await getSentByMessageId(db, messageId);
    if (sentRow) {
      await upsertFeedback(db, sentRow.sendDate, callback.data, new Date().toISOString());
    }
  }

  await answerCallbackQuery(botToken, callback.id, TOAST_TEXT[callback.data]);
  return new Response('ok');
}
