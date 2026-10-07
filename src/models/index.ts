import type { ModelClient } from '../types';
import { AnthropicClient, DEFAULT_MODEL } from './anthropic';
import { MockModel, type MockMode } from './mock';

export type { MockMode };

export function createModel(provider: string, opts: { model?: string; mockMode?: MockMode } = {}): ModelClient {
  switch (provider) {
    case 'mock':
      return new MockModel(opts.mockMode ?? 'baseline');
    case 'anthropic':
      return new AnthropicClient(opts.model || process.env.EVAL_MODEL || DEFAULT_MODEL);
    default:
      throw new Error(`Unknown provider "${provider}". Use "mock" or "anthropic".`);
  }
}
