import { getSentForDate } from './db';

export function currentHourAndDateIn(timeZone: string, now: Date): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { hour, date };
}

export async function shouldRunPipeline(
  db: D1Database,
  timeZone: string,
  sendHour: number,
  now: Date
): Promise<{ run: boolean; sendDate: string }> {
  const { hour, date } = currentHourAndDateIn(timeZone, now);
  if (hour !== sendHour) return { run: false, sendDate: date };
  const existing = await getSentForDate(db, date);
  if (existing) return { run: false, sendDate: date };
  return { run: true, sendDate: date };
}

export function isDigestTick(timeZone: string, now: Date): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  const { hour } = currentHourAndDateIn(timeZone, now);
  return weekday === 'Sun' && hour === 20;
}
