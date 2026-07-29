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
    [{ text: '📰 Ще новини', callback_data: 'news' }],
    [{ text: '🔍 Дізнатися більше', callback_data: 'more' }],
  ],
};

// Shown to anyone who has not yet activated. The 'info' button is available
// to everyone — it reveals no personal data — so a brand-new visitor has
// something to press immediately, before they've typed the code word.
export const ONBOARDING_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [[{ text: 'ℹ️ Як це працює?', callback_data: 'info' }]],
};

// Shown to an already-activated recipient who presses /start again — a real
// action they can tap immediately, rather than a dead-end text reminder.
export const WELCOME_BACK_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [[{ text: '📰 Ще новини', callback_data: 'news' }]],
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
  // Passed straight to Telegram's link_preview_options. Defaults to disabled
  // (no preview). To show an article image, pass { url, show_above_text: true }.
  linkPreview?: Record<string, unknown>;
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
    link_preview_options: params.linkPreview ?? { is_disabled: true },
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

export interface BotCommand {
  command: string;
  description: string;
}

// Populates Telegram's built-in commands menu (the ☰ icon by the text box).
// A one-time setup call, like setWebhook — not called from request handling.
export async function setMyCommands(token: string, commands: BotCommand[]): Promise<void> {
  await fetch(apiUrl(token, 'setMyCommands'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
}

// Long description (up to 512 chars), shown in the empty chat above the
// Start button — the first thing anyone sees before pressing Start at all.
export async function setMyDescription(token: string, description: string): Promise<void> {
  await fetch(apiUrl(token, 'setMyDescription'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

// Short description (up to 120 chars), shown on the bot's profile page and in
// the preview card Telegram generates when a t.me/BotUsername link is shared.
export async function setMyShortDescription(token: string, shortDescription: string): Promise<void> {
  await fetch(apiUrl(token, 'setMyShortDescription'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ short_description: shortDescription }),
  });
}

export function isValidSecretToken(request: Request, expected: string): boolean {
  return request.headers.get('X-Telegram-Bot-Api-Secret-Token') === expected;
}
