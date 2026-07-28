import { BACKLOG_ITEMS, BacklogItem } from './backlogData';
import { isBacklogUsed, markBacklogUsed } from './db';

export async function pickBacklogItem(db: D1Database, now: Date): Promise<BacklogItem | null> {
  for (const item of BACKLOG_ITEMS) {
    if (!(await isBacklogUsed(db, item.slug))) {
      await markBacklogUsed(db, item.slug, now.toISOString());
      return item;
    }
  }
  return null;
}
