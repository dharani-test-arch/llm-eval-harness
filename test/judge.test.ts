import { describe, expect, it } from 'vitest';
import { loadCorpus, loadGolden } from '../src/dataset';
import { runEvaluation } from '../src/evaluate';
import { judgeAnswer } from '../src/judge';
import { MockModel } from '../src/models/mock';
import type { ModelClient } from '../src/types';
import { answerableCase, goodAnswer } from './helpers';

const stub = (reply: string | Error): ModelClient => ({
  name: 'stub-judge',
  complete: async () => {
    if (reply instanceof Error) throw reply;
    return { text: reply, latencyMs: 1 };
  },
});

describe('judgeAnswer', () => {
  it('returns the judge verdict', async () => {
    const pass = await judgeAnswer(stub('{"verdict":"pass","reason":"ok"}'), answerableCase, goodAnswer);
    const fail = await judgeAnswer(stub('{"verdict":"fail","reason":"nope"}'), answerableCase, goodAnswer);
    expect(pass.passed).toBe(true);
    expect(fail.passed).toBe(false);
    expect(fail.reason).toBe('nope');
  });

  it('fails closed on garbage output', async () => {
    expect((await judgeAnswer(stub('looks fine to me'), answerableCase, goodAnswer)).passed).toBe(false);
  });

  it('fails closed on an invalid verdict value', async () => {
    expect((await judgeAnswer(stub('{"verdict":"maybe"}'), answerableCase, goodAnswer)).passed).toBe(false);
  });

  it('fails closed when the judge call errors', async () => {
    const r = await judgeAnswer(stub(new Error('boom')), answerableCase, goodAnswer);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/boom/);
  });
});

describe('judge inside an evaluation', () => {
  const corpus = loadCorpus('data/corpus');
  const judged = loadGolden('data/golden.json').filter((c) => c.judgeRubric);
  const run = (judge: ModelClient) =>
    runEvaluation({ model: new MockModel('baseline'), corpus, cases: judged, runs: 1, judge });

  it('only applies to cases that define a rubric', () => {
    expect(judged.length).toBeGreaterThan(0);
  });

  it('a rejecting judge fails answers that passed the deterministic checks', async () => {
    const records = await run(stub('{"verdict":"fail","reason":"invented a reason"}'));
    expect(records.every((r) => !r.passed)).toBe(true);
    expect(records[0].checks.failures.join(' ')).toMatch(/judge/);
  });

  it('an approving judge leaves passing answers passing', async () => {
    const records = await run(stub('{"verdict":"pass","reason":"ok"}'));
    expect(records.every((r) => r.passed)).toBe(true);
  });
});
