const TELEGRAM_API = 'https://api.telegram.org';

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export const READER_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [
    [
      { text: '❤️ Подобається', callback_data: 'like' },
      { text: '👎 Не цікаво', callback_data: 'dislike' },
    ],
    [{ text: '🔍 Дізнатися більше', callback_data: 'more' }],
  ],
};

export interface SendPhotoParams {
  chatId: string;
  photoUrl: string;
  captionHtml: string;
  replyMarkup: InlineKeyboard;
}

export interface SendMessageParams {
  chatId: string;
  textHtml: string;
  replyMarkup: InlineKeyboard;
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
}

function apiUrl(token: string, method: string): string {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

async function postJson(
  token: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; result?: { message_id: number } }> {
  const res = await fetch(apiUrl(token, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as { ok: boolean; result?: { message_id: number } };
}

export async function sendPhoto(token: string, params: SendPhotoParams): Promise<SendResult> {
  const body = await postJson(token, 'sendPhoto', {
    chat_id: params.chatId,
    photo: params.photoUrl,
    caption: params.captionHtml,
    parse_mode: 'HTML',
    reply_markup: params.replyMarkup,
  });
  return { ok: body.ok, messageId: body.result?.message_id };
}

export async function sendMessage(token: string, params: SendMessageParams): Promise<SendResult> {
  const body = await postJson(token, 'sendMessage', {
    chat_id: params.chatId,
    text: params.textHtml,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: params.replyMarkup,
  });
  return { ok: body.ok, messageId: body.result?.message_id };
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, text: string): Promise<void> {
  await fetch(apiUrl(token, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await fetch(apiUrl(token, 'setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
}

export function isValidSecretToken(request: Request, expected: string): boolean {
  return request.headers.get('X-Telegram-Bot-Api-Secret-Token') === expected;
}
