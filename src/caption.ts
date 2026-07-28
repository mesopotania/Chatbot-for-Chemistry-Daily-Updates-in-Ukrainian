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
