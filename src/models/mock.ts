import { normalize } from '../text';
import type { ModelClient, ModelRequest, ModelResponse } from '../types';

/**
 * A deterministic stand-in for an LLM, so the harness can run (and be tested) without an API key.
 *
 *  baseline       extractive retrieval: returns the document sentence that best matches the question,
 *                 quotes it verbatim, and abstains when nothing matches well. This is a sanity baseline
 *                 for the HARNESS. It is not a claim about how a real LLM performs.
 *  hallucinating  like baseline, but sometimes fabricates numbers/quotes or answers unanswerable questions.
 *  flaky          like baseline, but sometimes returns the wrong sentence or malformed output.
 *
 * The two bad modes exist to prove the harness actually detects bad behaviour.
 * Randomness is seeded per (case, run) so results are reproducible.
 */
export type MockMode = 'baseline' | 'hallucinating' | 'flaky';

const ABSTAIN_BELOW = 0.5;
const MISBEHAVE_RATE = 0.35;

const STOP = new Set(
  'what was is the of in for a an how much many did does do who which were its it and to on by as at from with that this has have had be been are over per why when where whom whose than'.split(
    ' ',
  ),
);

function stem(word: string): string {
  let w = word;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

function tokenize(text: string): string[] {
  return (normalize(text).match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [])
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

type Doc = { id: string; title: string; text: string };
type Sentence = { docId: string; text: string; tokens: Set<string> };

function parseDocs(prompt: string): Doc[] {
  const docs: Doc[] = [];
  const re = /<document id="([^"]+)" title="([^"]*)">\n?([\s\S]*?)\n?<\/document>/g;
  for (const m of prompt.matchAll(re)) docs.push({ id: m[1], title: m[2], text: m[3] });
  return docs;
}

function sentencesOf(doc: Doc): Sentence[] {
  const titleTokens = tokenize(doc.title);
  const out: Sentence[] = [];
  for (const line of doc.text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue;
    for (const s of trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      if (s.length < 30) continue;
      // The document title gives each sentence its context (which company it is about).
      out.push({ docId: doc.id, text: s, tokens: new Set([...tokenize(s), ...titleTokens]) });
    }
  }
  return out;
}

type Ranked = { sentence: Sentence; score: number };

function rank(question: string, docs: Doc[]): Ranked[] {
  const sentences = docs.flatMap(sentencesOf);
  const n = sentences.length || 1;
  const df = new Map<string, number>();
  for (const s of sentences) for (const t of s.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 0.5));

  const q = [...new Set(tokenize(question))];
  const denom = q.reduce((sum, t) => sum + idf(t), 0) || 1;
  const years = q.filter((t) => /^(19|20)\d\d$/.test(t));

  // Asking about a term that appears nowhere in the documents means they cannot answer it.
  if (q.some((t) => !df.has(t))) return sentences.map((sentence) => ({ sentence, score: 0 }));

  return sentences
    .map((sentence) => {
      let score = q.filter((t) => sentence.tokens.has(t)).reduce((sum, t) => sum + idf(t), 0) / denom;
      // A year the question asks about that the sentence never mentions means a different period.
      if (years.some((y) => !sentence.tokens.has(y))) score = 0;
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function alter(sentence: string): string {
  return /\d/.test(sentence)
    ? sentence.replace(/\d+(?:\.\d+)?/, (m) => String(Number(m) + 7))
    : `${sentence} Management also confirmed this in writing.`;
}

export class MockModel implements ModelClient {
  readonly name: string;
  mode: MockMode;

  constructor(mode: MockMode = 'baseline') {
    this.mode = mode;
    this.name = `mock:${mode}`;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const started = performance.now();
    const docs = parseDocs(req.user);
    const question = /<question>([\s\S]*?)<\/question>/.exec(req.user)?.[1] ?? '';
    const ranked = rank(question, docs);
    const best = ranked[0];
    const second = ranked[1];
    const rng = mulberry32(req.seed ?? 0);
    const misbehave = this.mode !== 'baseline' && rng() < MISBEHAVE_RATE;
    const wouldAbstain = !best || best.score < ABSTAIN_BELOW;

    let text: string;
    if (this.mode === 'flaky' && misbehave && rng() < 0.3) {
      text = 'I believe the answer can be found in the quarterly results document.';
    } else if (this.mode === 'hallucinating' && misbehave && wouldAbstain) {
      const fake = (100 + Math.floor(rng() * 800)).toString() + '.' + Math.floor(rng() * 10);
      text = JSON.stringify({
        can_answer: true,
        answer: `The reported figure was $${fake} million.`,
        citations: [{ doc_id: docs[0]?.id ?? 'unknown', quote: `The reported figure was $${fake} million according to management.` }],
      });
    } else if (wouldAbstain) {
      text = JSON.stringify({ can_answer: false, answer: '', citations: [] });
    } else {
      let chosen = best;
      if (this.mode === 'flaky' && misbehave && second) chosen = second;
      let answer = chosen.sentence.text;
      let quote = chosen.sentence.text;
      if (this.mode === 'hallucinating' && misbehave) {
        answer = alter(answer);
        quote = answer; // fabricated quote: not in the document
      }
      text = JSON.stringify({
        can_answer: true,
        answer,
        citations: [{ doc_id: chosen.sentence.docId, quote }],
      });
    }

    return { text, latencyMs: performance.now() - started, inputTokens: 0, outputTokens: 0 };
  }
}
