import { extractJson } from './answerer';
import type { GoldenCase, ModelClient, ParsedAnswer } from './types';

export const JUDGE_SYSTEM = `You are a strict grader. You are given a question about company documents, grading criteria, and a candidate answer. Decide whether the candidate answer satisfies ALL of the criteria. Do not reward length or confident tone.
Reply with a single JSON object and nothing else: {"verdict": "pass" or "fail", "reason": "one short sentence"}`;

/**
 * Semantic check for things string matching can't judge (e.g. "rejects the false premise").
 * It FAILS CLOSED: if the judge errors or returns something unparseable, the run is rejected,
 * so a broken judge can never silently wave answers through.
 */
export async function judgeAnswer(
  judge: ModelClient,
  c: GoldenCase,
  answer: ParsedAnswer,
): Promise<{ passed: boolean; reason: string }> {
  try {
    const res = await judge.complete({
      system: JUDGE_SYSTEM,
      user: `<question>${c.question}</question>\n<criteria>${c.judgeRubric ?? ''}</criteria>\n<candidate_answer>${answer.answer}</candidate_answer>`,
      maxTokens: 300,
      temperature: 0,
    });
    const data = extractJson(res.text) as { verdict?: string; reason?: string };
    if (data.verdict !== 'pass' && data.verdict !== 'fail') {
      return { passed: false, reason: 'judge returned no valid verdict' };
    }
    return { passed: data.verdict === 'pass', reason: data.reason ?? '' };
  } catch (e) {
    return { passed: false, reason: `judge error: ${(e as Error).message}` };
  }
}
