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
