import type { ModelClient, ModelRequest, ModelResponse } from '../types';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal Anthropic Messages API client using fetch (no SDK dependency).
 * Retries rate limits and server errors with exponential backoff.
 * Temperature is only sent if you set one, so the model's own default sampling is what gets measured.
 */
export class AnthropicClient implements ModelClient {
  readonly name: string;
  model: string;
  apiKey: string;

  constructor(model: string = DEFAULT_MODEL, apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Export it, or use --provider mock for an offline run.');
    }
    this.model = model;
    this.apiKey = apiKey;
    this.name = `anthropic:${model}`;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;

    let lastError = 'unknown error';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const started = performance.now();
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });

        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          const retryAfter = Number(res.headers.get('retry-after'));
          await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        if (!res.ok) {
          throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }

        const json = (await res.json()) as {
          content?: { type: string; text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = (json.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');
        return {
          text,
          latencyMs: performance.now() - started,
          inputTokens: json.usage?.input_tokens,
          outputTokens: json.usage?.output_tokens,
        };
      } catch (e) {
        const message = (e as Error).message;
        // Client errors (bad key, bad request) will not improve by retrying.
        if (message.startsWith('Anthropic API')) throw e;
        lastError = message;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error(`Anthropic request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }
}
