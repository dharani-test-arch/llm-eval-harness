# llm-eval-harness

An evaluation harness for an LLM-powered feature: **document-grounded Q&A over company filings**.
It measures what matters when a model answers from source documents: is the answer **correct**, is every
citation **real**, does the model **refuse** when the documents don't say, and does it give **the same answer
every time**.

The harness is the point of the repo. It runs offline with a built-in mock model (so CI needs no API key)
and against the Anthropic API for real evaluation. Its own tests confirm it reaches the right verdict for
models of known behaviour.

## What is being evaluated

```
question + documents ──► model ──► {"can_answer": bool, "answer": "...", "citations": [{"doc_id", "quote"}]}
                                          │
                       deterministic checks (+ optional LLM judge)
                                          │
        accuracy · abstention · hallucination · citation faithfulness · consistency · reliability
                                          │
                              quality gates ──► pass / fail
```

- **Corpus:** four fictional filings and call transcripts (`data/corpus/`). Fictional on purpose: no copyright
  questions, and the correct answers are known exactly. They are not real companies.
- **Golden set:** 20 cases (`data/golden.json`): 10 lookups, 5 comparisons, 1 false-premise question, and
  4 unanswerable questions (a future year, a company not in the corpus, information the documents never state).

## Metrics

| Metric | Definition | Why it matters |
|---|---|---|
| **Accuracy** | Answerable questions that pass every check, including verified citations | The headline correctness number |
| **Abstention accuracy** | Unanswerable questions the model declined | A model that never says "I don't know" is dangerous in research workflows |
| **Hallucination rate** | Runs that answered the unanswerable, cited text not in the source, or stated forbidden content | The failure users trust least |
| **Citation faithfulness** | Citations whose quote appears **verbatim** in the cited document | Checked mechanically, with no judge model involved |
| **Format valid** | Output was parseable JSON of the required shape | Downstream code breaks on malformed output |
| **Consistency** | Average share of runs agreeing with the most common answer fingerprint | Non-deterministic models need repeated runs to expose instability |
| **Reliability (pass^k)** | Cases that passed on **every** run | A case passing 4 of 5 times is not a passing case |

Every rate is reported with a 95% Wilson confidence interval. With 20 cases the intervals are wide, so small
differences between runs or models are noise.

## Quick start

```bash
nvm use                       # Node 20
npm install

npm run validate:data         # check the answer key against the corpus
npm test                      # the harness's own tests
npm run eval:mock             # offline run, no API key needed
```

Against a real model:

```bash
export ANTHROPIC_API_KEY=...            # PowerShell: $env:ANTHROPIC_API_KEY="..."
npm run eval:live -- --runs 5
npm run eval:live -- --runs 5 --model <model-id> --judge
```

| Option | Default | Meaning |
|---|---|---|
| `--provider` | `mock` | `mock` or `anthropic` |
| `--model` | `claude-haiku-4-5-20251001` | Model to evaluate (or set `EVAL_MODEL`) |
| `--runs` | 5 | Repeats per case. Needed to see non-determinism |
| `--judge` | off | Add an LLM judge for cases that define a rubric |
| `--judge-model` | same as `--model` | Use a different model as the judge |
| `--temperature` | not sent | Override sampling. By default the model's own default is what gets measured |
| `--mock-mode` | `baseline` | `baseline`, `hallucinating`, or `flaky` |
| `--cases` | all | Only run cases whose id contains this text |
| `--concurrency` | 4 | Parallel requests |

Output goes to `results/`: `report.md` (human), `report.json` (machine), `runs.jsonl` (raw model output per run).

**Exit codes:** `0` all gates passed, `1` a quality gate failed, `2` the model calls themselves failed (bad key,
network, rate limit). Code 2 is kept separate so an API outage is never mistaken for a quality regression.

If you are behind a corporate proxy that re-signs TLS and requests fail with a certificate error, point Node
at your company root certificate: `NODE_EXTRA_CA_CERTS=path/to/corp-root.cer`.

## Does the harness itself work?

A harness that can't tell good from bad is worse than none. Its tests feed it models with **known behaviour**
and check the verdict (`test/meta.test.ts`). Five runs per case:

| Mock model | Accuracy | Abstention | Hallucination | Citation faithfulness | Format | Consistency | Reliability | Gates |
|---|---|---|---|---|---|---|---|---|
| `baseline` (extractive, honest) | 100% | 100% | 0% | 100% | 100% | 100% | 100% | all pass |
| `hallucinating` (fabricates numbers and quotes) | 61% | 55% | **40%** | **55%** | 100% | 78% | 5% | fails |
| `flaky` (wrong sentence, malformed JSON) | 61% | 85% | 0% | 100% | **92%** | **69%** | **15%** | fails |

The two failing models fail **differently**, which is the point. The flaky model never fabricates: its wrong
answers still quote real text, so hallucination stays at 0% while consistency and format collapse. A single
accuracy score would hide that difference.

The mock `baseline` is a keyword-retrieval sanity check for the *harness*. It says nothing about how a real LLM
performs. During development it answered "What is the annual salary of Northwind's CEO?" with another company's
CEO sentence, a near-miss hallucination that the unanswerable cases exist to catch. The harness flagged it
immediately, and the baseline was then taught to refuse questions about terms absent from every document.

## Design decisions

1. **Deterministic checks first, LLM judge second.** Facts, abstention and citations are checked by code, so
   results are reproducible and free. The judge only handles what string matching can't ("rejects the false
   premise"), only reviews answers that already passed, and can only fail a run, never rescue one.
2. **The judge fails closed.** If it errors or returns garbage, the run is rejected. A broken judge must not
   silently approve answers.
3. **Citations are verified, not trusted.** The model must quote the source verbatim, and the harness checks that
   the quote exists in the cited document. Very short quotes are rejected, and ellipses are allowed only if every
   kept segment is real.
4. **Repeated runs by default.** One run can't distinguish a stable model from a lucky one. Reliability (pass^k)
   treats a case as passing only if every run passes.
5. **Consistency compares facts, not phrasing.** Two differently worded correct answers agree. Two different
   wrong answers do not.
6. **Test the answer key.** `validate-dataset` confirms every expected fact actually appears in its source
   documents. A wrong key produces confident, meaningless scores.
7. **Infrastructure errors are not quality failures** (exit code 2, flagged in the report).
8. **Gates, not just numbers.** Thresholds live in `eval.config.json` and fail the build, so a quality regression
   blocks a merge the way a failing unit test does.
9. **Provider-agnostic.** Anything implementing `ModelClient` plugs in. The Anthropic adapter is about 80 lines
   of `fetch` with retry and backoff, and no SDK dependency.

## Limitations

- The corpus is small and fictional, and the golden set has 20 cases. Treat results as a demonstration of method,
  not a benchmark.
- Documents are passed whole in the prompt. There is no retrieval step, so retrieval quality isn't measured.
- Questions are single-hop. Multi-document reasoning is not covered yet.
- The LLM judge is not calibrated against human labels. Before trusting it, compare its verdicts to a human on a
  sample and report the agreement.
- Intervals assume independent runs; repeated runs of one question are correlated, so they are optimistic.
- Live results are not published yet. Run `npm run eval:live` and record them below.

## Results on real models

_TBD: run `npm run eval:live -- --runs 5 --judge` and paste the gate table here, with the model name and date._

## Ideas for extending

- Paraphrase variants of each question, to measure robustness to wording.
- A retrieval step over a larger corpus, scored with recall@k.
- Multi-document and calculation questions.
- Judge calibration against human labels.
- Tracking metrics over time to catch drift when a model version changes.

## Layout

```
data/corpus/        fictional source documents
data/golden.json    questions, expected facts, required sources, rubrics
eval.config.json    runs per case and quality-gate thresholds
src/answerer.ts     the feature under test: prompt, output parsing
src/score.ts        deterministic scoring of one run
src/judge.ts        optional LLM judge (fails closed)
src/metrics.ts      aggregation, confidence intervals, consistency
src/gates.ts        thresholds -> pass/fail
src/evaluate.ts     runs every case N times with bounded concurrency
src/models/         mock (three behaviours) and Anthropic adapter
test/               unit tests plus "tests of the tester" (meta.test.ts)
```
