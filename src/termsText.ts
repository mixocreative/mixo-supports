import en from '../TERMS.md?raw';
import zhHant from '../TERMS.zh-Hant.md?raw';
import type { Lang } from './i18n';

export type Inline = { text: string; bold?: boolean; href?: string };
export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'quote' | 'para'; inline: Inline[] }
  | { kind: 'item'; n: string; inline: Inline[] };

/** The terms in the user's language; Japanese has no translation yet and shows the English text. */
export function termsFor(lang: Lang): { text: string; translated: boolean } {
  return lang === 'zh-Hant' ? { text: zhHant, translated: true } : { text: en, translated: lang === 'en' };
}

function inline(line: string): Inline[] {
  const out: Inline[] = [];
  for (const part of line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/)) {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) out.push({ text: link[1]!, href: link[2]! });
    else if (/^\*\*[^*]+\*\*$/.test(part)) out.push({ text: part.slice(2, -2), bold: true });
    else if (part) out.push({ text: part });
  }
  return out;
}

/** The small Markdown subset TERMS.md uses: a title, quote lines, numbered items, paragraphs. */
export function parseTerms(markdown: string): Block[] {
  return markdown.split('\n').map((line) => line.trimEnd()).filter(Boolean).map((line): Block => {
    if (line.startsWith('# ')) return { kind: 'title', text: line.slice(2) };
    if (line.startsWith('> ')) return { kind: 'quote', inline: inline(line.slice(2)) };
    const item = /^(\d+)\. (.*)$/.exec(line);
    return item ? { kind: 'item', n: item[1]!, inline: inline(item[2]!) } : { kind: 'para', inline: inline(line) };
  });
}
