import { FeedbackButton, SentRow, getFeedbackBetween, getSentBetween } from './db';
import { sendMessage } from './telegram';

const BUTTON_LABEL: Record<FeedbackButton, string> = {
  like: '❤️ Подобається',
  dislike: '👎 Не цікаво',
  more: '🔍 Хоче більше',
};

function formatDigestText(sent: SentRow[], feedback: { sendDate: string; chatId: string; button: FeedbackButton }[]): string {
  if (sent.length === 0) {
    return 'Weekly digest: nothing was sent this week.';
  }

  // One row per recipient per day now — dedupe to one line per day (same
  // article for everyone), and aggregate that day's reactions across recipients.
  const byDate = new Map<string, SentRow>();
  for (const row of sent) if (!byDate.has(row.sendDate)) byDate.set(row.sendDate, row);

  const feedbackByDate = new Map<string, FeedbackButton[]>();
  for (const f of feedback) {
    const list = feedbackByDate.get(f.sendDate) ?? [];
    list.push(f.button);
    feedbackByDate.set(f.sendDate, list);
  }

  const lines = [...byDate.values()].map((row) => {
    const taps = feedbackByDate.get(row.sendDate) ?? [];
    const tapLabel = taps.length > 0 ? taps.map((b) => BUTTON_LABEL[b]).join(', ') : '(no reaction)';
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
