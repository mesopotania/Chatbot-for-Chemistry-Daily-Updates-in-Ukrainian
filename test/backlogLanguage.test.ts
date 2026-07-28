import { describe, it, expect } from 'vitest';
import { BACKLOG_ITEMS } from '../src/backlogData';
import { isUkrainianOnly, findDisallowedLatinTokens } from '../src/validation';

describe('backlog language', () => {
  it.each(BACKLOG_ITEMS.map((item) => [item.slug, item] as const))(
    '%s is Ukrainian only',
    (_slug, item) => {
      const fullText = [item.article.headline, ...item.article.paragraphs, item.article.whyMatters].join(' ');
      expect(findDisallowedLatinTokens(fullText)).toEqual([]);
      expect(isUkrainianOnly(fullText)).toBe(true);
    }
  );
});
