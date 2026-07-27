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
