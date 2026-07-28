import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchArticleContent } from '../src/articleFetch';
import withImageHtml from './fixtures/article-with-image.html?raw';
import noImageHtml from './fixtures/article-no-image.html?raw';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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
