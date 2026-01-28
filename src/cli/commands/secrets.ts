import pc from 'picocolors';
import { addSecret, getSecret, listSecrets, removeSecret, getConfig, saveConfig } from '../../lib/config';
import { createInterface } from 'readline';
import type { SecretConfig } from '../../lib/config';

function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    if (hidden) {
      const stdin = process.stdin;
      // @ts-ignore
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      process.stdout.write(question);
      let input = '';

      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.removeListener('data', onData);
          // @ts-ignore
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(input);
        } else if (char === '\u0003') {
          process.exit(0);
        } else if (char === '\b' || char === '\x7f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += char;
          process.stdout.write('*');
        }
      };

      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

export async function secretsAddCommand(
  name?: string,
  options?: { url?: string; apiKey?: string; provider?: string; description?: string }
): Promise<void> {
  try {
    // Prompt for missing values
    const secretName = name || await prompt('Secret name: ');
    const url = options?.url || await prompt('API URL: ');
    const apiKey = options?.apiKey || await prompt('API Key: ', true);
    const provider = options?.provider as SecretConfig['provider'] | undefined;
    const description = options?.description;

    if (!secretName || !url || !apiKey) {
      console.error(pc.red('Error: name, url, and apiKey are required'));
      process.exit(1);
    }

    addSecret(secretName, url, apiKey, provider, description);
    console.log(pc.green(`✓ Secret "${secretName}" added successfully`));
  } catch (error) {
    console.error(pc.red(`Error adding secret: ${error}`));
    process.exit(1);
  }
}

export function secretsListCommand(): void {
  const secrets = listSecrets();

  if (secrets.length === 0) {
    console.log(pc.yellow('No secrets configured'));
    return;
  }

  console.log(pc.bold('\nConfigured Secrets:\n'));

  for (const secret of secrets) {
    console.log(pc.cyan(`${secret.name}:`));
    console.log(`  URL:      ${secret.url}`);
    console.log(`  API Key:  ${secret.apiKey}`);
    if (secret.provider) {
      console.log(`  Provider: ${secret.provider}`);
    }
    if (secret.description) {
      console.log(`  Description: ${secret.description}`);
    }
    console.log();
  }
}

export function secretsShowCommand(name: string): void {
  const secret = getSecret(name);

  if (!secret) {
    console.error(pc.red(`Secret "${name}" not found`));
    process.exit(1);
  }

  console.log(pc.bold(`\nSecret: ${name}\n`));
  console.log(`  URL:      ${secret.url}`);
  console.log(`  API Key:  ${secret.apiKey}`);
  if (secret.provider) {
    console.log(`  Provider: ${secret.provider}`);
  }
  if (secret.description) {
    console.log(`  Description: ${secret.description}`);
  }
  console.log();
}

export function secretsRemoveCommand(name: string): void {
  const removed = removeSecret(name);

  if (!removed) {
    console.error(pc.red(`Secret "${name}" not found`));
    process.exit(1);
  }

  console.log(pc.green(`✓ Secret "${name}" removed successfully`));
}

export function secretsLinkCommand(agent: string, secretName: string): void {
  const validAgents = ['claude', 'gemini', 'codex', 'ollama', 'mistral'];

  if (!validAgents.includes(agent)) {
    console.error(pc.red(`Invalid agent: ${agent}`));
    console.log(pc.dim(`Valid agents: ${validAgents.join(', ')}`));
    process.exit(1);
  }

  // Verify secret exists
  const secret = getSecret(secretName);
  if (!secret) {
    console.error(pc.red(`Secret "${secretName}" not found`));
    process.exit(1);
  }

  const config = getConfig();
  const agentKey = agent as keyof typeof config.adapters;

  if (!config.adapters[agentKey]) {
    console.error(pc.red(`Agent "${agent}" not found in config`));
    process.exit(1);
  }

  // Link secret to agent
  (config.adapters[agentKey] as { secretName?: string }).secretName = secretName;
  saveConfig(config);

  console.log(pc.green(`✓ Linked secret "${secretName}" to agent "${agent}"`));
}

export function secretsUnlinkCommand(agent: string): void {
  const validAgents = ['claude', 'gemini', 'codex', 'ollama', 'mistral'];

  if (!validAgents.includes(agent)) {
    console.error(pc.red(`Invalid agent: ${agent}`));
    console.log(pc.dim(`Valid agents: ${validAgents.join(', ')}`));
    process.exit(1);
  }

  const config = getConfig();
  const agentKey = agent as keyof typeof config.adapters;

  if (!config.adapters[agentKey]) {
    console.error(pc.red(`Agent "${agent}" not found in config`));
    process.exit(1);
  }

  // Unlink secret from agent
  delete (config.adapters[agentKey] as { secretName?: string }).secretName;
  saveConfig(config);

  console.log(pc.green(`✓ Unlinked secret from agent "${agent}"`));
}
