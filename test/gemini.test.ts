import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateJson } from '../src/gemini';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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
