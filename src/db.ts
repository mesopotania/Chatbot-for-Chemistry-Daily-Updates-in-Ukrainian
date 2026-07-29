export async function isUrlSent(db: D1Database, url: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM sent WHERE url = ? UNION ALL SELECT 1 FROM extra_sent WHERE url = ? LIMIT 1')
    .bind(url, url)
    .first();
  return row !== null;
}

export async function markExtraSent(db: D1Database, url: string, sentAtIso: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO extra_sent (url, sent_at) VALUES (?, ?)').bind(url, sentAtIso).run();
}

// Bulk dedup helpers. The collector uses these instead of per-item queries,
// because Cloudflare caps the number of binding (D1) calls per Worker
// invocation — one query for the whole set, filtered in memory.
export async function getSentUrlSet(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT url FROM sent UNION SELECT url FROM extra_sent')
    .all<{ url: string }>();
  return new Set(results.map((r) => r.url));
}

export async function getAllSeen(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare('SELECT url, first_seen_at as firstSeenAt FROM seen')
    .all<{ url: string; firstSeenAt: string }>();
  return new Map(results.map((r) => [r.url, r.firstSeenAt]));
}

export async function markSeenBatch(db: D1Database, urls: string[], nowIso: string): Promise<void> {
  if (urls.length === 0) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO seen (url, first_seen_at) VALUES (?, ?)');
  await db.batch(urls.map((u) => stmt.bind(u, nowIso)));
}

export async function getSeenRow(db: D1Database, url: string): Promise<{ firstSeenAt: string } | null> {
  const row = await db
    .prepare('SELECT first_seen_at as firstSeenAt FROM seen WHERE url = ?')
    .bind(url)
    .first<{ firstSeenAt: string }>();
  return row ?? null;
}

export async function markSeen(db: D1Database, url: string, nowIso: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO seen (url, first_seen_at) VALUES (?, ?)').bind(url, nowIso).run();
}

// Registered daily-article recipients: self-activated via the code word, or
// added directly. The daily send fans out to everyone here.
export async function addRecipient(db: D1Database, chatId: string, label: string | null, addedAtIso: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO recipients (chat_id, label, added_at) VALUES (?, ?, ?)').bind(chatId, label, addedAtIso).run();
}

export async function isRecipient(db: D1Database, chatId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM recipients WHERE chat_id = ?').bind(chatId).first();
  return row !== null;
}

export async function getRecipientChatIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT chat_id as chatId FROM recipients').all<{ chatId: string }>();
  return results.map((r) => r.chatId);
}

// Unsubscribes a chat from the daily send (/stop). Sending the code word
// again afterwards re-adds them via addRecipient — no separate "restart" path needed.
export async function removeRecipient(db: D1Database, chatId: string): Promise<void> {
  await db.prepare('DELETE FROM recipients WHERE chat_id = ?').bind(chatId).run();
}

export interface SentRow {
  sendDate: string;
  chatId: string;
  url: string;
  messageId: number;
  headline: string;
  coinedTerm: string | null;
  sentAt: string;
}

const SENT_COLUMNS =
  'send_date as sendDate, chat_id as chatId, url, message_id as messageId, headline, coined_term as coinedTerm, sent_at as sentAt';

// Any row for the date means the daily pipeline already ran (recipients all
// share the same article, sent the same day), regardless of who got it.
export async function getSentForDate(db: D1Database, sendDate: string): Promise<SentRow | null> {
  const row = await db
    .prepare(`SELECT ${SENT_COLUMNS} FROM sent WHERE send_date = ? LIMIT 1`)
    .bind(sendDate)
    .first<SentRow>();
  return row ?? null;
}

export async function getSentByChatAndMessageId(db: D1Database, chatId: string, messageId: number): Promise<SentRow | null> {
  const row = await db
    .prepare(`SELECT ${SENT_COLUMNS} FROM sent WHERE chat_id = ? AND message_id = ?`)
    .bind(chatId, messageId)
    .first<SentRow>();
  return row ?? null;
}

export async function recordSent(db: D1Database, row: SentRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sent (send_date, chat_id, url, message_id, headline, coined_term, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(row.sendDate, row.chatId, row.url, row.messageId, row.headline, row.coinedTerm, row.sentAt)
    .run();
}

export async function getSentBetween(db: D1Database, fromDate: string, toDate: string): Promise<SentRow[]> {
  const { results } = await db
    .prepare(`SELECT ${SENT_COLUMNS} FROM sent WHERE send_date >= ? AND send_date <= ? ORDER BY send_date`)
    .bind(fromDate, toDate)
    .all<SentRow>();
  return results;
}

export type FeedbackButton = 'like' | 'dislike' | 'more';

export async function upsertFeedback(
  db: D1Database,
  sendDate: string,
  chatId: string,
  button: FeedbackButton,
  tappedAtIso: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO feedback (send_date, chat_id, button, tapped_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(send_date, chat_id) DO UPDATE SET button = excluded.button, tapped_at = excluded.tapped_at`
    )
    .bind(sendDate, chatId, button, tappedAtIso)
    .run();
}

export async function getFeedbackBetween(
  db: D1Database,
  fromDate: string,
  toDate: string
): Promise<{ sendDate: string; chatId: string; button: FeedbackButton }[]> {
  const { results } = await db
    .prepare('SELECT send_date as sendDate, chat_id as chatId, button FROM feedback WHERE send_date >= ? AND send_date <= ?')
    .bind(fromDate, toDate)
    .all<{ sendDate: string; chatId: string; button: FeedbackButton }>();
  return results;
}

export async function isBacklogUsed(db: D1Database, slug: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM backlog_used WHERE slug = ?').bind(slug).first();
  return row !== null;
}

export async function markBacklogUsed(db: D1Database, slug: string, usedAtIso: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO backlog_used (slug, used_at) VALUES (?, ?)').bind(slug, usedAtIso).run();
}

export async function pruneSeenOlderThan(db: D1Database, cutoffIso: string): Promise<void> {
  await db.prepare('DELETE FROM seen WHERE first_seen_at < ?').bind(cutoffIso).run();
}
