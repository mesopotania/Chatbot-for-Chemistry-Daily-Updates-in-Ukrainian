export interface FetchedArticle {
  bodyText: string;
  imageUrl: string | null;
}

export async function fetchArticleContent(url: string): Promise<FetchedArticle | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let imageUrl: string | null = null;
  const paragraphs: string[] = [];
  let currentParagraph = '';

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(el) {
        const content = el.getAttribute('content');
        if (content) imageUrl = content;
      },
    })
    .on('p', {
      element() {
        currentParagraph = '';
      },
      text(chunk) {
        currentParagraph += chunk.text;
        if (chunk.lastInTextNode) {
          const trimmed = currentParagraph.trim();
          if (trimmed) paragraphs.push(trimmed);
        }
      },
    });

  const transformed = rewriter.transform(res);
  await transformed.arrayBuffer();

  const bodyText = paragraphs.join('\n\n');
  if (!bodyText) return null;

  return { bodyText, imageUrl };
}
