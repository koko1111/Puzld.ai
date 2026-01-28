import { Ollama } from 'ollama';
import type { Adapter, ModelResponse, RunOptions } from '../lib/types';
import { getConfig, getSecret } from '../lib/config';

let ollamaClient: Ollama | null = null;
let lastConfigHash: string | null = null;

function getConfigHash(): string {
  const config = getConfig();
  return `${config.adapters.ollama.host}:${config.adapters.ollama.secretName || ''}`;
}

function getOllama(): Ollama {
  const configHash = getConfigHash();

  if (!ollamaClient || lastConfigHash !== configHash) {
    const config = getConfig();
    let host = config.adapters.ollama.host;
    const headers: Record<string, string> = {};

    // Use secret if configured
    if (config.adapters.ollama.secretName) {
      const secret = getSecret(config.adapters.ollama.secretName);
      if (secret) {
        host = secret.url;
        if (secret.apiKey) {
          headers['Authorization'] = `Bearer ${secret.apiKey}`;
        }
      }
    }

    ollamaClient = new Ollama({ host, headers });
    lastConfigHash = configHash;
  }

  return ollamaClient;
}

export const ollamaAdapter: Adapter = {
  name: 'ollama',

  async isAvailable(): Promise<boolean> {
    const config = getConfig();
    if (!config.adapters.ollama.enabled) return false;

    try {
      const ollama = getOllama();
      await ollama.list();
      return true;
    } catch {
      return false;
    }
  },

  async run(prompt: string, options?: RunOptions): Promise<ModelResponse> {
    const config = getConfig();
    const startTime = Date.now();
    // Note: Ollama is a pure LLM API with no native tools, so disableTools is a no-op
    const _disableTools = options?.disableTools ?? true;

    try {
      const ollama = getOllama();

      if (options?.onChunk) {
        let content = '';
        const response = await ollama.chat({
          model: config.adapters.ollama.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        });

        for await (const chunk of response) {
          if (options.signal?.aborted) break;
          content += chunk.message.content;
          options.onChunk(chunk.message.content);
        }

        return {
          content,
          model: `ollama/${config.adapters.ollama.model}`,
          duration: Date.now() - startTime
        };
      }

      const response = await ollama.chat({
        model: config.adapters.ollama.model,
        messages: [{ role: 'user', content: prompt }]
      });

      return {
        content: response.message.content,
        model: `ollama/${config.adapters.ollama.model}`,
        duration: Date.now() - startTime,
        tokens: {
          input: response.prompt_eval_count || 0,
          output: response.eval_count || 0
        }
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        content: '',
        model: `ollama/${config.adapters.ollama.model}`,
        duration: Date.now() - startTime,
        error: error.message
      };
    }
  }
};
