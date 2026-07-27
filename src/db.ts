export async function isUrlSent(db: D1Database, url: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM sent WHERE url = ?').bind(url).first();
  return row !== null;
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

export interface SentRow {
  sendDate: string;
  url: string;
  messageId: number;
  headline: string;
  coinedTerm: string | null;
  sentAt: string;
}

const SENT_COLUMNS =
  'send_date as sendDate, url, message_id as messageId, headline, coined_term as coinedTerm, sent_at as sentAt';

export async function getSentForDate(db: D1Database, sendDate: string): Promise<SentRow | null> {
  const row = await db
    .prepare(`SELECT ${SENT_COLUMNS} FROM sent WHERE send_date = ?`)
    .bind(sendDate)
    .first<SentRow>();
  return row ?? null;
}

export async function getSentByMessageId(db: D1Database, messageId: number): Promise<SentRow | null> {
  const row = await db
    .prepare(`SELECT ${SENT_COLUMNS} FROM sent WHERE message_id = ?`)
    .bind(messageId)
    .first<SentRow>();
  return row ?? null;
}

export async function recordSent(db: D1Database, row: SentRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sent (send_date, url, message_id, headline, coined_term, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(row.sendDate, row.url, row.messageId, row.headline, row.coinedTerm, row.sentAt)
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
  button: FeedbackButton,
  tappedAtIso: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO feedback (send_date, button, tapped_at) VALUES (?, ?, ?)
       ON CONFLICT(send_date) DO UPDATE SET button = excluded.button, tapped_at = excluded.tapped_at`
    )
    .bind(sendDate, button, tappedAtIso)
    .run();
}

export async function getFeedbackBetween(
  db: D1Database,
  fromDate: string,
  toDate: string
): Promise<{ sendDate: string; button: FeedbackButton }[]> {
  const { results } = await db
    .prepare('SELECT send_date as sendDate, button FROM feedback WHERE send_date >= ? AND send_date <= ?')
    .bind(fromDate, toDate)
    .all<{ sendDate: string; button: FeedbackButton }>();
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
