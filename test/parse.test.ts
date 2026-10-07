import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../src/answerer';

const body = '{"can_answer": true, "answer": "It was 5.", "citations": [{"doc_id": "d1", "quote": "five is the number"}]}';

describe('parseAnswer', () => {
  it('parses clean JSON', () => {
    const { value, error } = parseAnswer(body);
    expect(error).toBeUndefined();
    expect(value?.canAnswer).toBe(true);
    expect(value?.citations[0].docId).toBe('d1');
  });

  it('parses JSON inside a markdown code fence', () => {
    expect(parseAnswer('```json\n' + body + '\n```').value?.answer).toBe('It was 5.');
  });

  it('parses JSON surrounded by prose', () => {
    expect(parseAnswer('Sure! Here you go: ' + body + ' Hope that helps.').value?.answer).toBe('It was 5.');
  });

  it('reports output that is not JSON', () => {
    expect(parseAnswer('I think it is five.').error).toMatch(/unparseable/);
  });

  it('requires a boolean can_answer', () => {
    expect(parseAnswer('{"answer": "x", "citations": []}').error).toMatch(/can_answer/);
  });

  it('requires a string answer', () => {
    expect(parseAnswer('{"can_answer": true, "citations": []}').error).toMatch(/answer/);
  });

  it('rejects a malformed citation instead of silently dropping it', () => {
    expect(parseAnswer('{"can_answer": true, "answer": "x", "citations": [{"doc_id": "d1"}]}').error).toMatch(/citation/);
  });

  it('treats missing citations as an empty list', () => {
    expect(parseAnswer('{"can_answer": false, "answer": ""}').value?.citations).toHaveLength(0);
  });
});
