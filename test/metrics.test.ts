import { describe, expect, it } from 'vitest';
import { percentile, summarize, wilson } from '../src/metrics';
import { answerableCase } from './helpers';
import { rec } from './helpers';

const cases = [
  { ...answerableCase, id: 'a' },
  { ...answerableCase, id: 'b' },
];

describe('summarize', () => {
  it('computes consistency as the share of runs agreeing with the most common answer', () => {
    const m = summarize(
      [
        rec('a', true, 'X'), rec('a', true, 'X'), rec('a', true, 'X'), rec('a', false, 'Y'), // 75%
        rec('b', true, 'X'), rec('b', true, 'X'), rec('b', true, 'X'), rec('b', true, 'X'), // 100%
      ],
      cases,
    );
    expect(m.consistency).toBeCloseTo(0.875, 5);
  });

  it('reliability counts only cases that passed on every run (pass^k)', () => {
    const m = summarize(
      [rec('a', true, 'X'), rec('a', false, 'X'), rec('b', true, 'X'), rec('b', true, 'X')],
      cases,
    );
    expect(m.reliability).toBe(0.5);
  });

  it('accuracy is the pass rate over answerable runs, with a confidence interval', () => {
    const m = summarize([rec('a', true, 'X'), rec('a', true, 'X'), rec('b', true, 'X'), rec('b', false, 'X')], cases);
    expect(m.accuracy.value).toBe(0.75);
    expect(m.accuracy.n).toBe(4);
    expect(m.accuracy.ci95[0]).toBeLessThan(0.75);
    expect(m.accuracy.ci95[1]).toBeGreaterThan(0.75);
  });

  it('counts hallucinations and unfaithful citations separately from plain failures', () => {
    const bad = rec('a', false, 'X');
    bad.checks.hallucinated = true;
    bad.checks.citations = { total: 2, verified: 1 };
    const m = summarize([bad, rec('a', true, 'X')], cases);
    expect(m.hallucinationRate).toBe(0.5);
    expect(m.citationFaithfulness).toBeCloseTo(2 / 3, 5); // 2 of 3 citations verified
  });

  it('reports model-call failures separately from quality failures', () => {
    const m = summarize([rec('a', false, 'ERROR', { error: 'HTTP 401' }), rec('a', true, 'X')], cases);
    expect(m.infraErrors).toBe(1);
  });

  it('names the most common failure for each case', () => {
    const r1 = rec('a', false, 'X');
    const r2 = rec('a', false, 'X');
    const r3 = rec('a', false, 'X');
    r3.checks.failures = ['abstained on an answerable question'];
    const m = summarize([r1, r2, r3], cases);
    expect(m.perCase[0].topFailure).toBe('missing expected fact: x');
  });
});

describe('wilson', () => {
  it('is uninformative with no data', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  it('never claims certainty from a small sample, even at 10/10', () => {
    const [low, high] = wilson(10, 10);
    expect(low).toBeGreaterThan(0.6);
    expect(low).toBeLessThan(0.8);
    expect(high).toBeCloseTo(1, 5);
  });

  it('narrows as the sample grows', () => {
    const small = wilson(9, 10);
    const large = wilson(90, 100);
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0]);
  });
});

describe('percentile', () => {
  it('handles empty input and ordering', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
});
