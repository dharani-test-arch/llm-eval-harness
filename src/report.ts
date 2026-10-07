import type { GateResult } from './gates';
import type { Metrics } from './metrics';
import type { RunRecord } from './types';

export type ReportMeta = { model: string; judge?: string; date: string; runsPerCase: number };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 110);
const rateText = (r: Metrics['accuracy']) =>
  `${pct(r.value)} (${r.successes}/${r.n}, 95% CI ${pct(r.ci95[0])} to ${pct(r.ci95[1])})`;

export function renderMarkdown(meta: ReportMeta, m: Metrics, gates: GateResult[]): string {
  const failed = gates.filter((g) => !g.passed);
  const L: string[] = [];

  L.push('# LLM evaluation report', '');
  L.push(
    `**Model:** ${meta.model}${meta.judge ? ` (judge: ${meta.judge})` : ''} | **Date:** ${meta.date} | ` +
      `**Cases:** ${m.cases} x ${meta.runsPerCase} runs = ${m.totalRuns} runs`,
    '',
  );
  L.push(failed.length === 0 ? '**Result: ALL GATES PASSED**' : `**Result: ${failed.length} GATE(S) FAILED**`, '');
  if (m.infraErrors > 0) {
    L.push(`> WARNING: ${m.infraErrors} run(s) failed because the model call itself failed (network, auth or rate limit). These results are not trustworthy.`, '');
  }

  L.push('## Quality gates', '', '| Gate | Actual | Required | Result |', '|---|---|---|---|');
  for (const g of gates) {
    L.push(`| ${g.name} | ${pct(g.actual)} | ${g.direction === 'min' ? '>=' : '<='} ${pct(g.threshold)} | ${g.passed ? 'PASS' : 'FAIL'} |`);
  }

  L.push('', '## Metrics', '', '| Metric | Value | Meaning |', '|---|---|---|');
  L.push(`| Accuracy | ${rateText(m.accuracy)} | Answerable questions answered correctly, with verified citations |`);
  L.push(`| Abstention accuracy | ${rateText(m.abstentionAccuracy)} | Unanswerable questions correctly declined |`);
  L.push(`| Hallucination rate | ${pct(m.hallucinationRate)} | Runs that answered the unanswerable, cited text that is not in the source, or stated forbidden content |`);
  L.push(`| Citation faithfulness | ${pct(m.citationFaithfulness)} | Citations whose quote appears verbatim in the cited document |`);
  L.push(`| Format valid | ${pct(m.formatValidRate)} | Runs returning parseable JSON of the required shape |`);
  L.push(`| Consistency | ${pct(m.consistency)} | Average agreement across repeated runs of the same question |`);
  L.push(`| Reliability (pass^k) | ${pct(m.reliability)} | Cases that passed on EVERY run |`);
  L.push(`| Latency p50 / p95 | ${m.latencyMs.p50.toFixed(0)} ms / ${m.latencyMs.p95.toFixed(0)} ms | Per request |`);
  if (m.tokens.input + m.tokens.output > 0) {
    L.push(`| Tokens | ${m.tokens.input} in / ${m.tokens.output} out | Total across all runs |`);
  }

  L.push('', '## By category', '', '| Category | Runs | Pass rate |', '|---|---|---|');
  for (const [name, v] of Object.entries(m.byCategory)) L.push(`| ${name} | ${v.runs} | ${pct(v.passRate)} |`);

  const unstable = m.perCase.filter((c) => c.passRate < 1 || c.consistency < 1);
  L.push('', '## Cases needing attention', '');
  if (unstable.length === 0) {
    L.push('None. Every case passed on every run with identical answers.');
  } else {
    L.push('| Case | Category | Pass rate | Consistency | Most common failure |', '|---|---|---|---|---|');
    for (const c of unstable.sort((a, b) => a.passRate - b.passRate)) {
      L.push(`| ${c.id} | ${c.category} | ${pct(c.passRate)} (${c.passes}/${c.runs}) | ${pct(c.consistency)} | ${cell(c.topFailure ?? 'inconsistent answers')} |`);
    }
  }

  L.push(
    '',
    '## How to read this',
    '',
    `- With ${m.cases} cases the confidence intervals are wide. Treat small differences between runs or models as noise.`,
    '- Runs of the same case are not fully independent, so the intervals are optimistic.',
    '- A case that passes sometimes (pass rate between 0% and 100%) is the interesting finding: the model is capable but unreliable.',
    '',
  );
  return L.join('\n');
}

/** Raw model output for every run, one JSON object per line, for debugging individual failures. */
export function renderJsonl(records: RunRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
