# «Хімія щодня» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that sends one Ukrainian-language chemistry news summary per day to a single Telegram reader, entirely on free tiers (Cloudflare Workers + D1, Gemini 3 Flash, RSS feeds), with feedback buttons and a weekly author digest.

**Architecture:** One Worker with two entry points — an hourly `scheduled` handler that gates on Kyiv local time and runs the collect → edit → send pipeline, and a `fetch` handler that receives the Telegram webhook for button taps. Four units (collector, editor, courier, feedback handler) meet only through one D1 database, matching the spec's §5 architecture.

**Tech Stack:** TypeScript on the Cloudflare Workers runtime, Cloudflare D1 (SQLite), Gemini 3 Flash API, Telegram Bot API, Vitest with `@cloudflare/vitest-pool-workers`. No runtime npm dependencies — `fetch()`, `HTMLRewriter`, and the D1 binding are all built into the Workers runtime.

**Spec:** `docs/superpowers/specs/2026-07-26-ukrainian-chemistry-bot-design.md`

## Global Constraints

- Runtime is Cloudflare Workers (free plan) with Cloudflare D1 (free plan) for storage. No other hosting.
- Writer model is `gemini-3-flash` on the free tier only. **Never enable billing on the Google Cloud project holding `GEMINI_API_KEY`** — doing so removes the free tier permanently (spec §5.2).
- Every string the reader can see must be Ukrainian: buttons, toasts, error text sent to her. Only `AUTHOR_CHAT_ID` messages may contain English (spec §6, §8).
- `sendMessage` calls must always set `link_preview_options: { is_disabled: true }`. This is the one path where an English source title could reach her (spec §5.3).
- One message per day to the reader, never two. An imageless day is the same message minus the image line (spec §5.3).
- Editor targets **900 visible characters or fewer** for the rendered caption; Telegram's hard cap is 1024 (spec §5.2).
- Cloudflare cron triggers run in UTC with no timezone option. The cron fires **hourly**; the handler computes Kyiv local time itself and gates on it. Never hand-edit the cron schedule for DST (spec §7).
- No AI-generated illustrations and no stock photography, ever. Only the publisher's `og:image`, or text-only (spec §5.3).
- No npm runtime dependencies. `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, and `typescript` are the only entries in `devDependencies`.
- `sent.send_date` is the idempotency key. It must be checked before any send, since the cron fires 24 times a day (spec §5.5, §8).

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `schema.sql`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.dev.vars`
- Create: `src/types.ts`
- Create: `src/index.ts`
- Test: `test/setup.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: nothing — this is the first task.
- Produces: `Env` and `Candidate`/`Article`/`Tier` types (`src/types.ts`) that every later task imports; `applySchema(db: D1Database): Promise<void>` (`test/setup.ts`) that every later test file calls to get a schema-applied D1 binding; the `schema.sql` table definitions that `db.ts` (Task 4) will query against.

- [ ] **Step 1: Initialize the project and install dependencies**

```bash
npm init -y
npm install -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022"],
    "module": "es2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write `wrangler.toml`**

```toml
name = "khimiya-shchodnya"
main = "src/index.ts"
compatibility_date = "2026-07-27"

[triggers]
crons = ["0 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "khimiya-shchodnya-db"
database_id = "00000000-0000-0000-0000-000000000000" # replace after `wrangler d1 create` in Task 16

[vars]
READER_CHAT_ID = "0" # replace with her real chat ID once she has tapped Start (Task 16)
AUTHOR_CHAT_ID = "0" # replace with the author's own chat ID (Task 16)
SEND_HOUR = "8"
TIMEZONE = "Europe/Kyiv"
```

- [ ] **Step 4: Write `schema.sql`, exactly matching spec §5.5**

```sql
CREATE TABLE seen (
  url TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE sent (
  send_date   TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  message_id  INTEGER NOT NULL,
  headline    TEXT NOT NULL,
  coined_term TEXT,
  sent_at     TEXT NOT NULL
);

CREATE TABLE feedback (
  send_date TEXT PRIMARY KEY REFERENCES sent(send_date),
  button    TEXT NOT NULL,
  tapped_at TEXT NOT NULL
);

CREATE TABLE backlog_used (
  slug    TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 6: Write `.gitignore` and `.dev.vars`**

`.gitignore`:
```
node_modules/
.wrangler/
.dev.vars
```

`.dev.vars` (local-only secret values used by `wrangler dev` and by the test pool — never committed):
```
TELEGRAM_BOT_TOKEN=test-token
GEMINI_API_KEY=test-key
TELEGRAM_WEBHOOK_SECRET=test-secret
```

- [ ] **Step 7: Write `src/types.ts`**

```typescript
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
```

- [ ] **Step 8: Write `src/index.ts` as a placeholder Worker**

```typescript
import { Env } from './types';

export default {
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Replaced with the real pipeline in Task 15.
  },

  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('ok');
  },
};
```

- [ ] **Step 9: Write `test/setup.ts`**

```typescript
import schemaSql from '../schema.sql?raw';

export async function applySchema(db: D1Database): Promise<void> {
  await db.exec(schemaSql);
}
```

- [ ] **Step 10: Write the smoke test `test/index.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { applySchema } from './setup';

describe('worker smoke test', () => {
  it('responds to a basic fetch', async () => {
    await applySchema(env.DB);
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://example.com/'), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 11: Run the test suite to verify it passes**

Run: `npx vitest run`
Expected: PASS (1 test)

- [ ] **Step 12: Commit**

```bash
git init
git add package.json package-lock.json tsconfig.json wrangler.toml schema.sql vitest.config.ts .gitignore src/ test/
git commit -m "chore: scaffold Cloudflare Workers project with D1 schema"
```

---

## Task 2: Config validation

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `Env` (`src/types.ts`, Task 1).
- Produces: `validateConfig(env: Env): void` (throws `ConfigError`) and the `ConfigError` class, both used by `src/index.ts` in Task 15.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL with "Cannot find module '../src/config'"

- [ ] **Step 3: Write `src/config.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: validate required environment configuration at startup"
```

---

## Task 3: Ukrainian-only validator

**Files:**
- Create: `src/validation.ts`
- Test: `test/validation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isUkrainianOnly(text: string): boolean` and `findDisallowedLatinTokens(text: string): string[]`, both used by `src/editor.ts` in Task 11.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { isUkrainianOnly, findDisallowedLatinTokens } from '../src/validation';

describe('isUkrainianOnly', () => {
  it('accepts pure Ukrainian text', () => {
    expect(isUkrainianOnly('Дослідники синтезували нову сполуку.')).toBe(true);
  });

  it('rejects English words left in the body', () => {
    expect(isUkrainianOnly('Дослідники виявили the new compound.')).toBe(false);
    expect(findDisallowedLatinTokens('Дослідники виявили the new compound.')).toEqual([
      'the',
      'new',
      'compound',
    ]);
  });

  it('allows chemical formulas through', () => {
    expect(isUkrainianOnly('Формула кухонної солі — NaCl, а води — H2O.')).toBe(true);
    expect(isUkrainianOnly('Глюкоза має формулу C6H12O6.')).toBe(true);
  });

  it('allows permitted SI units and pH', () => {
    expect(isUkrainianOnly('Розчин мав pH 7 і масу 5 mg.')).toBe(true);
  });

  it('rejects a Latin acronym that is not a valid element chain', () => {
    expect(isUkrainianOnly('Дослідники використали DNA-секвенування.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/validation.test.ts`
Expected: FAIL with "Cannot find module '../src/validation'"

- [ ] **Step 3: Write `src/validation.ts`**

```typescript
const PERMITTED_LATIN_TOKENS = new Set<string>(['nm', 'pm', 'mm', 'cm', 'km', 'kg', 'mg', 'ml', 'kJ', 'mol', 'pH']);

const ELEMENT_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Pt',
]);

const LATIN_WORD = /[A-Za-z][A-Za-z0-9]*/g;

function isChemicalFormula(token: string): boolean {
  const segments = token.match(/[A-Z][a-z]?\d*/g);
  if (!segments || segments.join('') !== token) return false;
  return segments.every((seg) => ELEMENT_SYMBOLS.has(seg.match(/^[A-Z][a-z]?/)![0]));
}

export function findDisallowedLatinTokens(text: string): string[] {
  const matches = text.match(LATIN_WORD) ?? [];
  return matches.filter((token) => !PERMITTED_LATIN_TOKENS.has(token) && !isChemicalFormula(token));
}

export function isUkrainianOnly(text: string): boolean {
  return findDisallowedLatinTokens(text).length === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/validation.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/validation.ts test/validation.test.ts
git commit -m "feat: add Latin-script validator for the Ukrainian-only rule"
```

---

## Task 4: D1 data access layer

**Files:**
- Create: `src/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `schema.sql` (Task 1), `applySchema` (`test/setup.ts`, Task 1).
- Produces: `isUrlSent`, `getSeenRow`, `markSeen`, `SentRow`, `getSentForDate`, `getSentByMessageId`, `recordSent`, `getSentBetween`, `FeedbackButton`, `upsertFeedback`, `getFeedbackBetween`, `isBacklogUsed`, `markBacklogUsed`, `pruneSeenOlderThan` — all consumed by Tasks 8, 9, 11, 13, 14, 15.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import {
  isUrlSent,
  getSeenRow,
  markSeen,
  getSentForDate,
  getSentByMessageId,
  recordSent,
  getSentBetween,
  upsertFeedback,
  getFeedbackBetween,
  isBacklogUsed,
  markBacklogUsed,
  pruneSeenOlderThan,
} from '../src/db';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('seen / sent', () => {
  it('tracks seen URLs and their first-seen timestamp', async () => {
    expect(await getSeenRow(env.DB, 'https://x/a')).toBeNull();
    await markSeen(env.DB, 'https://x/a', '2026-07-01T00:00:00Z');
    expect(await getSeenRow(env.DB, 'https://x/a')).toEqual({ firstSeenAt: '2026-07-01T00:00:00Z' });
  });

  it('reports a URL as sent only after recordSent', async () => {
    expect(await isUrlSent(env.DB, 'https://x/a')).toBe(false);
    await recordSent(env.DB, {
      sendDate: '2026-07-27',
      url: 'https://x/a',
      messageId: 42,
      headline: 'Заголовок',
      coinedTerm: null,
      sentAt: '2026-07-27T08:00:00Z',
    });
    expect(await isUrlSent(env.DB, 'https://x/a')).toBe(true);
  });

  it('looks up a sent row by date or by message id', async () => {
    await recordSent(env.DB, {
      sendDate: '2026-07-27',
      url: 'https://x/a',
      messageId: 42,
      headline: 'Заголовок',
      coinedTerm: 'нановорот',
      sentAt: '2026-07-27T08:00:00Z',
    });
    expect(await getSentForDate(env.DB, '2026-07-27')).not.toBeNull();
    expect(await getSentForDate(env.DB, '2026-07-28')).toBeNull();
    expect((await getSentByMessageId(env.DB, 42))?.sendDate).toBe('2026-07-27');
    expect(await getSentByMessageId(env.DB, 999)).toBeNull();
  });

  it('returns sent rows within a date range for the digest', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-20', url: 'https://x/1', messageId: 1, headline: 'A', coinedTerm: null, sentAt: '2026-07-20T08:00:00Z' });
    await recordSent(env.DB, { sendDate: '2026-07-26', url: 'https://x/2', messageId: 2, headline: 'B', coinedTerm: null, sentAt: '2026-07-26T08:00:00Z' });
    const rows = await getSentBetween(env.DB, '2026-07-21', '2026-07-27');
    expect(rows.map((r) => r.sendDate)).toEqual(['2026-07-26']);
  });

  it('prunes seen rows older than a cutoff', async () => {
    await markSeen(env.DB, 'https://old', '2026-06-01T00:00:00Z');
    await markSeen(env.DB, 'https://new', '2026-07-25T00:00:00Z');
    await pruneSeenOlderThan(env.DB, '2026-07-01T00:00:00Z');
    expect(await getSeenRow(env.DB, 'https://old')).toBeNull();
    expect(await getSeenRow(env.DB, 'https://new')).not.toBeNull();
  });
});

describe('feedback', () => {
  it('upserts feedback so a changed mind replaces rather than duplicates', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', url: 'https://x/a', messageId: 1, headline: 'A', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    await upsertFeedback(env.DB, '2026-07-27', 'like', '2026-07-27T09:00:00Z');
    await upsertFeedback(env.DB, '2026-07-27', 'dislike', '2026-07-27T10:00:00Z');
    const rows = await getFeedbackBetween(env.DB, '2026-07-01', '2026-07-31');
    expect(rows).toEqual([{ sendDate: '2026-07-27', button: 'dislike' }]);
  });
});

describe('backlog_used', () => {
  it('tracks which evergreen items have been used', async () => {
    expect(await isBacklogUsed(env.DB, 'perkin-mauve')).toBe(false);
    await markBacklogUsed(env.DB, 'perkin-mauve', '2026-07-27T08:00:00Z');
    expect(await isBacklogUsed(env.DB, 'perkin-mauve')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL with "Cannot find module '../src/db'"

- [ ] **Step 3: Write `src/db.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/db.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db.ts test/db.test.ts
git commit -m "feat: add D1 data access layer for seen/sent/feedback/backlog tables"
```

---

## Task 5: Scheduling gate

**Files:**
- Create: `src/scheduling.ts`
- Test: `test/scheduling.test.ts`

**Interfaces:**
- Consumes: `getSentForDate` (`src/db.ts`, Task 4).
- Produces: `currentHourAndDateIn(timeZone, now): { hour: number; date: string }`, `shouldRunPipeline(db, timeZone, sendHour, now): Promise<{ run: boolean; sendDate: string }>`, `isDigestTick(timeZone, now): boolean` — all consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write the failing test**

This is the test that would have caught the hand-edited-cron failure the spec explicitly warns about (§9): it pins exact UTC instants either side of both 2026 DST boundaries and checks the Kyiv hour comes out right on both sides.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { currentHourAndDateIn, shouldRunPipeline, isDigestTick } from '../src/scheduling';
import { recordSent } from '../src/db';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('currentHourAndDateIn', () => {
  it('resolves 08:00 Kyiv correctly on both sides of the March DST change', () => {
    // Ukraine goes EET (+2) -> EEST (+3) on 2026-03-29 at 01:00 UTC.
    // Before: 08:00 Kyiv = 06:00 UTC. After: 08:00 Kyiv = 05:00 UTC.
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-03-28T06:00:00Z')).hour).toBe(8);
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-03-30T05:00:00Z')).hour).toBe(8);
  });

  it('resolves 08:00 Kyiv correctly on both sides of the October DST change', () => {
    // Ukraine goes EEST (+3) -> EET (+2) on 2026-10-25 at 01:00 UTC.
    // Before: 08:00 Kyiv = 05:00 UTC. After: 08:00 Kyiv = 06:00 UTC.
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-10-24T05:00:00Z')).hour).toBe(8);
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-10-26T06:00:00Z')).hour).toBe(8);
  });

  it('does not fire on the wrong UTC tick either side of a boundary', () => {
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-03-28T05:00:00Z')).hour).not.toBe(8);
    expect(currentHourAndDateIn('Europe/Kyiv', new Date('2026-10-26T05:00:00Z')).hour).not.toBe(8);
  });
});

describe('shouldRunPipeline', () => {
  it('runs at the configured hour when nothing has been sent yet', async () => {
    const result = await shouldRunPipeline(env.DB, 'Europe/Kyiv', 8, new Date('2026-07-27T05:00:00Z'));
    expect(result).toEqual({ run: true, sendDate: '2026-07-27' });
  });

  it('does not run outside the configured hour', async () => {
    const result = await shouldRunPipeline(env.DB, 'Europe/Kyiv', 8, new Date('2026-07-27T09:00:00Z'));
    expect(result.run).toBe(false);
  });

  it('does not run twice on the same date even at the right hour', async () => {
    await recordSent(env.DB, {
      sendDate: '2026-07-27',
      url: 'https://x/a',
      messageId: 1,
      headline: 'A',
      coinedTerm: null,
      sentAt: '2026-07-27T05:00:00Z',
    });
    const result = await shouldRunPipeline(env.DB, 'Europe/Kyiv', 8, new Date('2026-07-27T05:30:00Z'));
    expect(result.run).toBe(false);
  });
});

describe('isDigestTick', () => {
  it('is true only at 20:00 Kyiv on a Sunday', () => {
    // 2026-07-26 is a Sunday. 20:00 Kyiv in summer (EEST, +3) is 17:00 UTC.
    expect(isDigestTick('Europe/Kyiv', new Date('2026-07-26T17:00:00Z'))).toBe(true);
    expect(isDigestTick('Europe/Kyiv', new Date('2026-07-26T16:00:00Z'))).toBe(false);
    expect(isDigestTick('Europe/Kyiv', new Date('2026-07-27T17:00:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scheduling.test.ts`
Expected: FAIL with "Cannot find module '../src/scheduling'"

- [ ] **Step 3: Write `src/scheduling.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scheduling.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/scheduling.ts test/scheduling.test.ts
git commit -m "feat: gate the hourly cron on Kyiv local time instead of hand-edited UTC crons"
```

---

## Task 6: Telegram client

**Files:**
- Create: `src/telegram.ts`
- Test: `test/telegram.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `sendPhoto`, `sendMessage`, `answerCallbackQuery`, `setWebhook`, `isValidSecretToken`, `READER_KEYBOARD`, `InlineKeyboard` — consumed by Tasks 12, 13, 14, 15, 16.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendPhoto,
  sendMessage,
  answerCallbackQuery,
  setWebhook,
  isValidSecretToken,
  READER_KEYBOARD,
} from '../src/telegram';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('sendPhoto', () => {
  it('posts photo, caption, HTML parse mode, and the reader keyboard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true, result: { message_id: 7 } }));

    const result = await sendPhoto('tok', {
      chatId: '1',
      photoUrl: 'https://img/x.jpg',
      captionHtml: '<b>Заголовок</b>',
      replyMarkup: READER_KEYBOARD,
    });

    expect(result).toEqual({ ok: true, messageId: 7 });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottok/sendPhoto');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.parse_mode).toBe('HTML');
    expect(body.reply_markup.inline_keyboard).toHaveLength(2);
  });
});

describe('sendMessage', () => {
  it('always disables link previews', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true, result: { message_id: 8 } }));

    await sendMessage('tok', { chatId: '1', textHtml: 'text', replyMarkup: READER_KEYBOARD });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.link_preview_options).toEqual({ is_disabled: true });
  });
});

describe('answerCallbackQuery', () => {
  it('posts the callback id and toast text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await answerCallbackQuery('tok', 'cbq-1', 'Дякую!');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ callback_query_id: 'cbq-1', text: 'Дякую!' });
  });
});

describe('setWebhook', () => {
  it('posts the webhook URL and secret token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await setWebhook('tok', 'https://worker.example/webhook', 'shh');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ url: 'https://worker.example/webhook', secret_token: 'shh' });
  });
});

describe('isValidSecretToken', () => {
  it('accepts a matching header and rejects a missing or wrong one', () => {
    const good = new Request('https://x/', { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'shh' } });
    const bad = new Request('https://x/', { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' } });
    const missing = new Request('https://x/');
    expect(isValidSecretToken(good, 'shh')).toBe(true);
    expect(isValidSecretToken(bad, 'shh')).toBe(false);
    expect(isValidSecretToken(missing, 'shh')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/telegram.test.ts`
Expected: FAIL with "Cannot find module '../src/telegram'"

- [ ] **Step 3: Write `src/telegram.ts`**

```typescript
const TELEGRAM_API = 'https://api.telegram.org';

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export const READER_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [
    [
      { text: '❤️ Подобається', callback_data: 'like' },
      { text: '👎 Не цікаво', callback_data: 'dislike' },
    ],
    [{ text: '🔍 Дізнатися більше', callback_data: 'more' }],
  ],
};

export interface SendPhotoParams {
  chatId: string;
  photoUrl: string;
  captionHtml: string;
  replyMarkup: InlineKeyboard;
}

export interface SendMessageParams {
  chatId: string;
  textHtml: string;
  replyMarkup: InlineKeyboard;
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
}

function apiUrl(token: string, method: string): string {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

async function postJson(token: string, method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; result?: { message_id: number } }> {
  const res = await fetch(apiUrl(token, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as { ok: boolean; result?: { message_id: number } };
}

export async function sendPhoto(token: string, params: SendPhotoParams): Promise<SendResult> {
  const body = await postJson(token, 'sendPhoto', {
    chat_id: params.chatId,
    photo: params.photoUrl,
    caption: params.captionHtml,
    parse_mode: 'HTML',
    reply_markup: params.replyMarkup,
  });
  return { ok: body.ok, messageId: body.result?.message_id };
}

export async function sendMessage(token: string, params: SendMessageParams): Promise<SendResult> {
  const body = await postJson(token, 'sendMessage', {
    chat_id: params.chatId,
    text: params.textHtml,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: params.replyMarkup,
  });
  return { ok: body.ok, messageId: body.result?.message_id };
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, text: string): Promise<void> {
  await fetch(apiUrl(token, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await fetch(apiUrl(token, 'setWebhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
}

export function isValidSecretToken(request: Request, expected: string): boolean {
  return request.headers.get('X-Telegram-Bot-Api-Secret-Token') === expected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/telegram.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts test/telegram.test.ts
git commit -m "feat: add Telegram Bot API client with link previews always disabled"
```

---

## Task 7: Gemini client

**Files:**
- Create: `src/gemini.ts`
- Test: `test/gemini.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `generateJson(params: GenerateJsonParams): Promise<GenerateJsonResult>`, `GenerateJsonResult` (a tagged union: `ok` / `blocked` / `quota_exceeded` / `error`), `ThinkingLevel` — consumed by `src/editor.ts` in Task 11.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateJson } from '../src/gemini';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function geminiResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const params = {
  apiKey: 'key',
  model: 'gemini-3-flash',
  prompt: 'test prompt',
  schema: { type: 'object', properties: {} },
  thinkingLevel: 'high' as const,
};

describe('generateJson', () => {
  it('returns parsed JSON on a normal response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      geminiResponse({
        candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }],
      })
    );
    const result = await generateJson(params);
    expect(result).toEqual({ kind: 'ok', data: { a: 1 } });
  });

  it('reports blocked when finishReason is SAFETY', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      geminiResponse({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'SAFETY' }] })
    );
    expect(await generateJson(params)).toEqual({ kind: 'blocked' });
  });

  it('reports blocked when promptFeedback carries a blockReason', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
    expect(await generateJson(params)).toEqual({ kind: 'blocked' });
  });

  it('reports quota_exceeded on HTTP 429', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(geminiResponse({}, 429));
    expect(await generateJson(params)).toEqual({ kind: 'quota_exceeded' });
  });

  it('reports error when the response text is not valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      geminiResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }] })
    );
    const result = await generateJson(params);
    expect(result.kind).toBe('error');
  });

  it('sends the schema, thinking level, and safety settings in the request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      geminiResponse({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] })
    );
    await generateJson(params);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual(params.schema);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(body.safetySettings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/gemini.test.ts`
Expected: FAIL with "Cannot find module '../src/gemini'"

- [ ] **Step 3: Write `src/gemini.ts`**

```typescript
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

export type ThinkingLevel = 'low' | 'high';

export interface GenerateJsonParams {
  apiKey: string;
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
  thinkingLevel: ThinkingLevel;
}

export type GenerateJsonResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'blocked' }
  | { kind: 'quota_exceeded' }
  | { kind: 'error'; status: number };

export async function generateJson(params: GenerateJsonParams): Promise<GenerateJsonResult> {
  const url = `${GEMINI_API}/${params.model}:generateContent?key=${params.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: params.schema,
        thinkingConfig: { thinkingLevel: params.thinkingLevel },
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });

  if (res.status === 429) return { kind: 'quota_exceeded' };
  if (!res.ok) return { kind: 'error', status: res.status };

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };

  if (body.promptFeedback?.blockReason) return { kind: 'blocked' };

  const candidate = body.candidates?.[0];
  if (!candidate) return { kind: 'blocked' };
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
    return { kind: 'blocked' };
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text) return { kind: 'error', status: res.status };

  try {
    return { kind: 'ok', data: JSON.parse(text) };
  } catch {
    return { kind: 'error', status: res.status };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/gemini.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/gemini.ts test/gemini.test.ts
git commit -m "feat: add Gemini client with structured output and safety-block handling"
```

---

## Task 8: RSS collector

**Files:**
- Create: `src/rss.ts`
- Create: `src/collector.ts`
- Test: `test/collector.test.ts`
- Test fixtures: `test/fixtures/chemistry-world.xml`, `test/fixtures/malformed.xml`

**Interfaces:**
- Consumes: `isUrlSent`, `getSeenRow`, `markSeen` (`src/db.ts`, Task 4).
- Produces: `parseRssItems(xml: string): RawRssItem[]` (`src/rss.ts`), `collect(db: D1Database, tier: Tier, now?: Date): Promise<Candidate[]>` and `FEED_SOURCES` (`src/collector.ts`) — consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write fixture RSS files**

`test/fixtures/chemistry-world.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Chemistry World</title>
<item>
<title>New catalyst speeds up nitrogen fixation</title>
<link>https://www.chemistryworld.com/news/new-catalyst-nitrogen</link>
<description><![CDATA[Researchers report a cobalt-based catalyst that fixes nitrogen at room temperature.]]></description>
<pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
</item>
<item>
<title>Old &amp; well-known reaction gets a new mechanism</title>
<link>https://www.chemistryworld.com/news/old-reaction-mechanism</link>
<description>A century-old reaction is shown to proceed through a different intermediate than assumed.</description>
<pubDate>Sun, 26 Jul 2026 06:00:00 GMT</pubDate>
</item>
</channel>
</rss>
```

`test/fixtures/malformed.xml`:
```xml
this is not xml at all <<< &
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { parseRssItems } from '../src/rss';
import { collect, FEED_SOURCES } from '../src/collector';
import { markSeen } from '../src/db';

const chemistryWorldXml = readFileSync('test/fixtures/chemistry-world.xml', 'utf-8');
const malformedXml = readFileSync('test/fixtures/malformed.xml', 'utf-8');

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('parseRssItems', () => {
  it('extracts title, link, description, and pubDate from each item', () => {
    const items = parseRssItems(chemistryWorldXml);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'New catalyst speeds up nitrogen fixation',
      link: 'https://www.chemistryworld.com/news/new-catalyst-nitrogen',
      description: 'Researchers report a cobalt-based catalyst that fixes nitrogen at room temperature.',
      pubDate: 'Mon, 27 Jul 2026 06:00:00 GMT',
    });
  });

  it('decodes XML entities outside of CDATA', () => {
    const items = parseRssItems(chemistryWorldXml);
    expect(items[1].title).toBe('Old & well-known reaction gets a new mechanism');
  });

  it('returns an empty list for non-XML input rather than throwing', () => {
    expect(() => parseRssItems(malformedXml)).not.toThrow();
    expect(parseRssItems(malformedXml)).toEqual([]);
  });
});

describe('collect', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === FEED_SOURCES.find((s) => s.tier === 'core')!.url) {
        return new Response(chemistryWorldXml, { status: 200 });
      }
      return new Response('', { status: 500 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns candidates from the core tier, skipping failing feeds', async () => {
    const candidates = await collect(env.DB, 'core', new Date('2026-07-27T08:00:00Z'));
    expect(candidates.some((c) => c.url === 'https://www.chemistryworld.com/news/new-catalyst-nitrogen')).toBe(true);
  });

  it('drops a URL that is already in sent', async () => {
    await env.DB
      .prepare('INSERT INTO sent (send_date, url, message_id, headline, coined_term, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('2026-07-20', 'https://www.chemistryworld.com/news/new-catalyst-nitrogen', 1, 'H', null, '2026-07-20T08:00:00Z')
      .run();
    const candidates = await collect(env.DB, 'core', new Date('2026-07-27T08:00:00Z'));
    expect(candidates.some((c) => c.url === 'https://www.chemistryworld.com/news/new-catalyst-nitrogen')).toBe(false);
  });

  it('keeps a candidate seen 3 days ago but drops one seen 8 days ago', async () => {
    const now = new Date('2026-07-27T08:00:00Z');
    await markSeen(env.DB, 'https://www.chemistryworld.com/news/new-catalyst-nitrogen', '2026-07-24T08:00:00Z');
    await markSeen(env.DB, 'https://www.chemistryworld.com/news/old-reaction-mechanism', '2026-07-19T08:00:00Z');
    const candidates = await collect(env.DB, 'core', now);
    expect(candidates.some((c) => c.url.endsWith('new-catalyst-nitrogen'))).toBe(true);
    expect(candidates.some((c) => c.url.endsWith('old-reaction-mechanism'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/collector.test.ts`
Expected: FAIL with "Cannot find module '../src/rss'"

- [ ] **Step 4: Write `src/rss.ts`**

```typescript
export interface RawRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function stripCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : s;
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function extractTag(itemXml: string, tag: string): string {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return decodeXmlEntities(stripCdata(match[1]).trim());
}

export function parseRssItems(xml: string): RawRssItem[] {
  const items: RawRssItem[] = [];
  const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  for (const itemXml of itemMatches) {
    const link = extractTag(itemXml, 'link');
    const title = extractTag(itemXml, 'title');
    if (!link || !title) continue;
    items.push({ title, link, description: extractTag(itemXml, 'description'), pubDate: extractTag(itemXml, 'pubDate') });
  }
  return items;
}
```

- [ ] **Step 5: Write `src/collector.ts`**

```typescript
import { Candidate, Tier } from './types';
import { isUrlSent, getSeenRow, markSeen } from './db';
import { parseRssItems } from './rss';

interface FeedSource {
  tier: Tier;
  name: string;
  url: string;
}

export const FEED_SOURCES: FeedSource[] = [
  { tier: 'core', name: 'Chemistry World', url: 'https://www.chemistryworld.com/rss/news.rss' },
  { tier: 'core', name: 'C&EN', url: 'https://cen.acs.org/rss.xml' },
  { tier: 'core', name: 'Nature Chemistry', url: 'https://www.nature.com/nchem.rss' },
  { tier: 'core', name: 'Phys.org — хімія', url: 'https://phys.org/rss-feed/chemistry-news/' },
  { tier: 'core', name: 'ScienceDaily — хімія', url: 'https://www.sciencedaily.com/rss/matter_energy/chemistry.xml' },
  { tier: 'widening', name: 'Phys.org — матеріалознавство', url: 'https://phys.org/rss-feed/physics-news/materials-science/' },
  { tier: 'widening', name: 'ScienceDaily — фармакологія', url: 'https://www.sciencedaily.com/rss/health_medicine/pharmacology.xml' },
];

const FEED_TIMEOUT_MS = 10_000;
const ELIGIBILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function isWithinEligibilityWindow(firstSeenAt: string, now: Date): boolean {
  return now.getTime() - new Date(firstSeenAt).getTime() <= ELIGIBILITY_WINDOW_MS;
}

export async function collect(db: D1Database, tier: Tier, now: Date = new Date()): Promise<Candidate[]> {
  const sources = FEED_SOURCES.filter((s) => s.tier === tier);
  const candidates: Candidate[] = [];

  for (const source of sources) {
    const xml = await fetchFeed(source.url);
    if (!xml) continue;

    let items;
    try {
      items = parseRssItems(xml);
    } catch {
      continue;
    }

    for (const item of items) {
      if (await isUrlSent(db, item.link)) continue;

      const seenRow = await getSeenRow(db, item.link);
      if (seenRow) {
        if (!isWithinEligibilityWindow(seenRow.firstSeenAt, now)) continue;
      } else {
        await markSeen(db, item.link, now.toISOString());
      }

      candidates.push({
        url: item.link,
        title: item.title,
        blurb: item.description,
        publishedAt: item.pubDate,
        sourceName: source.name,
      });
    }
  }

  return candidates;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/collector.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add src/rss.ts src/collector.ts test/collector.test.ts test/fixtures/
git commit -m "feat: add RSS parsing and the collector with a 7-day eligibility window"
```

---

## Task 9: Evergreen backlog

**Files:**
- Create: `src/backlogData.ts`
- Create: `src/backlog.ts`
- Test: `test/backlog.test.ts`

**Interfaces:**
- Consumes: `Article` (`src/types.ts`, Task 1), `isBacklogUsed`, `markBacklogUsed` (`src/db.ts`, Task 4).
- Produces: `BACKLOG_ITEMS: BacklogItem[]`, `BacklogItem` (`src/backlogData.ts`), `pickBacklogItem(db: D1Database, now: Date): Promise<BacklogItem | null>` (`src/backlog.ts`) — consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { BACKLOG_ITEMS } from '../src/backlogData';
import { pickBacklogItem } from '../src/backlog';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('backlog data', () => {
  it('has at least 14 items so a fortnight of failure produces no repeats', () => {
    expect(BACKLOG_ITEMS.length).toBeGreaterThanOrEqual(14);
  });

  it('has a unique slug for every item', () => {
    const slugs = BACKLOG_ITEMS.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('pickBacklogItem', () => {
  it('produces 14 distinct items across 14 consecutive total-failure days', async () => {
    const picked = new Set<string>();
    for (let day = 0; day < 14; day++) {
      const now = new Date(Date.UTC(2026, 0, day + 1, 8, 0, 0));
      const item = await pickBacklogItem(env.DB, now);
      expect(item).not.toBeNull();
      picked.add(item!.slug);
    }
    expect(picked.size).toBe(14);
  });

  it('returns null once every item has been used', async () => {
    for (let day = 0; day < BACKLOG_ITEMS.length; day++) {
      await pickBacklogItem(env.DB, new Date(Date.UTC(2026, 0, day + 1)));
    }
    expect(await pickBacklogItem(env.DB, new Date(Date.UTC(2026, 1, 1)))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/backlog.test.ts`
Expected: FAIL with "Cannot find module '../src/backlogData'"

- [ ] **Step 3: Write `src/backlogData.ts`**

```typescript
import { Article } from './types';

export interface BacklogItem {
  slug: string;
  article: Article;
}

export const BACKLOG_ITEMS: BacklogItem[] = [
  {
    slug: 'perkin-mauve',
    article: {
      headline: 'Як помилка подарувала світу перший синтетичний барвник',
      paragraphs: [
        "У 1856 році вісімнадцятирічний Вільям Перкін намагався синтезувати хінін із похідних кам'яновугільної смоли.",
        'Замість хініну він отримав чорний осад, що при розчиненні у спирті дав яскраво-фіолетовий розчин — мовеїн, перший синтетичний барвник.',
      ],
      whyMatters: 'Ця випадковість поклала початок цілій галузі органічної хімії синтетичних барвників.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Мовеїн',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'haber-bosch',
    article: {
      headline: 'Процес, що прогодував мільярди — і винайшов отруйний газ',
      paragraphs: [
        'У 1909 році Фріц Габер розробив спосіб синтезу аміаку з атмосферного азоту та водню під високим тиском і температурою за участі залізного каталізатора.',
        'Карл Бош масштабував цей процес до промислового виробництва, що зробило можливим синтетичні добрива для всього світу.',
      ],
      whyMatters: 'Без синтетичного аміаку сучасне сільське господарство не змогло б прогодувати нинішнє населення planety.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Процес_Габера_—_Боша',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'mendeleev-table',
    article: {
      headline: 'Таблиця, що передбачила елементи до їх відкриття',
      paragraphs: [
        'У 1869 році Дмитро Менделєєв розташував відомі елементи за зростанням атомної маси та побачив періодичність їхніх властивостей.',
        'Він залишив порожні місця в таблиці та передбачив властивості ще не відкритих елементів — і майбутні відкриття підтвердили ці передбачення.',
      ],
      whyMatters: 'Періодична система досі є основним інструментом систематизації хімічних знань.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Періодична_система_елементів',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'curie-radium',
    article: {
      headline: 'Марія Кюрі та відкриття двох нових елементів',
      paragraphs: [
        'Досліджуючи уранову смолку, Марія та П\'єр Кюрі виявили, що її радіоактивність перевищує ту, яку можна пояснити самим ураном.',
        'Ретельна хімічна очистка тонн руди дала їм два нові елементи — полоній та радій.',
      ],
      whyMatters: 'Ця робота заклала основи радіохімії та принесла Марії Кюрі дві Нобелівські премії в різних науках.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Марія_Кюрі',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'aspirin-hoffmann',
    article: {
      headline: 'Як хімік полегшив біль свого батька — і винайшов аспірин',
      paragraphs: [
        'У 1897 році Фелікс Гоффман, працюючи в Bayer, синтезував хімічно стабільну форму ацетилсаліцилової кислоти.',
        'Речовина виявилася ефективнішою за саліцилову кислоту та менш подразнювала шлунок, що зробило її одним із перших масових лікарських препаратів.',
      ],
      whyMatters: 'Аспірин лишається одним з найпоширеніших препаратів у світі понад століття по тому.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Ацетилсаліцилова_кислота',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'nylon-carothers',
    article: {
      headline: 'Перший повністю синтетичний волокно, що замінило шовк',
      paragraphs: [
        'У 1935 році хімік Воллес Каротерс у лабораторіях DuPont синтезував поліамід, здатний витягуватися у міцні волокна.',
        'Матеріал назвали нейлоном — він швидко замінив шовк у панчохах і став основою для парашутів під час Другої світової війни.',
      ],
      whyMatters: 'Нейлон відкрив епоху синтетичних полімерних матеріалів, які й досі оточують нас щодня.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Нейлон',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'buckminsterfullerene',
    article: {
      headline: 'Молекула-футбольний м\'яч, що принесла Нобелівську премію',
      paragraphs: [
        'У 1985 році дослідники, вивчаючи пари вуглецю лазерним випаровуванням графіту, виявили дивовижно стабільну молекулу C60.',
        'Її структура — замкнена сфера з 60 атомів вуглецю, розташованих як на футбольному м\'ячі — отримала назву бакмінстерфулерен.',
      ],
      whyMatters: 'Це відкриття започаткувало нову галузь — хімію фулеренів і вуглецевих наноструктур.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Фулерен',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'nobel-dynamite',
    article: {
      headline: 'Як хімік приборкав нестабільну вибухівку',
      paragraphs: [
        'Нітрогліцерин був потужною вибухівкою, але надто нестабільною й небезпечною у поводженні.',
        'Альфред Нобель у 1867 році змішав нітрогліцерин з інертним пористим матеріалом — і отримав динаміт, значно безпечніший у транспортуванні та застосуванні.',
      ],
      whyMatters: 'Прибутки від динаміту згодом заснували Нобелівську премію, включно з премією з хімії.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Динаміт',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'penicillin-mechanism',
    article: {
      headline: 'Цвіль на чашці Петрі, що змінила медицину',
      paragraphs: [
        'У 1928 році Александер Флемінг помітив, що цвіль Penicillium зупиняє ріст бактерій на забрудненій чашці Петрі.',
        'Пізніше Говард Флорі та Ернст Чейн з\'ясували, що речовина — пеніцилін — руйнує клітинну стінку бактерій, заважаючи синтезу пептидоглікану.',
      ],
      whyMatters: 'Це відкриття започаткувало еру антибіотиків і врятувало десятки мільйонів життів.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Пеніцилін',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'catalytic-converter',
    article: {
      headline: 'Каталізатор, що очищує вихлопні гази автомобіля',
      paragraphs: [
        'Трикомпонентний каталітичний нейтралізатор одночасно окиснює чадний газ і незгорілі вуглеводні та відновлює оксиди азоту до N2.',
        'Платина, паладій і родій, нанесені на керамічну стільникову основу, прискорюють ці реакції, самі не витрачаючись.',
      ],
      whyMatters: 'Ця технологія суттєво знизила токсичність вихлопних газів у мільярдах автомобілів.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Каталітичний_нейтралізатор',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'pcr-mullis',
    article: {
      headline: 'Метод, що дозволив розмножити ДНК у пробірці',
      paragraphs: [
        'У 1983 році Кері Муліс запропонував ідею циклічного нагрівання й охолодження розчину для копіювання певної ділянки ДНК за допомогою термостійкої полімерази.',
        'Метод дозволяє за кілька годин отримати мільярди копій навіть з однієї молекули ДНК.',
      ],
      whyMatters: 'Полімеразна ланцюгова реакція лежить в основі сучасної генетики, діагностики та криміналістики.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Полімеразна_ланцюгова_реакція',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'graphene-scotch-tape',
    article: {
      headline: 'Матеріал завтовшки в один атом, виділений скотчем',
      paragraphs: [
        'У 2004 році Андре Гейм і Костянтин Новосьолов відшаровували графіт клейкою стрічкою, поступово стоншуючи шар.',
        'Так вони отримали графен — двовимірний шар атомів вуглецю, розташованих у гексагональній ґратці, з винятковою міцністю та провідністю.',
      ],
      whyMatters: 'Відкриття графену принесло Нобелівську премію з фізики та відкрило нову галузь двовимірних матеріалів.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Графен',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'solvay-process',
    article: {
      headline: 'Промисловий спосіб добування соди, що витіснив усі інші',
      paragraphs: [
        'У 1861 році Ернест Сольве розробив цикл реакцій, який виробляє кальциновану соду з розсолу, вапняку та аміаку без витратних побічних продуктів.',
        'Процес виявився настільки ефективним, що майже повністю витіснив старіші методи виробництва соди вже до кінця XIX століття.',
      ],
      whyMatters: 'Содовий процес Сольве й досі є основним промисловим способом виробництва карбонату натрію.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Процес_Сольве',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
  {
    slug: 'pauling-chemical-bond',
    article: {
      headline: 'Хімік, що пояснив, чому атоми тримаються разом',
      paragraphs: [
        'У своїй роботі 1930-х років Лайнус Полінг застосував квантову механіку для опису природи хімічного зв\'язку.',
        'Він увів поняття електронегативності та гібридизації орбіталей, пояснивши форму й полярність молекул на основі математичної теорії.',
      ],
      whyMatters: 'Ця робота принесла Полінгу Нобелівську премію з хімії та досі є основою викладання будови молекул.',
      coinedTerm: null,
      url: 'https://uk.wikipedia.org/wiki/Лайнус_Полінг',
      sourceName: 'Історія хімії',
      imageUrl: null,
    },
  },
];
```

- [ ] **Step 4: Write `src/backlog.ts`**

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/backlog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backlogData.ts src/backlog.ts test/backlog.test.ts
git commit -m "feat: add 14-item evergreen backlog for total-pipeline-failure days"
```

---

## Task 10: Shared caption rendering

**Files:**
- Create: `src/caption.ts`
- Test: `test/caption.test.ts`

**Interfaces:**
- Consumes: `Article` (`src/types.ts`, Task 1).
- Produces: `renderCaptionHtml(article: Article): string`, `visibleLength(captionHtml: string): string` — consumed by `src/editor.ts` (Task 11) and `src/courier.ts` (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderCaptionHtml, visibleLength } from '../src/caption';
import { Article } from '../src/types';

const article: Article = {
  headline: 'Новий каталізатор для фіксації азоту',
  paragraphs: ['Перший абзац з описом.', 'Другий абзац з поясненням.'],
  whyMatters: 'Це важливо для агрохімії.',
  coinedTerm: null,
  url: 'https://example.com/article',
  sourceName: 'Chemistry World',
  imageUrl: 'https://example.com/img.jpg',
};

describe('renderCaptionHtml', () => {
  it('bolds the headline and the "why it matters" label, and links the source', () => {
    const html = renderCaptionHtml(article);
    expect(html).toContain('<b>Новий каталізатор для фіксації азоту</b>');
    expect(html).toContain('<b>Чому це важливо:</b> Це важливо для агрохімії.');
    expect(html).toContain('<a href="https://example.com/article">Джерело</a>');
    expect(html).toContain('Перший абзац з описом.');
  });

  it('escapes HTML-significant characters in generated text', () => {
    const withAmpersand: Article = { ...article, headline: 'Азот & кисень' };
    expect(renderCaptionHtml(withAmpersand)).toContain('Азот &amp; кисень');
  });
});

describe('visibleLength', () => {
  it('counts visible characters, not HTML tags', () => {
    expect(visibleLength('<b>abc</b>')).toBe(3);
    expect(visibleLength('<a href="https://x">Джерело</a>')).toBe(7);
  });

  it('stays comfortably under the Telegram hard cap for a realistic article', () => {
    expect(visibleLength(renderCaptionHtml(article))).toBeLessThan(1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/caption.test.ts`
Expected: FAIL with "Cannot find module '../src/caption'"

- [ ] **Step 3: Write `src/caption.ts`**

```typescript
import { Article } from './types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderCaptionHtml(article: Article): string {
  const paragraphsHtml = article.paragraphs.map(escapeHtml).join('\n\n');
  return [
    `<b>${escapeHtml(article.headline)}</b>`,
    '',
    paragraphsHtml,
    '',
    `<b>Чому це важливо:</b> ${escapeHtml(article.whyMatters)}`,
    '',
    `<a href="${article.url}">Джерело</a>`,
  ].join('\n');
}

export function visibleLength(captionHtml: string): number {
  return captionHtml.replace(/<[^>]+>/g, '').length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/caption.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/caption.ts test/caption.test.ts
git commit -m "feat: add shared caption rendering used by the editor's length check and the courier"
```

---

## Task 11: Editor

**Files:**
- Create: `src/articleFetch.ts`
- Create: `src/editor.ts`
- Test: `test/articleFetch.test.ts`
- Test: `test/editor.test.ts`
- Test fixtures: `test/fixtures/article-with-image.html`, `test/fixtures/article-no-image.html`

**Interfaces:**
- Consumes: `generateJson`, `ThinkingLevel` (`src/gemini.ts`, Task 7), `isUkrainianOnly` (`src/validation.ts`, Task 3), `renderCaptionHtml`, `visibleLength` (`src/caption.ts`, Task 10), `Candidate`, `Article` (`src/types.ts`, Task 1).
- Produces: `fetchArticleContent(url: string): Promise<FetchedArticle | null>` (`src/articleFetch.ts`), `edit(candidates: Candidate[], apiKey: string): Promise<Article | null>` (`src/editor.ts`) — consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write fixture HTML files**

`test/fixtures/article-with-image.html`:
```html
<html>
<head>
<meta property="og:image" content="https://cdn.example.com/nitrogen.jpg" />
</head>
<body>
<article>
<p>Дослідники розробили новий каталізатор на основі кобальту.</p>
<p>Він фіксує атмосферний азот за кімнатної температури, без високого тиску.</p>
</article>
</body>
</html>
```

`test/fixtures/article-no-image.html`:
```html
<html>
<head><title>No image here</title></head>
<body>
<article>
<p>A reaction mechanism was reinvestigated using isotope labeling.</p>
</article>
</body>
</html>
```

- [ ] **Step 2: Write the failing test for article fetching**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchArticleContent } from '../src/articleFetch';

const withImageHtml = readFileSync('test/fixtures/article-with-image.html', 'utf-8');
const noImageHtml = readFileSync('test/fixtures/article-no-image.html', 'utf-8');
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchArticleContent', () => {
  it('extracts og:image and paragraph text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(withImageHtml, { status: 200 }));
    const result = await fetchArticleContent('https://example.com/a');
    expect(result?.imageUrl).toBe('https://cdn.example.com/nitrogen.jpg');
    expect(result?.bodyText).toContain('кобальту');
    expect(result?.bodyText).toContain('кімнатної температури');
  });

  it('returns a null imageUrl when there is no og:image tag', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(noImageHtml, { status: 200 }));
    const result = await fetchArticleContent('https://example.com/b');
    expect(result?.imageUrl).toBeNull();
    expect(result?.bodyText).toContain('isotope labeling');
  });

  it('returns null when the fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));
    expect(await fetchArticleContent('https://example.com/c')).toBeNull();
  });

  it('returns null when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await fetchArticleContent('https://example.com/d')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/articleFetch.test.ts`
Expected: FAIL with "Cannot find module '../src/articleFetch'"

- [ ] **Step 4: Write `src/articleFetch.ts`**

```typescript
export interface FetchedArticle {
  bodyText: string;
  imageUrl: string | null;
}

export async function fetchArticleContent(url: string): Promise<FetchedArticle | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let imageUrl: string | null = null;
  const paragraphs: string[] = [];
  let currentParagraph = '';

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(el) {
        const content = el.getAttribute('content');
        if (content) imageUrl = content;
      },
    })
    .on('p', {
      element() {
        currentParagraph = '';
      },
      text(chunk) {
        currentParagraph += chunk.text;
        if (chunk.lastInTextNode) {
          const trimmed = currentParagraph.trim();
          if (trimmed) paragraphs.push(trimmed);
        }
      },
    });

  const transformed = rewriter.transform(res);
  await transformed.arrayBuffer();

  const bodyText = paragraphs.join('\n\n');
  if (!bodyText) return null;

  return { bodyText, imageUrl };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/articleFetch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing test for the editor**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { edit } from '../src/editor';
import * as gemini from '../src/gemini';
import * as articleFetch from '../src/articleFetch';
import { Candidate } from '../src/types';

const candidates: Candidate[] = [
  { url: 'https://x/a', title: 'A', blurb: 'blurb A', publishedAt: '2026-07-27', sourceName: 'Chemistry World' },
  { url: 'https://x/b', title: 'B', blurb: 'blurb B', publishedAt: '2026-07-26', sourceName: 'Chemistry World' },
];

const goodWritingResult = {
  headline: 'Заголовок',
  paragraphs: ['Перший абзац.', 'Другий абзац.'],
  why_matters: 'Тому що це важливо.',
  coined_term: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('edit', () => {
  it('selects a candidate, fetches its page, and returns the written article', async () => {
    vi.spyOn(gemini, 'generateJson')
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } })
      .mockResolvedValueOnce({ kind: 'ok', data: goodWritingResult });
    vi.spyOn(articleFetch, 'fetchArticleContent').mockResolvedValueOnce({
      bodyText: 'full article text',
      imageUrl: 'https://img/a.jpg',
    });

    const article = await edit(candidates, 'key');
    expect(article).not.toBeNull();
    expect(article?.headline).toBe('Заголовок');
    expect(article?.imageUrl).toBe('https://img/a.jpg');
    expect(article?.url).toBe('https://x/a');
  });

  it('returns null immediately when selection finds nothing worth sending', async () => {
    vi.spyOn(gemini, 'generateJson').mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: null } });
    expect(await edit(candidates, 'key')).toBeNull();
  });

  it('falls back to the RSS blurb when the article page fetch fails, and still succeeds', async () => {
    vi.spyOn(gemini, 'generateJson')
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } })
      .mockResolvedValueOnce({ kind: 'ok', data: goodWritingResult });
    vi.spyOn(articleFetch, 'fetchArticleContent').mockResolvedValueOnce(null);

    const article = await edit(candidates, 'key');
    expect(article).not.toBeNull();
    expect(article?.imageUrl).toBeNull();
  });

  it('drops a candidate the writer blocks and falls through to the next one', async () => {
    vi.spyOn(gemini, 'generateJson')
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } }) // selects A
      .mockResolvedValueOnce({ kind: 'blocked' }) // writing A is blocked
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } }) // re-selects from [B]
      .mockResolvedValueOnce({ kind: 'ok', data: goodWritingResult }); // writes B
    vi.spyOn(articleFetch, 'fetchArticleContent').mockResolvedValue({ bodyText: 'text', imageUrl: null });

    const article = await edit(candidates, 'key');
    expect(article?.url).toBe('https://x/b');
  });

  it('drops a candidate whose written body fails the Ukrainian-only check', async () => {
    const englishBody = { ...goodWritingResult, paragraphs: ['This paragraph is in English.'] };
    vi.spyOn(gemini, 'generateJson')
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } })
      .mockResolvedValueOnce({ kind: 'ok', data: englishBody })
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } })
      .mockResolvedValueOnce({ kind: 'ok', data: goodWritingResult });
    vi.spyOn(articleFetch, 'fetchArticleContent').mockResolvedValue({ bodyText: 'text', imageUrl: null });

    const article = await edit(candidates, 'key');
    expect(article?.url).toBe('https://x/b');
  });

  it('retries the writing call once on invalid JSON before falling through', async () => {
    vi.spyOn(gemini, 'generateJson')
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } })
      .mockResolvedValueOnce({ kind: 'error', status: 500 })
      .mockResolvedValueOnce({ kind: 'ok', data: goodWritingResult });
    vi.spyOn(articleFetch, 'fetchArticleContent').mockResolvedValue({ bodyText: 'text', imageUrl: null });

    const article = await edit(candidates, 'key');
    expect(article?.url).toBe('https://x/a'); // succeeded on retry, same candidate
  });

  it('asks the editor to shorten once when the caption is too long, then falls through if still over', async () => {
    const tooLong = { ...goodWritingResult, paragraphs: [Array(950).fill('а').join('')] };
    vi.spyOn(gemini, 'generateJson')
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } })
      .mockResolvedValueOnce({ kind: 'ok', data: tooLong }) // too long
      .mockResolvedValueOnce({ kind: 'ok', data: tooLong }) // still too long after shorten hint
      .mockResolvedValueOnce({ kind: 'ok', data: { selectedIndex: 0 } }) // re-select from [B]
      .mockResolvedValueOnce({ kind: 'ok', data: goodWritingResult });
    vi.spyOn(articleFetch, 'fetchArticleContent').mockResolvedValue({ bodyText: 'text', imageUrl: null });

    const article = await edit(candidates, 'key');
    expect(article?.url).toBe('https://x/b');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/editor.test.ts`
Expected: FAIL with "Cannot find module '../src/editor'"

- [ ] **Step 8: Write `src/editor.ts`**

```typescript
import { Article, Candidate } from './types';
import { generateJson } from './gemini';
import { fetchArticleContent } from './articleFetch';
import { isUkrainianOnly } from './validation';
import { renderCaptionHtml, visibleLength } from './caption';

const SELECTION_SCHEMA = {
  type: 'object',
  properties: { selectedIndex: { type: ['integer', 'null'] } },
  required: ['selectedIndex'],
  additionalProperties: false,
};

const WRITING_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' } },
    why_matters: { type: 'string' },
    coined_term: { type: ['string', 'null'] },
  },
  required: ['headline', 'paragraphs', 'why_matters', 'coined_term'],
  additionalProperties: false,
};

function buildSelectionPrompt(candidates: Candidate[]): string {
  const list = candidates.map((c, i) => `${i}. ${c.title} — ${c.blurb} (${c.sourceName})`).join('\n');
  return `Ти редактор хімічних новин для читачки-хімікині з багаторічним досвідом. З наведеного списку обери ЄДИНУ найкращу статтю для неї — актуальну, змістовну хімічну новину. Якщо жодна не годиться, поверни null.\n\n${list}`;
}

function buildWritingPrompt(candidate: Candidate, bodyText: string, shortenHint: boolean): string {
  const base = `Ти пишеш щоденне резюме хімічної новини українською мовою для читачки — дипломованої хімікині (вчителька, інженерка або лаборантка), близько 75 років.

Правила:
- Пиши для фахівчині. Називай сполуки та механізми. Не спрощуй.
- Лише українська мова. Жодних слів латиницею в тексті. Хімічні формули та одиниці СІ дозволені.
- Заголовок: не більше 8 слів.
- Текст: 2-4 абзаци, по 1-2 речення, без вкладених підрядних конструкцій.
- Використовуй усталену українську хімічну термінологію. Якщо доводиться вигадати термін, якого усталеної форми немає, познач це в coined_term.
- Загальний обсяг (без урахування форматування): не більше 900 символів.

Джерело (${candidate.sourceName}): ${candidate.title}

Текст статті:
${bodyText}`;
  return shortenHint ? `${base}\n\nПопередня спроба була занадто довгою. Скороти текст, зберігаючи зміст.` : base;
}

function passesUkrainianOnly(article: Article): boolean {
  return isUkrainianOnly([article.headline, ...article.paragraphs, article.whyMatters].join(' '));
}

async function writeArticle(
  candidate: Candidate,
  bodyText: string,
  imageUrl: string | null,
  apiKey: string,
  attempt = 1,
  shortenHint = false
): Promise<Article | null> {
  const result = await generateJson({
    apiKey,
    model: 'gemini-3-flash',
    prompt: buildWritingPrompt(candidate, bodyText, shortenHint),
    schema: WRITING_SCHEMA,
    thinkingLevel: 'high',
  });

  if (result.kind === 'blocked') return null;
  if (result.kind !== 'ok') {
    if (attempt < 2) return writeArticle(candidate, bodyText, imageUrl, apiKey, attempt + 1, shortenHint);
    return null;
  }

  const data = result.data as { headline: string; paragraphs: string[]; why_matters: string; coined_term: string | null };
  const article: Article = {
    headline: data.headline,
    paragraphs: data.paragraphs,
    whyMatters: data.why_matters,
    coinedTerm: data.coined_term,
    url: candidate.url,
    sourceName: candidate.sourceName,
    imageUrl,
  };

  if (!passesUkrainianOnly(article)) return null;

  if (visibleLength(renderCaptionHtml(article)) > 900) {
    if (!shortenHint) return writeArticle(candidate, bodyText, imageUrl, apiKey, 1, true);
    return null;
  }

  return article;
}

export async function edit(candidates: Candidate[], apiKey: string): Promise<Article | null> {
  let remaining = [...candidates];

  while (remaining.length > 0) {
    const selectionResult = await generateJson({
      apiKey,
      model: 'gemini-3-flash',
      prompt: buildSelectionPrompt(remaining),
      schema: SELECTION_SCHEMA,
      thinkingLevel: 'low',
    });

    if (selectionResult.kind !== 'ok') return null;
    const { selectedIndex } = selectionResult.data as { selectedIndex: number | null };
    if (selectedIndex === null || !remaining[selectedIndex]) return null;

    const chosen = remaining[selectedIndex];
    const fetched = await fetchArticleContent(chosen.url);
    const bodyText = fetched?.bodyText ?? chosen.blurb;
    const imageUrl = fetched?.imageUrl ?? null;

    const article = await writeArticle(chosen, bodyText, imageUrl, apiKey);
    if (article) return article;

    remaining = remaining.filter((c) => c.url !== chosen.url);
  }

  return null;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/editor.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 10: Commit**

```bash
git add src/articleFetch.ts src/editor.ts test/articleFetch.test.ts test/editor.test.ts test/fixtures/
git commit -m "feat: add editor with selection, article fetch, writing, and fall-through on any failure"
```

---

## Task 12: Courier

**Files:**
- Create: `src/courier.ts`
- Test: `test/courier.test.ts`

**Interfaces:**
- Consumes: `sendPhoto`, `sendMessage`, `READER_KEYBOARD` (`src/telegram.ts`, Task 6), `renderCaptionHtml` (`src/caption.ts`, Task 10), `Article` (`src/types.ts`, Task 1).
- Produces: `send(token: string, chatId: string, article: Article): Promise<number>` — consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { send } from '../src/courier';
import * as telegram from '../src/telegram';
import { Article } from '../src/types';

const articleWithImage: Article = {
  headline: 'Заголовок',
  paragraphs: ['Абзац один.', 'Абзац два.'],
  whyMatters: 'Це важливо.',
  coinedTerm: null,
  url: 'https://x/a',
  sourceName: 'Chemistry World',
  imageUrl: 'https://img/a.jpg',
};

const articleWithoutImage: Article = { ...articleWithImage, imageUrl: null };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('send', () => {
  it('sends exactly one sendPhoto call when an image is present', async () => {
    const sendPhotoSpy = vi.spyOn(telegram, 'sendPhoto').mockResolvedValueOnce({ ok: true, messageId: 5 });
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage');

    const messageId = await send('tok', '1', articleWithImage);

    expect(messageId).toBe(5);
    expect(sendPhotoSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('sends via sendMessage, with previews disabled, when there is no image', async () => {
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 6 });

    const messageId = await send('tok', '1', articleWithoutImage);

    expect(messageId).toBe(6);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to sendMessage when sendPhoto fails', async () => {
    vi.spyOn(telegram, 'sendPhoto').mockResolvedValueOnce({ ok: false });
    const sendMessageSpy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 7 });

    const messageId = await send('tok', '1', articleWithImage);

    expect(messageId).toBe(7);
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('retries sendMessage with backoff and succeeds on the third attempt', async () => {
    const spy = vi
      .spyOn(telegram, 'sendMessage')
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, messageId: 8 });

    const promise = send('tok', '1', articleWithoutImage);
    await vi.runAllTimersAsync();
    const messageId = await promise;

    expect(messageId).toBe(8);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all 5 attempts', async () => {
    vi.spyOn(telegram, 'sendMessage').mockResolvedValue({ ok: false });

    const promise = send('tok', '1', articleWithoutImage);
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('renders a caption under the Telegram hard cap with all three buttons on two rows', async () => {
    let capturedMarkup: unknown;
    vi.spyOn(telegram, 'sendPhoto').mockImplementationOnce(async (_token, params) => {
      capturedMarkup = params.replyMarkup;
      return { ok: true, messageId: 9 };
    });

    await send('tok', '1', articleWithImage);

    expect(capturedMarkup).toEqual({
      inline_keyboard: [
        [
          { text: '❤️ Подобається', callback_data: 'like' },
          { text: '👎 Не цікаво', callback_data: 'dislike' },
        ],
        [{ text: '🔍 Дізнатися більше', callback_data: 'more' }],
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/courier.test.ts`
Expected: FAIL with "Cannot find module '../src/courier'"

- [ ] **Step 3: Write `src/courier.ts`**

```typescript
import { Article } from './types';
import { renderCaptionHtml } from './caption';
import { sendPhoto, sendMessage, READER_KEYBOARD } from './telegram';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(2 ** i * 500);
    }
  }
  throw lastError;
}

export async function send(token: string, chatId: string, article: Article): Promise<number> {
  const captionHtml = renderCaptionHtml(article);

  if (article.imageUrl) {
    const result = await sendPhoto(token, {
      chatId,
      photoUrl: article.imageUrl,
      captionHtml,
      replyMarkup: READER_KEYBOARD,
    });
    if (result.ok && result.messageId) return result.messageId;
  }

  const result = await withRetries(async () => {
    const r = await sendMessage(token, { chatId, textHtml: captionHtml, replyMarkup: READER_KEYBOARD });
    if (!r.ok || !r.messageId) throw new Error('sendMessage returned not-ok');
    return r;
  }, 5);

  return result.messageId!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/courier.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/courier.ts test/courier.test.ts
git commit -m "feat: add courier with image-to-text fallback and retry-with-backoff on send failure"
```

---

## Task 13: Feedback webhook handler

**Files:**
- Create: `src/feedback.ts`
- Test: `test/feedback.test.ts`

**Interfaces:**
- Consumes: `getSentByMessageId`, `upsertFeedback`, `FeedbackButton` (`src/db.ts`, Task 4), `answerCallbackQuery`, `isValidSecretToken` (`src/telegram.ts`, Task 6), `isUkrainianOnly` (`src/validation.ts`, Task 3).
- Produces: `handleWebhook(request: Request, db: D1Database, botToken: string, webhookSecret: string): Promise<Response>` — consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { handleWebhook, TOAST_TEXT } from '../src/feedback';
import { recordSent, getFeedbackBetween } from '../src/db';
import { isUkrainianOnly } from '../src/validation';
import * as telegram from '../src/telegram';

const originalFetch = global.fetch;

beforeEach(async () => {
  await applySchema(env.DB);
  vi.restoreAllMocks();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function webhookRequest(body: unknown, secret = 'shh'): Request {
  return new Request('https://worker.example/webhook', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleWebhook', () => {
  it('rejects a request with a wrong or missing secret token and writes nothing', async () => {
    const res = await handleWebhook(webhookRequest({}, 'wrong'), env.DB, 'tok', 'shh');
    expect(res.status).toBe(401);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it.each(['like', 'dislike', 'more'] as const)('records a %s tap against the sent article', async (button) => {
    await recordSent(env.DB, { sendDate: '2026-07-27', url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    const answerSpy = vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValueOnce();

    const res = await handleWebhook(
      webhookRequest({ callback_query: { id: 'cbq-1', data: button, message: { message_id: 42 } } }),
      env.DB,
      'tok',
      'shh'
    );

    expect(res.status).toBe(200);
    const rows = await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01');
    expect(rows).toEqual([{ sendDate: '2026-07-27', button }]);
    expect(answerSpy).toHaveBeenCalledWith('tok', 'cbq-1', TOAST_TEXT[button]);
  });

  it('replaces rather than duplicates on a second, different tap for the same article', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-27', url: 'https://x/a', messageId: 42, headline: 'H', coinedTerm: null, sentAt: '2026-07-27T08:00:00Z' });
    vi.spyOn(telegram, 'answerCallbackQuery').mockResolvedValue();

    await handleWebhook(webhookRequest({ callback_query: { id: 'cbq-1', data: 'like', message: { message_id: 42 } } }), env.DB, 'tok', 'shh');
    await handleWebhook(webhookRequest({ callback_query: { id: 'cbq-2', data: 'dislike', message: { message_id: 42 } } }), env.DB, 'tok', 'shh');

    const rows = await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01');
    expect(rows).toEqual([{ sendDate: '2026-07-27', button: 'dislike' }]);
  });

  it('acknowledges an update that is not a recognized feedback tap without writing anything', async () => {
    const res = await handleWebhook(webhookRequest({ message: { text: 'hello' } }), env.DB, 'tok', 'shh');
    expect(res.status).toBe(200);
    expect(await getFeedbackBetween(env.DB, '2000-01-01', '2100-01-01')).toEqual([]);
  });

  it('every toast is Ukrainian only', () => {
    for (const text of Object.values(TOAST_TEXT)) {
      expect(isUkrainianOnly(text)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/feedback.test.ts`
Expected: FAIL with "Cannot find module '../src/feedback'"

- [ ] **Step 3: Write `src/feedback.ts`**

```typescript
import { FeedbackButton, getSentByMessageId, upsertFeedback } from './db';
import { answerCallbackQuery, isValidSecretToken } from './telegram';

interface TelegramUpdate {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number };
  };
}

export const TOAST_TEXT: Record<FeedbackButton, string> = {
  like: 'Дякую!',
  dislike: 'Зрозуміло, врахую.',
  more: 'Дякую! Автору передано — очікуйте більше про цю тему.',
};

function isFeedbackButton(value: string | undefined): value is FeedbackButton {
  return value === 'like' || value === 'dislike' || value === 'more';
}

export async function handleWebhook(
  request: Request,
  db: D1Database,
  botToken: string,
  webhookSecret: string
): Promise<Response> {
  if (!isValidSecretToken(request, webhookSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const callback = update.callback_query;
  if (!callback || !isFeedbackButton(callback.data)) {
    return new Response('ok');
  }

  const messageId = callback.message?.message_id;
  if (messageId !== undefined) {
    const sentRow = await getSentByMessageId(db, messageId);
    if (sentRow) {
      await upsertFeedback(db, sentRow.sendDate, callback.data, new Date().toISOString());
    }
  }

  await answerCallbackQuery(botToken, callback.id, TOAST_TEXT[callback.data]);
  return new Response('ok');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/feedback.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/feedback.ts test/feedback.test.ts
git commit -m "feat: add feedback webhook handler with secret-token check and upsert semantics"
```

---

## Task 14: Weekly digest

**Files:**
- Create: `src/digest.ts`
- Test: `test/digest.test.ts`

**Interfaces:**
- Consumes: `getSentBetween`, `getFeedbackBetween`, `SentRow`, `FeedbackButton` (`src/db.ts`, Task 4), `sendMessage` (`src/telegram.ts`, Task 6).
- Produces: `sendWeeklyDigest(db: D1Database, botToken: string, authorChatId: string, now: Date): Promise<void>` — consumed by `src/index.ts` in Task 15.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { applySchema } from './setup';
import { sendWeeklyDigest } from '../src/digest';
import { recordSent, upsertFeedback } from '../src/db';
import * as telegram from '../src/telegram';

beforeEach(async () => {
  await applySchema(env.DB);
  vi.restoreAllMocks();
});

describe('sendWeeklyDigest', () => {
  it('sends the author a summary of the past week, including coined terms and taps', async () => {
    await recordSent(env.DB, { sendDate: '2026-07-21', url: 'https://x/1', messageId: 1, headline: 'Заголовок 1', coinedTerm: 'нанопора', sentAt: '2026-07-21T08:00:00Z' });
    await recordSent(env.DB, { sendDate: '2026-07-25', url: 'https://x/2', messageId: 2, headline: 'Заголовок 2', coinedTerm: null, sentAt: '2026-07-25T08:00:00Z' });
    await upsertFeedback(env.DB, '2026-07-25', 'like', '2026-07-25T09:00:00Z');

    const spy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 99 });

    await sendWeeklyDigest(env.DB, 'tok', 'author-chat', new Date('2026-07-26T17:00:00Z'));

    expect(spy).toHaveBeenCalledTimes(1);
    const [, params] = spy.mock.calls[0];
    expect(params.chatId).toBe('author-chat');
    expect(params.textHtml).toContain('Заголовок 1');
    expect(params.textHtml).toContain('нанопора');
    expect(params.textHtml).toContain('Заголовок 2');
  });

  it('sends nothing but an empty-week message when there is no sent history', async () => {
    const spy = vi.spyOn(telegram, 'sendMessage').mockResolvedValueOnce({ ok: true, messageId: 100 });
    await sendWeeklyDigest(env.DB, 'tok', 'author-chat', new Date('2026-07-26T17:00:00Z'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/digest.test.ts`
Expected: FAIL with "Cannot find module '../src/digest'"

- [ ] **Step 3: Write `src/digest.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/digest.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/digest.ts test/digest.test.ts
git commit -m "feat: add weekly author digest of sent articles, taps, and coined terms"
```

---

## Task 15: Main orchestration

**Files:**
- Modify: `src/index.ts`
- Test: `test/index.test.ts` (expand the smoke test from Task 1)

**Interfaces:**
- Consumes: everything from Tasks 2–14: `validateConfig` (`config.ts`), `shouldRunPipeline`, `isDigestTick` (`scheduling.ts`), `collect` (`collector.ts`), `edit` (`editor.ts`), `send` (`courier.ts`), `handleWebhook` (`feedback.ts`), `sendWeeklyDigest` (`digest.ts`), `recordSent`, `pruneSeenOlderThan` (`db.ts`), `pickBacklogItem` (`backlog.ts`), `sendMessage` (`telegram.ts`).
- Produces: the deployed Worker's `scheduled` and `fetch` handlers — the final integration point; nothing downstream consumes this directly except Task 16's deployment.

- [ ] **Step 1: Write the failing end-to-end test**

This exercises the full pipeline through mocked `fetch` calls only (RSS, Gemini, Telegram), proving §8's fallback chain and §9's idempotency requirement (24 hourly ticks on one date produce exactly one send) against the real Worker entry point.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { applySchema } from './setup';
import worker from '../src/index';
import { getSentForDate } from '../src/db';
import { FEED_SOURCES } from '../src/collector';

const chemistryWorldXml = readFileSync('test/fixtures/chemistry-world.xml', 'utf-8');
const originalFetch = global.fetch;

function geminiOkResponse(data: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] }), { status: 200 });
}

beforeEach(async () => {
  await applySchema(env.DB);
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('scheduled pipeline', () => {
  it('sends exactly one message across 24 hourly ticks on the same Kyiv date', async () => {
    let telegramSendCount = 0;
    let geminiCallCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === FEED_SOURCES.find((s) => s.tier === 'core')!.url) {
        return new Response(chemistryWorldXml, { status: 200 });
      }
      if (FEED_SOURCES.some((s) => s.url === url)) {
        return new Response('', { status: 500 }); // other core/widening feeds fail — collector skips them
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiCallCount++;
        if (geminiCallCount === 1) return geminiOkResponse({ selectedIndex: 0 }); // selection
        return geminiOkResponse({
          headline: 'Заголовок',
          paragraphs: ['Перший абзац.', 'Другий абзац.'],
          why_matters: 'Це важливо.',
          coined_term: null,
        }); // writing
      }
      if (url.includes('api.telegram.org')) {
        telegramSendCount++;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), { status: 200 });
      }
      if (url.includes('example.com')) {
        return new Response('<html><body><p>Article body text for the writer.</p></body></html>', { status: 200 });
      }
      return new Response('', { status: 500 });
    });

    // 2026-07-27 in Kyiv (EEST, +3): 08:00 Kyiv = 05:00 UTC. Simulate all 24 hourly ticks.
    for (let utcHour = 0; utcHour < 24; utcHour++) {
      const now = new Date(Date.UTC(2026, 6, 27, utcHour, 0, 0));
      const ctx = createExecutionContext();
      await worker.scheduled({ cron: '0 * * * *', scheduledTime: now.getTime() } as ScheduledEvent, env, ctx);
      await waitOnExecutionContext(ctx);
    }

    expect(telegramSendCount).toBe(1);
    expect(await getSentForDate(env.DB, '2026-07-27')).not.toBeNull();
  });

  it('alerts the author when config is invalid, and does not crash', async () => {
    const brokenEnv = { ...env, GEMINI_API_KEY: '' };
    let alertSent = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().includes('api.telegram.org')) {
        alertSent = true;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      return new Response('', { status: 500 });
    });

    const ctx = createExecutionContext();
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: Date.now() } as ScheduledEvent, brokenEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(alertSent).toBe(true);
  });
});

describe('fetch handler', () => {
  it('routes POST /webhook to the feedback handler', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const request = new Request('https://worker.example/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });

  it('returns 200 ok for any other path', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://worker.example/'), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — the placeholder `scheduled` handler from Task 1 does nothing, so no message is sent and `getSentForDate` returns null.

- [ ] **Step 3: Write the real `src/index.ts`**

```typescript
import { Env } from './types';
import { validateConfig, ConfigError } from './config';
import { shouldRunPipeline, isDigestTick } from './scheduling';
import { collect } from './collector';
import { edit } from './editor';
import { send } from './courier';
import { handleWebhook } from './feedback';
import { sendWeeklyDigest } from './digest';
import { recordSent, pruneSeenOlderThan } from './db';
import { pickBacklogItem } from './backlog';
import { sendMessage } from './telegram';

async function alertAuthor(env: Env, message: string): Promise<void> {
  await sendMessage(env.TELEGRAM_BOT_TOKEN, {
    chatId: env.AUTHOR_CHAT_ID,
    textHtml: message,
    replyMarkup: { inline_keyboard: [] },
  });
}

async function runDailyPipeline(env: Env, sendDate: string, now: Date): Promise<void> {
  let article = null;
  let sentUrl: string | null = null;

  const coreCandidates = await collect(env.DB, 'core', now);
  if (coreCandidates.length > 0) {
    article = await edit(coreCandidates, env.GEMINI_API_KEY);
  }

  if (!article) {
    const wideningCandidates = await collect(env.DB, 'widening', now);
    if (wideningCandidates.length > 0) {
      article = await edit(wideningCandidates, env.GEMINI_API_KEY);
    }
  }

  if (article) {
    sentUrl = article.url;
  } else {
    const backlogPick = await pickBacklogItem(env.DB, now);
    if (backlogPick) {
      article = backlogPick.article;
      sentUrl = `backlog:${backlogPick.slug}`;
    }
  }

  if (!article || !sentUrl) {
    await alertAuthor(env, `ALERT: no article could be produced for ${sendDate} (feeds, widening, and backlog all failed)`);
    return;
  }

  let messageId: number;
  try {
    messageId = await send(env.TELEGRAM_BOT_TOKEN, env.READER_CHAT_ID, article);
  } catch (err) {
    await alertAuthor(env, `ALERT: Telegram send failed for ${sendDate}: ${(err as Error).message}`);
    return;
  }

  await recordSent(env.DB, {
    sendDate,
    url: sentUrl,
    messageId,
    headline: article.headline,
    coinedTerm: article.coinedTerm,
    sentAt: now.toISOString(),
  });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      validateConfig(env);
    } catch (err) {
      if (env.TELEGRAM_BOT_TOKEN && env.AUTHOR_CHAT_ID) {
        await alertAuthor(env, `ALERT: configuration error: ${(err as ConfigError).message}`);
      }
      return;
    }

    const now = new Date();

    const { run, sendDate } = await shouldRunPipeline(env.DB, env.TIMEZONE, Number(env.SEND_HOUR), now);
    if (run) {
      ctx.waitUntil(runDailyPipeline(env, sendDate, now));
    }

    if (isDigestTick(env.TIMEZONE, now)) {
      ctx.waitUntil(sendWeeklyDigest(env.DB, env.TELEGRAM_BOT_TOKEN, env.AUTHOR_CHAT_ID, now));
    }

    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      ctx.waitUntil(pruneSeenOlderThan(env.DB, cutoff));
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env.DB, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET);
    }
    return new Response('ok');
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/index.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all tests across every task)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: wire the full daily pipeline with Kyiv-time gating, fallback chain, and webhook routing"
```

---

## Task 16: Deployment and operational setup

**Files:**
- Modify: `wrangler.toml` (fill in real IDs from this task's steps)
- No new source files — this task is operational, per spec §10.

**Interfaces:**
- Consumes: the deployed Worker from Task 15.
- Produces: a live, reachable bot. Nothing downstream in this repo depends on it.

- [ ] **Step 1: Create the D1 database and record its ID**

```bash
npx wrangler login
npx wrangler d1 create khimiya-shchodnya-db
```

Copy the `database_id` from the output into `wrangler.toml`'s `[[d1_databases]]` block, replacing the placeholder from Task 1.

- [ ] **Step 2: Apply the schema to the remote database**

```bash
npx wrangler d1 execute khimiya-shchodnya-db --remote --file=schema.sql
```

- [ ] **Step 3: Create the Google AI Studio key in a dedicated, billing-disabled project**

Create a new Google Cloud project used for nothing else. Generate a Gemini API key in AI Studio against that project. Confirm billing is not enabled on the project — leave it that way permanently (spec §5.2, §10).

- [ ] **Step 4: Create the Telegram bot via BotFather**

Message @BotFather, run `/newbot`, and record the token it gives you.

- [ ] **Step 5: Set all three secrets**

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

For `TELEGRAM_WEBHOOK_SECRET`, generate a random string yourself (e.g. `openssl rand -hex 32`) rather than typing one — it is checked on every webhook request per spec §7.

- [ ] **Step 6: Deploy the Worker**

```bash
npx wrangler deploy
```

Record the `*.workers.dev` URL Wrangler prints.

- [ ] **Step 7: Register the Telegram webhook**

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url": "https://<your-worker>.workers.dev/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

- [ ] **Step 8: Get the reader's chat ID**

Open the bot on her phone and have her tap Start (or do it yourself for now). Then run:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates"
```

Find the `chat.id` in the response. Update `READER_CHAT_ID` in `wrangler.toml`, and do the same for your own chat ID as `AUTHOR_CHAT_ID`. Redeploy:

```bash
npx wrangler deploy
```

- [ ] **Step 9: Dry-run the pipeline locally before her first real message**

```bash
npx wrangler dev --test-scheduled
```

In another terminal:

```bash
curl "http://localhost:8787/__scheduled"
```

Read the console output. Repeat this for a few different simulated days (adjust the local system clock is not needed — instead temporarily hardcode `now` in `runDailyPipeline` to different dates, run, then revert) until you have a week's worth of output to review.

- [ ] **Step 10: Review a week of dry-run output before handing it over**

Per spec §10: read the week of dry-run summaries yourself, or have someone who reads Ukrainian chemistry read them. This is the cheapest point to catch the free-tier nomenclature risk documented in spec §5.2 — before she is reading it every morning.

- [ ] **Step 11: Set up her phone**

1. Telegram → Налаштування → Розмір тексту → set to a large value.
2. Telegram → Налаштування → set the light theme.
3. Pin the bot's chat to the top of her chat list.
4. Confirm notifications for the chat are enabled.

- [ ] **Step 12: Send one real dry-run-reviewed message and watch her read it**

Trigger the pipeline for real (wait for the next hourly tick, or temporarily set `SEND_HOUR` to the current hour and redeploy), confirm the message arrives, is legible at her font size, and that both the image and the three buttons render correctly.

- [ ] **Step 13: Commit the final `wrangler.toml` with real IDs**

```bash
git add wrangler.toml
git commit -m "chore: record deployed D1 database ID and chat IDs"
```

---

## Self-Review

**Spec coverage** — every numbered section of the spec maps to a task:
- §1–§3 (what/reader/behaviour) → shape the whole plan, most directly the editor prompt (Task 11) and courier layout (Task 12).
- §4 (decisions) → each row maps to a task: delivery/Telegram → Task 6; language → Task 3; editorial gate → Task 11 (fully automatic); content scope → Task 8; images → Task 12; summaries → Task 11; writer → Task 7; host → Tasks 1, 4, 16; TypeScript → whole project.
- §5.1 collector → Task 8 (feed list, 7-day eligibility window, tier gating).
- §5.2 editor → Task 11 (schema, `coined_term`, nomenclature-risk prompt wording, safety settings via Task 7, caption-length retry).
- §5.3 courier → Task 12 (single message, link-preview rule, two-row buttons, image→text fallback, no generated card, retry-with-backoff).
- §5.4 feedback → Task 13 (three buttons, upsert idempotency, toast copy including `more`'s honest promise) + Task 14 (digest that makes that promise true).
- §5.5 data → Task 1 (schema) + Task 4 (queries) + Task 4's prune test.
- §6 Ukrainian-only rule → Task 3 (validator) + Task 11 (integration) + Task 13 (toast-text test).
- §7 scheduling/hosting → Task 1 (wrangler.toml, cron, vars) + Task 5 (DST-safe gating, the exact test the spec calls out) + Task 16 (secrets, webhook, deployment).
- §8 error handling → distributed: feed failures (Task 8), writing/blocked/invalid-JSON/caption-length/Ukrainian-validation (Task 11), image-send failure (Task 12), webhook secret check (Task 13), backlog/alert/idempotency (Task 15).
- §9 testing table → each row has a corresponding task: Збирач (8), Редактор (11), Кур'єр (12), Відгук (13), Scheduling (5), Backlog (9), Config (2), Idempotency (15), End-to-end/dry-run (16 step 9).
- §10 setup checklist → Task 16, in full, including the "read a week of output before handing it over" step.
- §11 cost → no code required; reflected in the free-tier-only choices throughout (Gemini free tier in Task 7, Cloudflare free plan in Task 1).
- §12 out of scope → correctly has no task.

**Placeholder scan** — no "TBD"/"TODO"/"add appropriate error handling" phrasing anywhere; every step has literal code or a literal, runnable command. The one deliberately-fake value is the D1 `database_id` and chat-ID vars in `wrangler.toml` (Task 1), each with a comment naming exactly which later task replaces it — that is standard Wrangler workflow, not a deferred implementation detail.

**Type consistency** — checked across tasks: `Candidate`, `Article`, `Tier`, `Env` (Task 1) are used identically in Tasks 8, 11, 12, 15. `SentRow`, `FeedbackButton` (Task 4) match their usage in Tasks 8, 13, 14, 15. `generateJson`'s `GenerateJsonResult` tags (`ok`/`blocked`/`quota_exceeded`/`error`) from Task 7 are matched exactly by the `kind` checks in Task 11's `writeArticle`. `renderCaptionHtml`/`visibleLength` (Task 10) are called with the same signatures in Tasks 11 and 12. `sendPhoto`/`sendMessage`'s `SendResult` shape (Task 6) matches how Task 12's `courier.ts` reads `result.ok`/`result.messageId`. `pickBacklogItem`'s return type (Task 9) matches its destructuring in Task 15's `runDailyPipeline`.
