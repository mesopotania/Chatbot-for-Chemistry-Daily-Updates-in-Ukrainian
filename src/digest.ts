import { FeedbackButton, SentRow, getFeedbackBetween, getSentBetween } from './db';
import { sendMessage } from './telegram';

const BUTTON_LABEL: Record<FeedbackButton, string> = {
  like: '❤️ Подобається',
  dislike: '👎 Не цікаво',
  more: '🔍 Хоче більше',
};

function formatDigestText(sent: SentRow[], feedback: { sendDate: string; button: FeedbackButton }[]): string {
  if (sent.length === 0) {
    return 'Weekly digest: nothing was sent this week.';
  }

  const feedbackByDate = new Map(feedback.map((f) => [f.sendDate, f.button]));
  const lines = sent.map((row) => {
    const tap = feedbackByDate.get(row.sendDate);
    const tapLabel = tap ? BUTTON_LABEL[tap] : '(no reaction)';
    const coined = row.coinedTerm ? ` [coined term: ${row.coinedTerm}]` : '';
    return `${row.sendDate}: ${row.headline} — ${tapLabel}${coined}`;
  });

  return `Weekly digest\n\n${lines.join('\n')}`;
}

export async function sendWeeklyDigest(db: D1Database, botToken: string, authorChatId: string, now: Date): Promise<void> {
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const sent = await getSentBetween(db, fromDate, toDate);
  const feedback = await getFeedbackBetween(db, fromDate, toDate);

  await sendMessage(botToken, {
    chatId: authorChatId,
    textHtml: formatDigestText(sent, feedback),
    replyMarkup: { inline_keyboard: [] },
  });
}
