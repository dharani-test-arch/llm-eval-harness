/** Lower-case and strip formatting so "$1,240", "1240" and "**1,240**" compare equal. */
export function normalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/(?<=\d),(?=\d{3})/g, '')
    .replace(/[$*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_QUOTE_CHARS = 15;
const MIN_SEGMENT_CHARS = 8;

/**
 * True if the quote really appears in the document. An ellipsis lets a model skip
 * words, but every kept segment must still appear verbatim. Very short quotes are
 * rejected because they prove nothing ("the company").
 */
export function quoteAppearsIn(quote: string, docText: string): boolean {
  const q = normalize(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  const doc = normalize(docText);
  const segments = q
    .split('...')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return segments.length > 0 && segments.every((s) => s.length >= MIN_SEGMENT_CHARS && doc.includes(s));
}

export function extractNumbers(text: string): string[] {
  return normalize(text).match(/\d+(?:\.\d+)?/g) ?? [];
}
