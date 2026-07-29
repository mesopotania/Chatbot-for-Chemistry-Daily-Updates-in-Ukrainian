import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { applySchema } from './setup';
import worker from '../src/index';
import { getSentForDate, addRecipient } from '../src/db';
import { FEED_SOURCES } from '../src/collector';
import chemistryWorldXml from './fixtures/chemistry-world.xml?raw';

const originalFetch = globalThis.fetch;

function geminiOkResponse(data: unknown) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] }),
    { status: 200 }
  );
}

beforeEach(async () => {
  await applySchema(env.DB);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('scheduled pipeline', () => {
  it('sends exactly one message across 24 hourly ticks on the same Kyiv date', async () => {
    await addRecipient(env.DB, '373430678', null, '2026-07-01T00:00:00Z');
    let telegramSendCount = 0;
    let geminiCallCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === FEED_SOURCES.find((s) => s.tier === 'core')!.url) {
        return new Response(chemistryWorldXml, { status: 200 });
      }
      if (FEED_SOURCES.some((s) => s.url === url)) {
        return new Response('', { status: 500 });
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiCallCount++;
        if (geminiCallCount === 1) return geminiOkResponse({ selectedIndex: 0 });
        return geminiOkResponse({
          headline: 'Заголовок',
          paragraphs: ['Перший абзац.', 'Другий абзац.'],
          why_matters: 'Це важливо.',
          coined_term: null,
        });
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

  it('does nothing (no send, no crash) when nobody has activated yet', async () => {
    let telegramSendCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().includes('api.telegram.org')) telegramSendCount++;
      return new Response('', { status: 500 });
    });
    const now = new Date(Date.UTC(2026, 6, 27, 6, 0, 0)); // 09:00 Kyiv (SEND_HOUR)
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: now.getTime() } as ScheduledEvent, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(telegramSendCount).toBe(0);
  });

  it('fans the same article out to every registered recipient', async () => {
    await addRecipient(env.DB, '100', 'Grandma', '2026-07-01T00:00:00Z');
    await addRecipient(env.DB, '200', 'Friend', '2026-07-01T00:00:01Z');
    let geminiCallCount = 0;
    const telegramChatIds: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === FEED_SOURCES.find((s) => s.tier === 'core')!.url) {
        return new Response(chemistryWorldXml, { status: 200 });
      }
      if (FEED_SOURCES.some((s) => s.url === url)) return new Response('', { status: 500 });
      if (url.includes('generativelanguage.googleapis.com')) {
        geminiCallCount++;
        if (geminiCallCount === 1) return geminiOkResponse({ selectedIndex: 0 });
        return geminiOkResponse({
          headline: 'Заголовок',
          paragraphs: ['Перший абзац.'],
          why_matters: 'Це важливо.',
          keywords: ['хімія'],
          coined_term: null,
        });
      }
      if (url.includes('api.telegram.org')) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        telegramChatIds.push(String(body.chat_id));
        return new Response(JSON.stringify({ ok: true, result: { message_id: telegramChatIds.length } }), { status: 200 });
      }
      if (url.includes('example.com')) {
        return new Response('<html><body><p>Article body text.</p></body></html>', { status: 200 });
      }
      return new Response('', { status: 500 });
    });

    const now = new Date(Date.UTC(2026, 6, 27, 6, 0, 0)); // 09:00 Kyiv (SEND_HOUR)
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: now.getTime() } as ScheduledEvent, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(telegramChatIds.sort()).toEqual(['100', '200']);
  });

  it('alerts the author when config is invalid, and does not crash', async () => {
    const brokenEnv = { ...env, GEMINI_API_KEY: '' };
    let alertSent = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
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
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
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
