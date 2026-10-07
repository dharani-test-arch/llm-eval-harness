import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCorpus, loadGolden } from '../src/dataset';
import { runEvaluation } from '../src/evaluate';
import { evaluateGates, type Thresholds } from '../src/gates';
import { summarize } from '../src/metrics';
import { MockModel, type MockMode } from '../src/models/mock';
import type { ModelClient } from '../src/types';

/**
 * Tests of the TESTER: feed the harness models with known behaviour and confirm it
 * reaches the right verdict. If these fail, evaluation results cannot be trusted.
 */
const corpus = loadCorpus('data/corpus');
const cases = loadGolden('data/golden.json');
const { thresholds } = JSON.parse(readFileSync('eval.config.json', 'utf8')) as { thresholds: Thresholds };

async function evaluate(model: ModelClient, runs = 5) {
  const records = await runEvaluation({ model, corpus, cases, runs, concurrency: 8 });
  const metrics = summarize(records, cases);
  const gates = evaluateGates(metrics, thresholds);
  return { records, metrics, gates, failed: gates.filter((g) => !g.passed).map((g) => g.name) };
}

describe('the harness reaches the right verdict', () => {
  it('passes every gate for a well-behaved model', async () => {
    const { failed, metrics } = await evaluate(new MockModel('baseline'));
    expect(failed).toEqual([]);
    expect(metrics.accuracy.value).toBe(1);
    expect(metrics.consistency).toBe(1);
  });

  it('fails the hallucination and citation gates for a model that fabricates', async () => {
    const { failed, metrics } = await evaluate(new MockModel('hallucinating'));
    expect(failed).toContain('hallucinationRate');
    expect(failed).toContain('citationFaithfulness');
    expect(metrics.hallucinationRate).toBeGreaterThan(0.2);
  });

  it('fails consistency and reliability for a flaky model, yet does not call it a hallucinator', async () => {
    const { failed, metrics } = await evaluate(new MockModel('flaky'));
    expect(failed).toContain('consistency');
    expect(failed).toContain('reliability');
    expect(failed).toContain('formatValidRate');
    expect(metrics.hallucinationRate).toBe(0);
    expect(metrics.citationFaithfulness).toBe(1);
  });

  it('gives identical results when run twice (the simulation is reproducible)', async () => {
    const a = await evaluate(new MockModel('flaky'));
    const b = await evaluate(new MockModel('flaky'));
    expect(a.metrics.accuracy.successes).toBe(b.metrics.accuracy.successes);
    expect(a.metrics.consistency).toBe(b.metrics.consistency);
  });

  it('does not confuse a broken API with a bad model', async () => {
    const down: ModelClient = {
      name: 'down',
      complete: async () => {
        throw new Error('HTTP 503');
      },
    };
    const { metrics } = await evaluate(down, 1);
    expect(metrics.infraErrors).toBe(cases.length);
  });

  it('covers every category in the golden set', async () => {
    const { metrics } = await evaluate(new MockModel('baseline' as MockMode), 1);
    expect(Object.keys(metrics.byCategory).sort()).toEqual(['comparison', 'false_premise', 'lookup', 'unanswerable']);
  });
});
