import { describe, expect, it } from 'vitest';
import { scoreRun, signatureOf } from '../src/score';
import { abstain, answerableCase, corpus, goodAnswer, unanswerableCase } from './helpers';

const score = (c = answerableCase, a: any = goodAnswer, judge: boolean | null = null) =>
  scoreRun(c, a, undefined, corpus, judge);

describe('scoreRun: answerable questions', () => {
  it('passes a correct, grounded answer', () => {
    const r = score();
    expect(r.passed).toBe(true);
    expect(r.checks.hallucinated).toBe(false);
    expect(r.checks.failures).toHaveLength(0);
  });

  it('fails a wrong answer but does not call it a hallucination when its citation is real', () => {
    const r = score(answerableCase, { ...goodAnswer, answer: 'Revenue was $400 million.' });
    expect(r.passed).toBe(false);
    expect(r.checks.accurate).toBe(false);
    expect(r.checks.hallucinated).toBe(false);
  });

  it('flags a fabricated quote as a hallucination, even if the answer is right', () => {
    const r = score(answerableCase, {
      ...goodAnswer,
      citations: [{ docId: 'doc-a', quote: 'Acme reported revenue of $999 million for the quarter.' }],
    });
    expect(r.passed).toBe(false);
    expect(r.checks.grounded).toBe(false);
    expect(r.checks.hallucinated).toBe(true);
  });

  it('flags a citation to a document that does not exist', () => {
    const r = score(answerableCase, {
      ...goodAnswer,
      citations: [{ docId: 'doc-zzz', quote: 'Acme reported revenue of $412.3 million for the quarter.' }],
    });
    expect(r.checks.hallucinated).toBe(true);
    expect(r.checks.failures[0]).toMatch(/unknown document/);
  });

  it('requires the right source document to be cited', () => {
    const r = score(answerableCase, {
      ...goodAnswer,
      citations: [{ docId: 'doc-b', quote: 'Beta Corp employs many people worldwide' }],
    });
    expect(r.checks.sourcesCited).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('rejects an answer with no citations', () => {
    const r = score(answerableCase, { ...goodAnswer, citations: [] });
    expect(r.passed).toBe(false);
    expect(r.checks.failures).toContain('answer has no citations');
  });

  it('fails when it abstains on an answerable question, without calling it a hallucination', () => {
    const r = score(answerableCase, abstain);
    expect(r.passed).toBe(false);
    expect(r.checks.abstentionCorrect).toBe(false);
    expect(r.checks.hallucinated).toBe(false);
  });

  it('matches numbers regardless of thousands separators', () => {
    const c = { ...answerableCase, expectAll: [['1240']] };
    const a = { ...goodAnswer, answer: 'Headcount was 1,240.', citations: [{ docId: 'doc-a', quote: 'Headcount was 1,240 at year end.' }] };
    expect(score(c, a).passed).toBe(true);
  });

  it('fails an answer containing forbidden content and calls it a hallucination', () => {
    const c = { ...answerableCase, forbid: ['because of'] };
    const r = score(c, { ...goodAnswer, answer: 'Revenue was $412.3 million because of tariffs.' });
    expect(r.passed).toBe(false);
    expect(r.checks.hallucinated).toBe(true);
  });

  it('lets a failed LLM judge veto a deterministically correct answer, but never rescue a wrong one', () => {
    expect(score(answerableCase, goodAnswer, false).passed).toBe(false);
    expect(score(answerableCase, goodAnswer, true).passed).toBe(true);
    expect(score(answerableCase, { ...goodAnswer, answer: 'wrong' }, true).passed).toBe(false);
  });
});

describe('scoreRun: unanswerable questions', () => {
  it('passes a correct abstention', () => {
    expect(score(unanswerableCase, abstain).passed).toBe(true);
  });

  it('treats answering as a hallucination', () => {
    const r = score(unanswerableCase, goodAnswer);
    expect(r.passed).toBe(false);
    expect(r.checks.hallucinated).toBe(true);
    expect(r.checks.failures).toContain('answered an unanswerable question');
  });
});

describe('scoreRun: invalid output', () => {
  it('fails and records why', () => {
    const r = scoreRun(answerableCase, null, 'unparseable output: no JSON object found', corpus);
    expect(r.passed).toBe(false);
    expect(r.checks.formatValid).toBe(false);
    expect(r.signature).toBe('INVALID');
  });
});

describe('signatureOf', () => {
  it('is identical for differently worded answers with the same facts', () => {
    const a = signatureOf(answerableCase, { ...goodAnswer, answer: 'Revenue was $412.3 million.' });
    const b = signatureOf(answerableCase, { ...goodAnswer, answer: 'Acme made 412.3 million dollars in revenue, up from last year.' });
    expect(a).toBe(b);
  });

  it('distinguishes two different wrong answers', () => {
    const a = signatureOf(answerableCase, { ...goodAnswer, answer: 'It was $400 million.' });
    const b = signatureOf(answerableCase, { ...goodAnswer, answer: 'It was $350 million.' });
    expect(a === b).toBe(false);
  });

  it('separates abstaining from answering', () => {
    expect(signatureOf(answerableCase, abstain)).toBe('ABSTAIN');
  });
});
