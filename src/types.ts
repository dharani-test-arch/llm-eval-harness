export type CorpusDoc = { id: string; title: string; text: string };

export type Category = 'lookup' | 'comparison' | 'false_premise' | 'unanswerable';

export type GoldenCase = {
  id: string;
  category: Category;
  question: string;
  /** false = the documents do not contain the answer, so the model must abstain. */
  answerable: boolean;
  /**
   * Facts the answer must contain. Every group must match; within a group any one
   * alternative is enough. Matching is on normalised text (case, $, thousands commas ignored).
   */
  expectAll?: string[][];
  /** Text that must NOT appear in the answer. */
  forbid?: string[];
  /** Documents that must be cited (with a verified quote) for an answerable question. */
  sources?: string[];
  /** Optional rubric for an LLM judge, applied on top of the deterministic checks. */
  judgeRubric?: string;
};

export type Citation = { docId: string; quote: string };

export type ParsedAnswer = { canAnswer: boolean; answer: string; citations: Citation[] };

export type ModelRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Only used by the mock model, so simulated randomness is reproducible. */
  seed?: number;
};

export type ModelResponse = {
  text: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export interface ModelClient {
  readonly name: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export type CheckResult = {
  formatValid: boolean;
  abstentionCorrect: boolean;
  accurate: boolean;
  grounded: boolean;
  sourcesCited: boolean;
  judgePassed: boolean | null;
  hallucinated: boolean;
  citations: { total: number; verified: number };
  failures: string[];
};

export type RunRecord = {
  caseId: string;
  category: Category;
  answerable: boolean;
  runIndex: number;
  answer: ParsedAnswer | null;
  raw: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Set when the model call itself failed (network, auth, rate limit). Not a quality result. */
  error?: string;
  checks: CheckResult;
  passed: boolean;
  signature: string;
};
