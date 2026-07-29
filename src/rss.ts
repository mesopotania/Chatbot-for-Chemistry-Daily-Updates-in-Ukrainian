export interface RawRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  image: string;
}

function stripCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : s;
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function extractTag(itemXml: string, tag: string): string {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return decodeXmlEntities(stripCdata(match[1]).trim());
}

// Reads an attribute off a self-closing / opening tag, e.g. the url="" on
// <media:content>, <enclosure>, or <media:thumbnail>.
function extractAttr(itemXml: string, tag: string, attr: string): string {
  const match = itemXml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i'));
  return match ? decodeXmlEntities(match[1]) : '';
}

// Picks an image URL carried inside the RSS item itself, when present.
// Chemistry World ships <enclosure>/<media:content>; Phys.org ships
// <media:thumbnail>; ScienceDaily ships none. Larger media first.
function extractImage(itemXml: string): string {
  return (
    extractAttr(itemXml, 'media:content', 'url') ||
    extractAttr(itemXml, 'enclosure', 'url') ||
    extractAttr(itemXml, 'media:thumbnail', 'url')
  );
}

export function parseRssItems(xml: string): RawRssItem[] {
  const items: RawRssItem[] = [];
  const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  for (const itemXml of itemMatches) {
    const link = extractTag(itemXml, 'link');
    const title = extractTag(itemXml, 'title');
    if (!link || !title) continue;
    items.push({
      title,
      link,
      description: extractTag(itemXml, 'description'),
      pubDate: extractTag(itemXml, 'pubDate'),
      image: extractImage(itemXml),
    });
  }
  return items;
}
