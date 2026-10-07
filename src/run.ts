import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCorpus, loadGolden, validateDataset } from './dataset';
import { runEvaluation } from './evaluate';
import { evaluateGates, type Thresholds } from './gates';
import { summarize } from './metrics';
import { createModel, type MockMode } from './models';
import { renderJsonl, renderMarkdown } from './report';

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'mock' },
    model: { type: 'string' },
    'mock-mode': { type: 'string', default: 'baseline' },
    runs: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    temperature: { type: 'string' },
    judge: { type: 'boolean', default: false },
    'judge-model': { type: 'string' },
    cases: { type: 'string' },
    out: { type: 'string', default: 'results' },
  },
});

const config = JSON.parse(readFileSync('eval.config.json', 'utf8')) as { runsPerCase: number; thresholds: Thresholds };
const corpus = loadCorpus('data/corpus');
let cases = loadGolden('data/golden.json');

const dataset = validateDataset(corpus, cases);
dataset.warnings.forEach((w) => console.warn(`dataset warning: ${w}`));
if (dataset.errors.length > 0) {
  dataset.errors.forEach((e) => console.error(`dataset error: ${e}`));
  console.error('Fix the dataset before evaluating: scores against a broken answer key are meaningless.');
  process.exit(1);
}

if (values.cases) {
  const needle = values.cases;
  cases = cases.filter((c) => c.id.includes(needle));
  if (cases.length === 0) {
    console.error(`No cases match "${needle}".`);
    process.exit(1);
  }
}

const provider = values.provider!;
if (values.judge && provider === 'mock') {
  console.error('The mock provider cannot act as a judge. Use --provider anthropic with --judge.');
  process.exit(1);
}

let model;
let judge;
try {
  model = createModel(provider, { model: values.model, mockMode: values['mock-mode'] as MockMode });
  judge = values.judge ? createModel(provider, { model: values['judge-model'] ?? values.model }) : undefined;
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(2);
}
const runs = Number(values.runs ?? config.runsPerCase);
const temperature = values.temperature !== undefined ? Number(values.temperature) : undefined;

console.log(`Evaluating ${model.name}: ${cases.length} cases x ${runs} runs${judge ? ` (judge ${judge.name})` : ''}`);

const records = await runEvaluation({
  model,
  corpus,
  cases,
  runs,
  concurrency: Number(values.concurrency),
  temperature,
  judge,
  onProgress: (done, total) => {
    if (done % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total} runs`);
  },
});
process.stdout.write('\n');

const metrics = summarize(records, cases);
const gates = evaluateGates(metrics, config.thresholds);
const meta = { model: model.name, judge: judge?.name, date: new Date().toISOString().slice(0, 10), runsPerCase: runs };
const markdown = renderMarkdown(meta, metrics, gates);

const out = values.out!;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.md'), markdown);
writeFileSync(join(out, 'report.json'), JSON.stringify({ meta, metrics, gates }, null, 2));
writeFileSync(join(out, 'runs.jsonl'), renderJsonl(records));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');

console.log('');
for (const g of gates) {
  const cmp = g.direction === 'min' ? '>=' : '<=';
  console.log(`  ${g.passed ? 'PASS' : 'FAIL'}  ${g.name.padEnd(22)} ${(g.actual * 100).toFixed(1).padStart(6)}%  (needs ${cmp} ${(g.threshold * 100).toFixed(1)}%)`);
}
console.log(`\nReport written to ${join(out, 'report.md')}`);

// Exit codes: 0 all gates passed, 1 quality gate failed, 2 infrastructure errors (results untrustworthy).
if (metrics.infraErrors > 0) {
  console.error(`\n${metrics.infraErrors} run(s) failed at the model-call level. Check the API key, network and rate limits.`);
  process.exit(2);
}
process.exit(gates.every((g) => g.passed) ? 0 : 1);
