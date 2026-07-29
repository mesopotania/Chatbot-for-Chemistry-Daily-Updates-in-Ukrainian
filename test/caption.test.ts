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
    expect(html).toContain('🔗 <a href="https://example.com/article">Читати повністю</a>');
    expect(html).toContain('Перший абзац з описом.');
  });

  it('escapes HTML-significant characters in generated text', () => {
    const withAmpersand: Article = { ...article, headline: 'Азот & кисень' };
    expect(renderCaptionHtml(withAmpersand)).toContain('Азот &amp; кисень');
  });

  it('converts **key info** markers into <b> tags in body and why-it-matters', () => {
    const highlighted: Article = {
      ...article,
      paragraphs: ['Реакція дала **вихід 92%** за кімнатної температури.'],
      whyMatters: 'Це **дешевший** шлях до аміаку.',
    };
    const html = renderCaptionHtml(highlighted);
    expect(html).toContain('Реакція дала <b>вихід 92%</b> за кімнатної температури.');
    expect(html).toContain('Це <b>дешевший</b> шлях до аміаку.');
  });

  it('escapes HTML before applying bold markers, so markup cannot be injected', () => {
    const injection: Article = {
      ...article,
      paragraphs: ['Небезпечний **<script>** фрагмент.'],
    };
    const html = renderCaptionHtml(injection);
    expect(html).toContain('<b>&lt;script&gt;</b>');
    expect(html).not.toContain('<script>');
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
