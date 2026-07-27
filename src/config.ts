import { Env } from './types';

const REQUIRED_KEYS: (keyof Env)[] = [
  'TELEGRAM_BOT_TOKEN',
  'GEMINI_API_KEY',
  'TELEGRAM_WEBHOOK_SECRET',
  'READER_CHAT_ID',
  'AUTHOR_CHAT_ID',
  'SEND_HOUR',
  'TIMEZONE',
];

export class ConfigError extends Error {}

export function validateConfig(env: Env): void {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required configuration: ${missing.join(', ')}`);
  }
  const hour = Number(env.SEND_HOUR);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new ConfigError(`SEND_HOUR must be an integer 0-23, got: ${env.SEND_HOUR}`);
  }
}
