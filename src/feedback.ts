import { FeedbackButton, getSentByChatAndMessageId, upsertFeedback, addRecipient, isRecipient, removeRecipient } from './db';
import { answerCallbackQuery, isValidSecretToken, sendMessage, ONBOARDING_KEYBOARD, WELCOME_BACK_KEYBOARD } from './telegram';
import { answerQuestion } from './qa';

interface TelegramUpdate {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number };
    message?: { message_id: number };
  };
  message?: {
    text?: string;
    chat: { id: number; first_name?: string };
  };
}

export const TOAST_TEXT: Record<FeedbackButton, string> = {
  like: 'Дякую!',
  dislike: 'Зрозуміло, врахую.',
  more: 'Дякую! Автору передано — очікуйте більше про цю тему.',
};

export const NEWS_TOAST = 'Готую нову новину…';
export const ALREADY_ACTIVATED_TEXT =
  'Ви вже активовані й отримуєте щоденні хімічні новини. 📰 Натисніть кнопку нижче, щоб отримати новину просто зараз, або просто напишіть мені будь-яке питання про хімію — і я відповім.';
export const ACTIVATED_TEXT =
  'Вітаємо! 🧪 Тепер ви щодня о 9:00 отримуватимете новину хімії українською — з поясненнями та формулами. Ось перша новина просто зараз 👇';
export const ONBOARDING_TEXT =
  '👋 Вітаю! Я — бот «Хімія щодня», щодня надсилаю одну цікаву новину зі світу хімії українською мовою.\n\nЩоб почати отримувати новини, надішліть мені кодове слово, яке вам дав організатор.';
export const INFO_TEXT =
  '🧪 «Хімія щодня» — щоденний дайджест новин хімії українською мовою, безкоштовно і приватно.\n\nЩодня о 9:00 я обираю одну цікаву новину зі світу хімії та пишу її українською — з поясненнями, формулами (H₂O, CO₂) та ключовими термінами.\n\nПісля активації буде доступно:\n❤️ Подобається / 👎 Не цікаво — оцінити новину\n📰 Ще новини або команда /news — отримати ще одну новину просто зараз\n🔍 Дізнатися більше — розширена версія новини\n💬 Будь-яке питання про хімію — просто напишіть його мені\n🛑 /stop — припинити отримання новин (можна відновити кодовим словом)\n\nЩоб активуватися, надішліть кодове слово, яке вам дав організатор.';
export const STOPPED_TEXT =
  'Гаразд, ви більше не отримуватимете щоденні новини. 🛑 Якщо захочете відновити, просто надішліть кодове слово ще раз.';

function isFeedbackButton(value: string | undefined): value is FeedbackButton {
  return value === 'like' || value === 'dislike' || value === 'more';
}

// Matches both a manually typed code word and Telegram's "/start <payload>"
// deep-link form (t.me/BotName?start=CODEWORD sends "/start CODEWORD").
function matchesCodeWord(text: string, codeWord: string): boolean {
  const stripped = text.replace(/^\/start\s*/i, '').trim();
  return stripped.length > 0 && stripped.toLowerCase() === codeWord.trim().toLowerCase();
}

// deliverMoreNews runs the on-demand pipeline. It is awaited within the request
// (Workers cancels long background/waitUntil tasks on the free plan), after the
// button is acknowledged so the reader sees the toast right away.
export async function handleWebhook(
  request: Request,
  db: D1Database,
  botToken: string,
  webhookSecret: string,
  authorChatId: string,
  codeWord: string,
  geminiApiKey: string,
  deliverMoreNews: (chatId: string) => Promise<unknown> | void
): Promise<Response> {
  if (!isValidSecretToken(request, webhookSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.message) {
    const chatId = String(update.message.chat.id);
    const text = (update.message.text ?? '').trim();

    // Activation: a plain text message, or a Start deep-link that carried the
    // code word as its payload, registers this chat as a daily recipient.
    if (matchesCodeWord(text, codeWord)) {
      const alreadyIn = await isRecipient(db, chatId);
      if (!alreadyIn) {
        await addRecipient(db, chatId, update.message.chat.first_name ?? null, new Date().toISOString());
        await sendMessage(botToken, { chatId, textHtml: ACTIVATED_TEXT, replyMarkup: { inline_keyboard: [] } });
        // Give them real content immediately, with the full button set (including
        // 📰 Ще новини) — not just a text welcome that waits until tomorrow's 9am.
        await deliverMoreNews(chatId);
        if (chatId !== authorChatId) {
          const who = update.message.chat.first_name ? ` (${update.message.chat.first_name})` : '';
          await sendMessage(botToken, {
            chatId: authorChatId,
            textHtml: `New recipient activated${who}: chat_id ${chatId}`,
            replyMarkup: { inline_keyboard: [] },
          });
        }
      } else {
        await sendMessage(botToken, { chatId, textHtml: ALREADY_ACTIVATED_TEXT, replyMarkup: WELCOME_BACK_KEYBOARD });
      }
      return new Response('ok');
    }

    // /info and /help (from the bot's commands menu, or typed directly) work
    // for anyone, registered or not — same content as the ℹ️ button.
    if (/^\/(info|help)\b/i.test(text)) {
      await sendMessage(botToken, { chatId, textHtml: INFO_TEXT, replyMarkup: { inline_keyboard: [] } });
      return new Response('ok');
    }

    const known = chatId === authorChatId || (await isRecipient(db, chatId));
    const isBareStart = /^\/start\s*$/i.test(text);
    const isNewsCommand = /^\/news\b/i.test(text);
    const isStopCommand = /^\/stop\b/i.test(text);

    if (known) {
      if (isStopCommand) {
        // Unsubscribe from the daily send. Sending the code word again
        // afterwards restarts it — that's already the activation path above.
        await removeRecipient(db, chatId);
        await sendMessage(botToken, { chatId, textHtml: STOPPED_TEXT, replyMarkup: { inline_keyboard: [] } });
        if (chatId !== authorChatId) {
          const who = update.message.chat.first_name ? ` (${update.message.chat.first_name})` : '';
          await sendMessage(botToken, {
            chatId: authorChatId,
            textHtml: `Recipient stopped${who}: chat_id ${chatId}`,
            replyMarkup: { inline_keyboard: [] },
          });
        }
      } else if (isNewsCommand) {
        // Manual trigger: same as tapping 📰 «Ще новини» under a message, but
        // works anytime — typed directly, or from the bot's commands menu.
        await deliverMoreNews(chatId);
      } else if (text.length > 0 && !isBareStart) {
        // A registered recipient's free-form message is treated as a chemistry
        // question and answered directly — always something back, never silence.
        await answerQuestion(botToken, geminiApiKey, chatId, text);
      } else if (isBareStart) {
        await sendMessage(botToken, { chatId, textHtml: ALREADY_ACTIVATED_TEXT, replyMarkup: WELCOME_BACK_KEYBOARD });
      }
      // else: empty/non-text content from a known chat — nothing to respond to.
      return new Response('ok');
    }

    // Unregistered chat, whatever they sent (including a bare /start with no
    // payload — the case that previously went silent): ask for the code word
    // in-chat, so opening the bot always produces a visible response.
    await sendMessage(botToken, { chatId, textHtml: ONBOARDING_TEXT, replyMarkup: ONBOARDING_KEYBOARD });
    return new Response('ok');
  }

  const callback = update.callback_query;
  if (!callback) {
    return new Response('ok');
  }

  const senderId = callback.from?.id;
  if (senderId === undefined) {
    return new Response('ok');
  }
  const chatId = String(senderId);

  // 'info' is available to anyone, even before activation — it explains the
  // bot but reveals no personal or protected data, so it is exempt from the
  // allow-list gate below (that's the button a brand-new visitor can press).
  if (callback.data === 'info') {
    await answerCallbackQuery(botToken, callback.id, 'ℹ️');
    await sendMessage(botToken, { chatId, textHtml: INFO_TEXT, replyMarkup: { inline_keyboard: [] } });
    return new Response('ok');
  }

  // Private bot: silently ignore taps from anyone not registered (or the
  // author), so a stranger who finds the bot cannot trigger work or log
  // feedback even if they somehow guessed a button's callback_data.
  if (chatId !== authorChatId && !(await isRecipient(db, chatId))) {
    return new Response('ok');
  }

  // «Ще новини»: acknowledge the tap first (instant toast), then complete the
  // delivery within this request so it isn't cancelled as a background task.
  if (callback.data === 'news') {
    await answerCallbackQuery(botToken, callback.id, NEWS_TOAST);
    await deliverMoreNews(chatId);
    return new Response('ok');
  }

  if (!isFeedbackButton(callback.data)) {
    return new Response('ok');
  }

  const messageId = callback.message?.message_id;
  if (messageId !== undefined) {
    const sentRow = await getSentByChatAndMessageId(db, chatId, messageId);
    if (sentRow) {
      await upsertFeedback(db, sentRow.sendDate, chatId, callback.data, new Date().toISOString());
    }
  }

  await answerCallbackQuery(botToken, callback.id, TOAST_TEXT[callback.data]);
  return new Response('ok');
}
