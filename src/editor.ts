import { Article, Candidate } from './types';
import { generateJson } from './gemini';
import { fetchArticleContent } from './articleFetch';
import { isUkrainianOnly } from './validation';
import { renderCaptionHtml, visibleLength } from './caption';

const SELECTION_SCHEMA = {
  type: 'object',
  properties: { selectedIndex: { type: ['integer', 'null'] } },
  required: ['selectedIndex'],
  additionalProperties: false,
};

const WRITING_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' } },
    why_matters: { type: 'string' },
    coined_term: { type: ['string', 'null'] },
  },
  required: ['headline', 'paragraphs', 'why_matters', 'coined_term'],
  additionalProperties: false,
};

function buildSelectionPrompt(candidates: Candidate[]): string {
  const list = candidates.map((c, i) => `${i}. ${c.title} — ${c.blurb} (${c.sourceName})`).join('\n');
  return `Ти редактор хімічних новин для читачки-хімікині з багаторічним досвідом. З наведеного списку обери ЄДИНУ найкращу статтю для неї — актуальну, змістовну хімічну новину. Якщо жодна не годиться, поверни null.\n\n${list}`;
}

function buildWritingPrompt(candidate: Candidate, bodyText: string, shortenHint: boolean): string {
  const base = `Ти пишеш щоденне резюме хімічної новини українською мовою для читачки — дипломованої хімікині (вчителька, інженерка або лаборантка), близько 75 років.

Правила:
- Пиши для фахівчині. Називай сполуки та механізми. Не спрощуй.
- Лише українська мова. Жодних слів латиницею в тексті. Хімічні формули та одиниці СІ дозволені.
- Заголовок: не більше 8 слів.
- Текст: 2-4 абзаци, по 1-2 речення, без вкладених підрядних конструкцій.
- Використовуй усталену українську хімічну термінологію. Якщо доводиться вигадати термін, якого усталеної форми немає, познач це в coined_term.
- Загальний обсяг (без урахування форматування): не більше 900 символів.

Джерело (${candidate.sourceName}): ${candidate.title}

Текст статті:
${bodyText}`;
  return shortenHint ? `${base}\n\nПопередня спроба була занадто довгою. Скороти текст, зберігаючи зміст.` : base;
}

function passesUkrainianOnly(article: Article): boolean {
  return isUkrainianOnly([article.headline, ...article.paragraphs, article.whyMatters].join(' '));
}

async function writeArticle(
  candidate: Candidate,
  bodyText: string,
  imageUrl: string | null,
  apiKey: string,
  attempt = 1,
  shortenHint = false
): Promise<Article | null> {
  const result = await generateJson({
    apiKey,
    model: 'gemini-3-flash',
    prompt: buildWritingPrompt(candidate, bodyText, shortenHint),
    schema: WRITING_SCHEMA,
    thinkingLevel: 'high',
  });

  if (result.kind === 'blocked') return null;
  if (result.kind !== 'ok') {
    if (attempt < 2) return writeArticle(candidate, bodyText, imageUrl, apiKey, attempt + 1, shortenHint);
    return null;
  }

  const data = result.data as { headline: string; paragraphs: string[]; why_matters: string; coined_term: string | null };
  const article: Article = {
    headline: data.headline,
    paragraphs: data.paragraphs,
    whyMatters: data.why_matters,
    coinedTerm: data.coined_term,
    url: candidate.url,
    sourceName: candidate.sourceName,
    imageUrl,
  };

  if (!passesUkrainianOnly(article)) return null;

  if (visibleLength(renderCaptionHtml(article)) > 900) {
    if (!shortenHint) return writeArticle(candidate, bodyText, imageUrl, apiKey, 1, true);
    return null;
  }

  return article;
}

export async function edit(candidates: Candidate[], apiKey: string): Promise<Article | null> {
  let remaining = [...candidates];

  while (remaining.length > 0) {
    const selectionResult = await generateJson({
      apiKey,
      model: 'gemini-3-flash',
      prompt: buildSelectionPrompt(remaining),
      schema: SELECTION_SCHEMA,
      thinkingLevel: 'low',
    });

    if (selectionResult.kind !== 'ok') return null;
    const { selectedIndex } = selectionResult.data as { selectedIndex: number | null };
    if (selectedIndex === null || !remaining[selectedIndex]) return null;

    const chosen = remaining[selectedIndex];
    const fetched = await fetchArticleContent(chosen.url);
    const bodyText = fetched?.bodyText ?? chosen.blurb;
    const imageUrl = fetched?.imageUrl ?? null;

    const article = await writeArticle(chosen, bodyText, imageUrl, apiKey);
    if (article) return article;

    remaining = remaining.filter((c) => c.url !== chosen.url);
  }

  return null;
}
