import type { Category, GoldenCase, RunRecord } from './types';

export type Rate = { value: number; successes: number; n: number; ci95: [number, number] };

export type CaseSummary = {
  id: string;
  category: Category;
  runs: number;
  passes: number;
  passRate: number;
  /** Share of runs that agree with the most common answer fingerprint. 1 = identical every time. */
  consistency: number;
  topFailure: string | null;
};

export type Metrics = {
  cases: number;
  runsPerCase: number;
  totalRuns: number;
  infraErrors: number;
  accuracy: Rate;
  abstentionAccuracy: Rate;
  hallucinationRate: number;
  citationFaithfulness: number;
  formatValidRate: number;
  consistency: number;
  reliability: number;
  latencyMs: { p50: number; p95: number };
  tokens: { input: number; output: number };
  byCategory: Record<string, { runs: number; passRate: number }>;
  perCase: CaseSummary[];
};

/** 95% Wilson score interval. Better behaved than the normal approximation at small n or extreme rates. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const rate = (successes: number, n: number): Rate => ({
  value: n === 0 ? 1 : successes / n,
  successes,
  n,
  ci95: wilson(successes, n),
});

const mean = (xs: number[]) => (xs.length === 0 ? 1 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function summarize(records: RunRecord[], cases: GoldenCase[]): Metrics {
  const byCase = new Map<string, RunRecord[]>();
  for (const r of records) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);

  const perCase: CaseSummary[] = cases
    .filter((c) => byCase.has(c.id))
    .map((c) => {
      const runs = byCase.get(c.id)!;
      const passes = runs.filter((r) => r.passed).length;

      const counts = new Map<string, number>();
      for (const r of runs) counts.set(r.signature, (counts.get(r.signature) ?? 0) + 1);
      const modal = Math.max(...counts.values());

      const failureCounts = new Map<string, number>();
      for (const r of runs.filter((x) => !x.passed)) {
        const f = r.error ? `model call failed: ${r.error}` : (r.checks.failures[0] ?? 'failed');
        failureCounts.set(f, (failureCounts.get(f) ?? 0) + 1);
      }
      const top = [...failureCounts.entries()].sort((a, b) => b[1] - a[1])[0];

      return {
        id: c.id,
        category: c.category,
        runs: runs.length,
        passes,
        passRate: passes / runs.length,
        consistency: modal / runs.length,
        topFailure: top ? top[0] : null,
      };
    });

  const answerable = records.filter((r) => r.answerable);
  const unanswerable = records.filter((r) => !r.answerable);
  const citationsTotal = records.reduce((s, r) => s + r.checks.citations.total, 0);
  const citationsVerified = records.reduce((s, r) => s + r.checks.citations.verified, 0);
  const latencies = records.filter((r) => r.latencyMs > 0).map((r) => r.latencyMs);

  const byCategory: Metrics['byCategory'] = {};
  for (const r of records) {
    const entry = (byCategory[r.category] ??= { runs: 0, passRate: 0 });
    entry.runs++;
    entry.passRate += r.passed ? 1 : 0;
  }
  for (const entry of Object.values(byCategory)) entry.passRate = entry.passRate / entry.runs;

  return {
    cases: perCase.length,
    runsPerCase: perCase.length ? Math.round(records.length / perCase.length) : 0,
    totalRuns: records.length,
    infraErrors: records.filter((r) => r.error).length,
    accuracy: rate(answerable.filter((r) => r.passed).length, answerable.length),
    abstentionAccuracy: rate(unanswerable.filter((r) => r.passed).length, unanswerable.length),
    hallucinationRate: records.length === 0 ? 0 : records.filter((r) => r.checks.hallucinated).length / records.length,
    citationFaithfulness: citationsTotal === 0 ? 1 : citationsVerified / citationsTotal,
    formatValidRate: records.length === 0 ? 1 : records.filter((r) => r.checks.formatValid).length / records.length,
    consistency: mean(perCase.map((c) => c.consistency)),
    reliability: mean(perCase.map((c) => (c.passes === c.runs ? 1 : 0))),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    tokens: {
      input: records.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
      output: records.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
    },
    byCategory,
    perCase,
  };
}
