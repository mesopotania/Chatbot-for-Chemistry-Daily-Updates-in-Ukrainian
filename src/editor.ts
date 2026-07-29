import { Article, Candidate } from './types';
import { generateJson } from './gemini';
import { fetchArticleContent } from './articleFetch';
import { findDisallowedLatinTokens } from './validation';
import { renderCaptionHtml, visibleLength } from './caption';

// Visible-character ceiling. The full message is now sent as text when it does
// not fit an image caption, so the ceiling tracks Telegram's 4096-char
// sendMessage limit with headroom for <b> tags and the source anchor.
const MAX_VISIBLE_LENGTH = 3500;

// NOTE: Gemini's structured-output schema is an OpenAPI subset. It rejects
// union types (`type: ['integer','null']`) and `additionalProperties`. Use
// `nullable: true` for optional fields and omit additionalProperties.
const SELECTION_SCHEMA = {
  type: 'object',
  properties: { selectedIndex: { type: 'integer', nullable: true } },
  required: ['selectedIndex'],
};

const WRITING_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' } },
    why_matters: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    coined_term: { type: 'string', nullable: true },
  },
  required: ['headline', 'paragraphs', 'why_matters', 'keywords', 'coined_term'],
};

function buildSelectionPrompt(candidates: Candidate[]): string {
  const list = candidates.map((c, i) => `${i}. ${c.title} — ${c.blurb} (${c.sourceName})`).join('\n');
  return `Ти редактор хімічних новин для читачки-хімікині з багаторічним досвідом. З наведеного списку обери ЄДИНУ найкращу статтю для неї — актуальну, змістовну хімічну новину. Якщо жодна не годиться, поверни null.\n\n${list}`;
}

function buildWritingPrompt(candidate: Candidate, bodyText: string, shortenHint: boolean): string {
  const base = `Ти пишеш щоденний огляд хімічної новини українською мовою для читачки — дипломованої хімікині (вчителька, інженерка або лаборантка), близько 75 років.

Правила:
- Пиши для фахівчині. Називай сполуки, реагенти, механізми та кількісні дані. НЕ спрощуй і НЕ скорочуй надмірно — краще повний, змістовний виклад, ніж поверхневе резюме.
- Подавай суть стисло, але змістовно: що саме відкрили чи зробили, яким методом, який результат у цифрах, і чому це важливо для хімії. Наводь ключові сполуки, умови реакції чи виходи, якщо вони є, але без зайвих деталей.
- Структуруй текст абзацами: 3-5 коротких абзаців, кожен — одна закінчена думка, по 2-3 речення. Без нагромадження вкладених підрядних конструкцій.
- Виділяй ключову інформацію: обгортай найважливіші терміни, назви сполук, ключові числові дані та головний висновок у подвійні зірочки, ось так: **гідроген пероксид**, **вихід 92%**, **за кімнатної температури**. Виділяй лише справді ключове — кілька фрагментів на абзац, не більше.
- Доречні емодзі дозволені, але зрідка: щонайбільше одне-два на все повідомлення, лише там, де вони справді доречні (наприклад 🧪, 🔬, ⚗️, 🧫). Не перетворюй текст на прикрасу.
- Лише українська мова. Жодних слів латиницею в тексті.
- Хімічні формули ЗАВЖДИ з нижніми індексами Unicode: пиши CO₂, H₂O, H₂SO₄, C₆H₁₂O₆ — НІКОЛИ не звичайними цифрами (не CO2, не H2O). Одиниці СІ дозволені.
- Заголовок: не більше 10 слів, без зірочок.
- Використовуй усталену українську хімічну термінологію. Якщо доводиться вигадати термін, якого усталеної форми немає, познач це в coined_term.
- Обсяг основного тексту: приблизно 600-1200 видимих символів. Стисло і по суті, без води.

Поле paragraphs — масив абзаців основного тексту. Поле why_matters — окремий короткий підсумок значущості (1-2 речення), без повторення заголовка. Поле keywords — від 3 до 6 ключових слів або коротких словосполучень українською, що описують тему новини (наприклад: каталіз, азотфіксація, кобальт). Без зірочок і без ґраток.

Джерело (${candidate.sourceName}): ${candidate.title}

Текст статті:
${bodyText}`;
  return shortenHint ? `${base}\n\nПопередня спроба була занадто довгою. Скороти до 1200 видимих символів, зберігаючи ключові деталі та цифри.` : base;
}

// A handful of Latin tokens (a researcher's name, an acronym like DNA/CRISPR, a
// journal) is acceptable for an expert reader and must NOT cause the whole
// article to be dropped — that left the reader with nothing. Only reject when
// the text is substantially non-Ukrainian.
const MAX_LATIN_TOKENS = 8;

function passesUkrainianOnly(article: Article): boolean {
  const text = [article.headline, ...article.paragraphs, article.whyMatters, ...(article.keywords ?? [])].join(' ');
  return findDisallowedLatinTokens(text).length <= MAX_LATIN_TOKENS;
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
    model: 'gemini-flash-lite-latest',
    prompt: buildWritingPrompt(candidate, bodyText, shortenHint),
    schema: WRITING_SCHEMA,
    // 'low' keeps the whole run inside the Worker's background-task time limit.
    // Gemini 3 Flash still produces strong Ukrainian at this level.
    thinkingLevel: 'low',
  });

  if (result.kind === 'blocked') {
    console.log('[debug] writeArticle blocked');
    return null;
  }
  if (result.kind !== 'ok') {
    console.log('[debug] writeArticle error result', JSON.stringify(result));
    if (attempt < 2) return writeArticle(candidate, bodyText, imageUrl, apiKey, attempt + 1, shortenHint);
    return null;
  }

  const data = result.data as {
    headline: string;
    paragraphs: string[];
    why_matters: string;
    keywords?: string[];
    coined_term: string | null;
  };
  const article: Article = {
    headline: data.headline,
    paragraphs: data.paragraphs,
    whyMatters: data.why_matters,
    keywords: data.keywords ?? [],
    coinedTerm: data.coined_term,
    url: candidate.url,
    sourceName: candidate.sourceName,
    imageUrl,
  };

  if (!passesUkrainianOnly(article)) {
    console.log('[debug] failed Ukrainian-only check', JSON.stringify(article));
    return null;
  }

  const len = visibleLength(renderCaptionHtml(article));
  if (len > MAX_VISIBLE_LENGTH) {
    console.log('[debug] too long', len);
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
      model: 'gemini-flash-lite-latest',
      prompt: buildSelectionPrompt(remaining),
      schema: SELECTION_SCHEMA,
      thinkingLevel: 'low',
    });

    if (selectionResult.kind !== 'ok') {
      console.log('[debug] selection failed', JSON.stringify(selectionResult));
      return null;
    }
    const { selectedIndex } = selectionResult.data as { selectedIndex: number | null };
    console.log('[debug] selectedIndex', selectedIndex);
    if (selectedIndex === null || !remaining[selectedIndex]) return null;

    const chosen = remaining[selectedIndex];
    const fetched = await fetchArticleContent(chosen.url);
    const bodyText = fetched?.bodyText ?? chosen.blurb;
    // Prefer the article page's og:image; fall back to any image the RSS item
    // itself carried, so Chemistry World / Phys.org still get a picture.
    const imageUrl = fetched?.imageUrl ?? chosen.imageUrl ?? null;
    console.log('[debug] chosen', chosen.url, 'bodyText length', bodyText.length);

    const article = await writeArticle(chosen, bodyText, imageUrl, apiKey);
    console.log('[debug] writeArticle result', article ? 'ok' : 'null');
    if (article) return article;

    remaining = remaining.filter((c) => c.url !== chosen.url);
  }

  return null;
}
