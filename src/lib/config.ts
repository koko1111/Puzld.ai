import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export interface SecretConfig {
  name: string;
  url: string;
  apiKey: string;
  provider?: 'claude' | 'gemini' | 'codex' | 'ollama' | 'mistral' | 'custom';
  description?: string;
}

export interface PulzdConfig {
  defaultAgent: 'auto' | 'claude' | 'gemini' | 'codex' | 'ollama' | 'mistral';
  routerModel: string;
  timeout: number;
  fallbackAgent: string;
  confidenceThreshold: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  adapters: {
    claude: { enabled: boolean; path: string; model?: string; secretName?: string };
    gemini: { enabled: boolean; path: string; model?: string; secretName?: string };
    codex: { enabled: boolean; path: string; model?: string; secretName?: string };
    ollama: { enabled: boolean; model: string; host: string; maxTokens?: number; secretName?: string };
    mistral?: { enabled: boolean; path: string; model?: string; secretName?: string };
  };
  api: { port: number; host: string };
  ttyd: { port: number; enabled: boolean };
  // MCP Cloud integration
  cloud?: {
    endpoint: string;      // MCP server URL
    token?: string;        // JWT from login
    machineId?: string;    // Generated on first registration
  };
  // MCP Bridge settings
  mcp?: {
    port: number;          // Local bridge port (default: 9234)
    host: string;          // Local bridge host (default: 127.0.0.1)
  };
  // API Secrets (encrypted)
  secrets?: Record<string, SecretConfig>;
}

const CONFIG_DIR = join(homedir(), '.puzldai');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const OLD_CONFIG_DIR = join(homedir(), '.pulzdai');
const OLD_CONFIG_PATH = join(OLD_CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: PulzdConfig = {
  defaultAgent: 'auto',
  routerModel: 'llama3.2',
  timeout: 120000,
  fallbackAgent: 'claude',
  confidenceThreshold: 0.6,
  logLevel: 'info',
  adapters: {
    claude: { enabled: true, path: 'claude' },
    gemini: { enabled: true, path: 'gemini' },
    codex: { enabled: false, path: 'codex' },
    ollama: { enabled: true, model: 'llama3.2', host: 'http://localhost:11434' },
    mistral: { enabled: true, path: 'vibe' }
  },
  api: { port: 3000, host: '0.0.0.0' },
  ttyd: { port: 3001, enabled: true },
  cloud: {
    endpoint: 'https://api.puzld.cc'
  },
  mcp: {
    port: 9234,
    host: '127.0.0.1'
  },
  secrets: {}
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): PulzdConfig {
  // Migrate from old config path if new one doesn't exist
  if (!existsSync(CONFIG_PATH) && existsSync(OLD_CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const oldConfig = readFileSync(OLD_CONFIG_PATH, 'utf-8');
    writeFileSync(CONFIG_PATH, oldConfig);
    console.log('Migrated config from ~/.pulzdai to ~/.puzldai');
  }

  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    console.warn('Invalid config file, using defaults');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: PulzdConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let configInstance: PulzdConfig | null = null;

export function getConfig(): PulzdConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// Encryption helpers for secrets
const ALGORITHM = 'aes-256-gcm';
const SALT = 'puzldai-secret-salt-v1';

function getEncryptionKey(): Buffer {
  // Use machine-specific identifier for encryption key
  const machineId = process.env.PUZLD_MACHINE_ID || homedir();
  return scryptSync(machineId, SALT, 32);
}

export function encryptSecret(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptSecret(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Secret management functions
export function addSecret(name: string, url: string, apiKey: string, provider?: SecretConfig['provider'], description?: string): void {
  const config = getConfig();
  if (!config.secrets) {
    config.secrets = {};
  }

  config.secrets[name] = {
    name,
    url,
    apiKey: encryptSecret(apiKey),
    provider,
    description
  };

  saveConfig(config);
  configInstance = config;
}

export function getSecret(name: string): SecretConfig | undefined {
  const config = getConfig();
  const secret = config.secrets?.[name];

  if (!secret) {
    return undefined;
  }

  // Decrypt the API key when retrieving
  return {
    ...secret,
    apiKey: decryptSecret(secret.apiKey)
  };
}

export function listSecrets(): SecretConfig[] {
  const config = getConfig();
  if (!config.secrets) {
    return [];
  }

  return Object.values(config.secrets).map(secret => ({
    ...secret,
    apiKey: '***' // Don't expose the actual API key in listings
  }));
}

export function removeSecret(name: string): boolean {
  const config = getConfig();
  if (!config.secrets?.[name]) {
    return false;
  }

  delete config.secrets[name];
  saveConfig(config);
  configInstance = config;
  return true;
}
