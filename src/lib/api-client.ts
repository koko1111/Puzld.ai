import { getSecret } from './config';
import type { SecretConfig } from './config';

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  created?: number;
}

export interface ApiClientOptions {
  url: string;
  apiKey: string;
  timeout?: number;
}

export class ApiClient {
  private url: string;
  private apiKey: string;
  private timeout: number;

  constructor(options: ApiClientOptions) {
    this.url = options.url.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = options.apiKey;
    this.timeout = options.timeout || 10000;
  }

  static fromSecret(secretName: string): ApiClient | null {
    const secret = getSecret(secretName);
    if (!secret) {
      return null;
    }

    return new ApiClient({
      url: secret.url,
      apiKey: secret.apiKey
    });
  }

  async fetchModels(provider?: string): Promise<ModelInfo[]> {
    try {
      // Different providers have different API endpoints for listing models
      const endpoint = this.getModelsEndpoint(provider);
      const headers = this.getHeaders(provider);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.url}${endpoint}`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseModelsResponse(data, provider);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('API request timed out');
        }
        throw error;
      }
      throw new Error('Unknown error fetching models');
    }
  }

  private getModelsEndpoint(provider?: string): string {
    switch (provider) {
      case 'claude':
        return '/v1/models';
      case 'gemini':
        return '/v1beta/models';
      case 'codex':
        return '/v1/models';
      case 'ollama':
        return '/api/tags';
      case 'mistral':
        return '/v1/models';
      default:
        // Try OpenAI-compatible endpoint as default
        return '/v1/models';
    }
  }

  private getHeaders(provider?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    switch (provider) {
      case 'claude':
        headers['x-api-key'] = this.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        break;
      case 'gemini':
        // Gemini typically uses API key in URL, but we'll try header too
        headers['Authorization'] = `Bearer ${this.apiKey}`;
        break;
      case 'ollama':
        // Ollama doesn't require authentication
        break;
      default:
        // OpenAI-compatible format
        headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private parseModelsResponse(data: unknown, provider?: string): ModelInfo[] {
    if (!data || typeof data !== 'object') {
      return [];
    }

    switch (provider) {
      case 'ollama':
        // Ollama format: { models: [{ name, model, size, ... }] }
        if ('models' in data && Array.isArray(data.models)) {
          return data.models.map((model: { name?: string; model?: string }) => ({
            id: model.name || model.model || 'unknown',
            name: model.name || model.model
          }));
        }
        break;

      case 'claude':
      case 'codex':
      case 'gemini':
      case 'mistral':
      default:
        // OpenAI-compatible format: { data: [{ id, created, ... }] }
        if ('data' in data && Array.isArray(data.data)) {
          return data.data.map((model: {
            id: string;
            name?: string;
            description?: string;
            created?: number;
          }) => ({
            id: model.id,
            name: model.name,
            description: model.description,
            created: model.created
          }));
        }

        // Also check if the response is directly an array
        if (Array.isArray(data)) {
          return data.map((model: {
            id: string;
            name?: string;
            description?: string;
            created?: number;
          }) => ({
            id: model.id,
            name: model.name,
            description: model.description,
            created: model.created
          }));
        }
    }

    return [];
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.fetchModels();
      return true;
    } catch {
      return false;
    }
  }
}

// Cache for model lists to avoid repeated API calls
interface ModelCache {
  models: ModelInfo[];
  timestamp: number;
}

const modelCache = new Map<string, ModelCache>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedModels(secretName: string, provider?: string): Promise<ModelInfo[]> {
  const cacheKey = `${secretName}:${provider || 'default'}`;
  const cached = modelCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.models;
  }

  const client = ApiClient.fromSecret(secretName);
  if (!client) {
    throw new Error(`Secret "${secretName}" not found`);
  }

  const models = await client.fetchModels(provider);
  modelCache.set(cacheKey, { models, timestamp: Date.now() });

  return models;
}

export function clearModelCache(secretName?: string): void {
  if (secretName) {
    // Clear cache for specific secret
    for (const key of modelCache.keys()) {
      if (key.startsWith(`${secretName}:`)) {
        modelCache.delete(key);
      }
    }
  } else {
    // Clear all cache
    modelCache.clear();
  }
}
