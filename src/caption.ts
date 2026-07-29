import { Article } from './types';
import { subscriptChemicalFormulas } from './validation';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Escapes HTML, normalises chemical formulas to Unicode subscripts, then
// converts the model's **key info** markers into <b> tags. Escaping runs first,
// so nothing the model wrote can inject markup; only the literal ** pairs we
// asked for become bold.
export function renderInline(s: string): string {
  return subscriptChemicalFormulas(escapeHtml(s)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

export function renderCaptionHtml(article: Article): string {
  const paragraphsHtml = article.paragraphs.map(renderInline).join('\n\n');
  const lines = [
    `<b>${subscriptChemicalFormulas(escapeHtml(article.headline))}</b>`,
    '',
    paragraphsHtml,
    '',
    `<b>Чому це важливо:</b> ${renderInline(article.whyMatters)}`,
  ];

  if (article.keywords && article.keywords.length > 0) {
    const tags = article.keywords.map((k) => renderInline(k)).join(' · ');
    lines.push('', `<b>🔑 Ключові слова:</b> ${tags}`);
  }

  lines.push('', `🔗 <a href="${article.url}">Читати повністю</a>`);
  return lines.join('\n');
}

export function visibleLength(captionHtml: string): number {
  return captionHtml.replace(/<[^>]+>/g, '').length;
}
