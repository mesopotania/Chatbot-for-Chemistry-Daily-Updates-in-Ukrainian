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
