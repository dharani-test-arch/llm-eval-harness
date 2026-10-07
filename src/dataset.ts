import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from './text';
import type { CorpusDoc, GoldenCase } from './types';

export function loadCorpus(dir: string): CorpusDoc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      const heading = text.split('\n').find((l) => l.startsWith('# '));
      return { id: file.replace(/\.md$/, ''), title: (heading ?? file).replace(/^#\s+/, '').trim(), text };
    });
}

export function loadGolden(path: string): GoldenCase[] {
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenCase[];
}

export type DatasetReport = { errors: string[]; warnings: string[] };

/**
 * Tests the tests. A golden set with a wrong answer key produces confident, meaningless scores,
 * so this checks the dataset itself before any model is involved.
 */
export function validateDataset(corpus: CorpusDoc[], cases: GoldenCase[]): DatasetReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const docs = new Map(corpus.map((d) => [d.id, d]));
  const seen = new Set<string>();

  if (corpus.length === 0) errors.push('corpus is empty');
  if (cases.length === 0) errors.push('golden set is empty');

  for (const c of cases) {
    const where = `case "${c.id}"`;
    if (seen.has(c.id)) errors.push(`${where}: duplicate id`);
    seen.add(c.id);
    if (!c.question?.trim()) errors.push(`${where}: empty question`);

    if (c.answerable) {
      if (!c.expectAll?.length) errors.push(`${where}: answerable but has no expectAll facts`);
      if (!c.sources?.length) errors.push(`${where}: answerable but has no sources`);

      const sourceText = (c.sources ?? [])
        .map((s) => {
          const doc = docs.get(s);
          if (!doc) errors.push(`${where}: source "${s}" is not in the corpus`);
          return doc ? normalize(doc.text) : '';
        })
        .join(' ');

      // Every expected fact must actually be stated in the cited documents.
      for (const group of c.expectAll ?? []) {
        if (group.length === 0) errors.push(`${where}: empty expectAll group`);
        else if (!group.some((alt) => sourceText.includes(normalize(alt)))) {
          errors.push(`${where}: none of [${group.join(' | ')}] appears in its source documents`);
        }
      }
    } else {
      if (c.expectAll?.length) errors.push(`${where}: unanswerable cases must not define expectAll`);
      if (c.sources?.length) errors.push(`${where}: unanswerable cases must not define sources`);
    }
  }

  const unanswerable = cases.filter((c) => !c.answerable).length;
  if (cases.length > 0 && unanswerable / cases.length < 0.1) {
    warnings.push('fewer than 10% unanswerable cases: hallucination coverage is thin');
  }
  if (cases.length < 10) warnings.push('fewer than 10 cases: scores will be very noisy');
  return { errors, warnings };
}
