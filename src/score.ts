import { extractNumbers, normalize, quoteAppearsIn } from './text';
import type { CheckResult, CorpusDoc, GoldenCase, ParsedAnswer } from './types';

export type ScoredRun = { checks: CheckResult; passed: boolean; signature: string };

/**
 * Scores one model answer against one golden case. Everything here is deterministic.
 *
 * A run PASSES only if all of these hold:
 *  - the output was valid JSON of the expected shape
 *  - it abstained exactly when it should have
 *  - the expected facts are present and nothing forbidden is (answerable cases)
 *  - every citation points at a real document and quotes it verbatim
 *  - every required source document was cited
 *  - the optional LLM judge (if used) agreed
 *
 * HALLUCINATED is tracked separately because it is the failure that matters most:
 * answering an unanswerable question, citing text that is not in the source,
 * or stating forbidden content.
 */
export function scoreRun(
  c: GoldenCase,
  answer: ParsedAnswer | null,
  parseError: string | undefined,
  corpus: CorpusDoc[],
  judgePassed: boolean | null = null,
): ScoredRun {
  if (!answer) {
    return {
      checks: {
        formatValid: false,
        abstentionCorrect: false,
        accurate: false,
        grounded: false,
        sourcesCited: false,
        judgePassed: null,
        hallucinated: false,
        citations: { total: 0, verified: 0 },
        failures: [parseError ?? 'no answer produced'],
      },
      passed: false,
      signature: 'INVALID',
    };
  }

  const failures: string[] = [];
  const docs = new Map(corpus.map((d) => [d.id, d]));

  // 1. Abstention
  const abstentionCorrect = c.answerable ? answer.canAnswer : !answer.canAnswer;
  if (!abstentionCorrect) {
    failures.push(c.answerable ? 'abstained on an answerable question' : 'answered an unanswerable question');
  }

  // 2. Citations: real document, verbatim quote
  const verifiedSources = new Set<string>();
  let verified = 0;
  for (const cit of answer.citations) {
    const doc = docs.get(cit.docId);
    if (!doc) {
      failures.push(`cited unknown document "${cit.docId}"`);
    } else if (!quoteAppearsIn(cit.quote, doc.text)) {
      failures.push(`quote not found in ${cit.docId}`);
    } else {
      verified++;
      verifiedSources.add(cit.docId);
    }
  }
  const total = answer.citations.length;
  if (answer.canAnswer && total === 0) failures.push('answer has no citations');
  const grounded = verified === total && (!answer.canAnswer || total > 0);

  // 3. Accuracy
  const answerText = normalize(answer.answer);
  let accurate = true;
  if (c.answerable && answer.canAnswer) {
    const missing = (c.expectAll ?? []).filter((group) => !group.some((alt) => answerText.includes(normalize(alt))));
    if (missing.length > 0) {
      accurate = false;
      failures.push(`missing expected fact: ${missing.map((g) => g.join(' | ')).join('; ')}`);
    }
  }
  const forbidden = (c.forbid ?? []).filter((f) => answerText.includes(normalize(f)));
  if (forbidden.length > 0) {
    accurate = false;
    failures.push(`contains forbidden content: ${forbidden.join(', ')}`);
  }

  // 4. Required sources
  let sourcesCited = true;
  if (c.answerable && answer.canAnswer && c.sources?.length) {
    const missingSources = c.sources.filter((s) => !verifiedSources.has(s));
    if (missingSources.length > 0) {
      sourcesCited = false;
      failures.push(`required source not cited: ${missingSources.join(', ')}`);
    }
  }

  // 5. Judge (only ever fails a run; it can't rescue one)
  if (judgePassed === false) failures.push('LLM judge rejected the answer');

  const hallucinated = (!c.answerable && answer.canAnswer) || total > verified || forbidden.length > 0;

  const passed =
    abstentionCorrect && accurate && grounded && sourcesCited && judgePassed !== false && !hallucinated;

  return {
    checks: {
      formatValid: true,
      abstentionCorrect,
      accurate,
      grounded,
      sourcesCited,
      judgePassed,
      hallucinated,
      citations: { total, verified },
      failures,
    },
    passed,
    signature: signatureOf(c, answer),
  };
}

/**
 * A short fingerprint of WHAT the answer says, ignoring phrasing. Two runs with the same
 * signature agree. Facts matched count; when facts are missing, the numbers the model
 * produced are included so two different wrong answers don't look identical.
 */
export function signatureOf(c: GoldenCase, answer: ParsedAnswer): string {
  if (!answer.canAnswer) return 'ABSTAIN';
  const text = normalize(answer.answer);
  const bits = (c.expectAll ?? []).map((group) => (group.some((alt) => text.includes(normalize(alt))) ? '1' : '0'));
  const base = `ANSWER|${bits.join('')}`;
  if (bits.length === 0 || bits.includes('0')) {
    return `${base}|${[...new Set(extractNumbers(answer.answer))].sort().join(',')}`;
  }
  return base;
}
