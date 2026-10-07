import { describe, expect, it } from 'vitest';
import { loadCorpus, loadGolden, validateDataset } from '../src/dataset';
import { answerableCase, corpus, unanswerableCase } from './helpers';

describe('shipped dataset', () => {
  it('is valid: every expected fact appears in its source documents', () => {
    const { errors } = validateDataset(loadCorpus('data/corpus'), loadGolden('data/golden.json'));
    expect(errors).toEqual([]);
  });

  it('mixes answerable and unanswerable questions', () => {
    const cases = loadGolden('data/golden.json');
    expect(cases.filter((c) => !c.answerable).length).toBeGreaterThan(2);
    expect(cases.filter((c) => c.answerable).length).toBeGreaterThan(10);
  });
});

describe('validateDataset catches a broken answer key', () => {
  const run = (cases: any[]) => validateDataset(corpus, cases).errors;

  it('accepts a minimal valid set', () => {
    expect(run([answerableCase, unanswerableCase])).toEqual([]);
  });

  it('rejects an expected fact that the source never states', () => {
    const errors = run([{ ...answerableCase, expectAll: [['999 billion']] }]);
    expect(errors[0]).toMatch(/appears in its source/);
  });

  it('rejects an unknown source document', () => {
    expect(run([{ ...answerableCase, sources: ['nope'] }])[0]).toMatch(/not in the corpus/);
  });

  it('rejects duplicate ids', () => {
    expect(run([answerableCase, answerableCase]).some((e) => /duplicate/.test(e))).toBe(true);
  });

  it('rejects an answerable case with no expected facts', () => {
    expect(run([{ ...answerableCase, expectAll: undefined }])[0]).toMatch(/no expectAll/);
  });

  it('rejects an unanswerable case that defines an answer key', () => {
    expect(run([{ ...unanswerableCase, sources: ['doc-a'] }])[0]).toMatch(/must not define sources/);
  });
});
