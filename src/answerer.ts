import type { CorpusDoc, ModelClient, ParsedAnswer } from './types';

/**
 * The feature under test: answer a question using ONLY the supplied documents,
 * cite quotes, and abstain when the documents don't say.
 */
export const SYSTEM_PROMPT = `You answer questions about company filings using ONLY the documents provided.

Rules:
- Use only facts stated in the documents. Do not use outside knowledge.
- If the documents do not contain the answer, set "can_answer" to false and leave "answer" empty. Never guess.
- If the question contains a false assumption, say so using what the documents state.
- Support every answer with citations. Each citation has the document id and a quote copied verbatim from that document.
- Respond with a single JSON object and nothing else, in exactly this shape:
{"can_answer": true or false, "answer": "string", "citations": [{"doc_id": "string", "quote": "string"}]}`;

export function buildUserPrompt(question: string, corpus: CorpusDoc[]): string {
  const docs = corpus
    .map((d) => `<document id="${d.id}" title="${d.title}">\n${d.text.trim()}\n</document>`)
    .join('\n\n');
  return `${docs}\n\n<question>${question}</question>`;
}

/** Pull a JSON object out of model output, tolerating code fences and surrounding prose. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseAnswer(raw: string): { value?: ParsedAnswer; error?: string } {
  let data: any;
  try {
    data = extractJson(raw);
  } catch (e) {
    return { error: `unparseable output: ${(e as Error).message}` };
  }
  if (typeof data?.can_answer !== 'boolean') return { error: 'missing boolean "can_answer"' };
  if (typeof data.answer !== 'string') return { error: 'missing string "answer"' };

  const rawCitations: unknown[] = Array.isArray(data.citations) ? data.citations : [];
  const citations = [];
  for (const c of rawCitations as any[]) {
    if (!c || typeof c.doc_id !== 'string' || typeof c.quote !== 'string') {
      return { error: 'malformed citation (needs string doc_id and quote)' };
    }
    citations.push({ docId: c.doc_id, quote: c.quote });
  }
  return { value: { canAnswer: data.can_answer, answer: data.answer, citations } };
}

export type AnswerOutcome = {
  parsed: ParsedAnswer | null;
  parseError?: string;
  raw: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** The model call itself failed (network, auth, rate limit): not a quality result. */
  error?: string;
};

export async function answerQuestion(
  model: ModelClient,
  corpus: CorpusDoc[],
  question: string,
  opts: { temperature?: number; seed?: number } = {},
): Promise<AnswerOutcome> {
  try {
    const res = await model.complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(question, corpus),
      maxTokens: 1024,
      temperature: opts.temperature,
      seed: opts.seed,
    });
    const { value, error } = parseAnswer(res.text);
    return {
      parsed: value ?? null,
      parseError: error,
      raw: res.text,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    };
  } catch (e) {
    return { parsed: null, raw: '', latencyMs: 0, error: (e as Error).message };
  }
}
