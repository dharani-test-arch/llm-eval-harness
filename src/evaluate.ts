import { answerQuestion } from './answerer';
import { judgeAnswer } from './judge';
import { scoreRun } from './score';
import type { CorpusDoc, GoldenCase, ModelClient, RunRecord } from './types';

export type EvaluateOptions = {
  model: ModelClient;
  corpus: CorpusDoc[];
  cases: GoldenCase[];
  runs: number;
  concurrency?: number;
  temperature?: number;
  judge?: ModelClient;
  onProgress?: (done: number, total: number) => void;
};

/** FNV-1a: a stable hash so each (case, run) gets the same mock "randomness" every time. */
export function seedFor(caseId: string, runIndex: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${caseId}#${runIndex}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Runs every case `runs` times. Repeating runs is what makes non-determinism visible:
 * a single pass can't tell a stable model from a lucky one.
 */
export async function runEvaluation(opts: EvaluateOptions): Promise<RunRecord[]> {
  const tasks = opts.cases.flatMap((c) => Array.from({ length: opts.runs }, (_, runIndex) => ({ c, runIndex })));
  const records: RunRecord[] = new Array(tasks.length);
  let done = 0;

  await pool(
    tasks.map((t, index) => ({ ...t, index })),
    opts.concurrency ?? 4,
    async ({ c, runIndex, index }) => {
      const outcome = await answerQuestion(opts.model, opts.corpus, c.question, {
        temperature: opts.temperature,
        seed: seedFor(c.id, runIndex),
      });

      let scored = scoreRun(c, outcome.parsed, outcome.error ?? outcome.parseError, opts.corpus);

      // The judge only reviews answers that already passed the deterministic checks, and can only fail them.
      if (opts.judge && c.judgeRubric && scored.passed && outcome.parsed?.canAnswer) {
        const verdict = await judgeAnswer(opts.judge, c, outcome.parsed);
        scored = scoreRun(c, outcome.parsed, undefined, opts.corpus, verdict.passed);
        if (!verdict.passed) scored.checks.failures.push(`judge: ${verdict.reason}`);
      }

      records[index] = {
        caseId: c.id,
        category: c.category,
        answerable: c.answerable,
        runIndex,
        answer: outcome.parsed,
        raw: outcome.raw,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        error: outcome.error,
        checks: scored.checks,
        passed: scored.passed,
        signature: outcome.error ? 'ERROR' : scored.signature,
      };
      opts.onProgress?.(++done, tasks.length);
    },
  );

  return records;
}
