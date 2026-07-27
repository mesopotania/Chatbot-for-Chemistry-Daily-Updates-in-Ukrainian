export type Tier = 'core' | 'widening';

export interface Candidate {
  url: string;
  title: string;
  blurb: string;
  publishedAt: string;
  sourceName: string;
}

export interface Article {
  headline: string;
  paragraphs: string[];
  whyMatters: string;
  coinedTerm: string | null;
  url: string;
  sourceName: string;
  imageUrl: string | null;
}

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  GEMINI_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  READER_CHAT_ID: string;
  AUTHOR_CHAT_ID: string;
  SEND_HOUR: string;
  TIMEZONE: string;
}
