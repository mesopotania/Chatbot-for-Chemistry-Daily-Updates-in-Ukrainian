import { describe, it, expect } from 'vitest';
import { validateConfig, ConfigError } from '../src/config';
import { Env } from '../src/types';

function fullEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    TELEGRAM_BOT_TOKEN: 'token',
    GEMINI_API_KEY: 'key',
    TELEGRAM_WEBHOOK_SECRET: 'secret',
    READER_CHAT_ID: '111',
    AUTHOR_CHAT_ID: '222',
    SEND_HOUR: '8',
    TIMEZONE: 'Europe/Kyiv',
    ...overrides,
  };
}

describe('validateConfig', () => {
  it('does not throw when every value is present and valid', () => {
    expect(() => validateConfig(fullEnv())).not.toThrow();
  });

  it('throws ConfigError naming the missing key', () => {
    const env = fullEnv({ GEMINI_API_KEY: '' });
    expect(() => validateConfig(env)).toThrow(ConfigError);
    expect(() => validateConfig(env)).toThrow(/GEMINI_API_KEY/);
  });

  it('throws when SEND_HOUR is not an integer 0-23', () => {
    expect(() => validateConfig(fullEnv({ SEND_HOUR: '24' }))).toThrow(ConfigError);
    expect(() => validateConfig(fullEnv({ SEND_HOUR: 'eight' }))).toThrow(ConfigError);
  });
});
