import type { CorpusDoc, GoldenCase, ParsedAnswer, RunRecord } from '../src/types';

export const corpus: CorpusDoc[] = [
  {
    id: 'doc-a',
    title: 'Acme Results',
    text: 'Acme reported revenue of $412.3 million for the quarter. The company has never paid a dividend. Headcount was 1,240 at year end.',
  },
  { id: 'doc-b', title: 'Beta Corp Profile', text: 'Beta Corp employs many people worldwide across several offices.' },
];

export const answerableCase: GoldenCase = {
  id: 'rev',
  category: 'lookup',
  question: 'What was Acme revenue?',
  answerable: true,
  expectAll: [['412.3 million']],
  sources: ['doc-a'],
};

export const unanswerableCase: GoldenCase = {
  id: 'none',
  category: 'unanswerable',
  question: 'What was Acme revenue in 2031?',
  answerable: false,
};

export const goodAnswer: ParsedAnswer = {
  canAnswer: true,
  answer: 'Revenue was $412.3 million.',
  citations: [{ docId: 'doc-a', quote: 'Acme reported revenue of $412.3 million for the quarter.' }],
};

export const abstain: ParsedAnswer = { canAnswer: false, answer: '', citations: [] };

/** Minimal RunRecord for metrics tests. */
export function rec(
  caseId: string,
  passed: boolean,
  signature: string,
  extra: Partial<RunRecord> = {},
): RunRecord {
  return {
    caseId,
    category: 'lookup',
    answerable: true,
    runIndex: 0,
    answer: null,
    raw: '',
    latencyMs: 10,
    checks: {
      formatValid: true,
      abstentionCorrect: true,
      accurate: passed,
      grounded: true,
      sourcesCited: true,
      judgePassed: null,
      hallucinated: false,
      citations: { total: 1, verified: 1 },
      failures: passed ? [] : ['missing expected fact: x'],
    },
    passed,
    signature,
    ...extra,
  };
}
