import pc from 'picocolors';
import { getConfig, saveConfig } from '../../lib/config';
import { getModelSuggestions, getModelSuggestionsAsync, KNOWN_MODELS, getAvailableModels } from '../../lib/models';

type Agent = 'claude' | 'gemini' | 'codex' | 'ollama';

export function modelShowCommand(): void {
  const config = getConfig();

  console.log(pc.bold('\nCurrent Model Settings:\n'));

  const agents: Agent[] = ['claude', 'gemini', 'codex', 'ollama'];

  for (const agent of agents) {
    const model = config.adapters[agent]?.model || '(default)';
    console.log(`  ${pc.cyan(agent.padEnd(8))} ${model}`);
  }

  console.log();
}

export async function modelListCommand(agent?: string): Promise<void> {
  if (agent) {
    console.log(pc.bold(`\nFetching available models for ${agent}...\n`));

    try {
      // Try to get models from API first
      const models = await getAvailableModels(agent);
      const suggestions = await getModelSuggestionsAsync(agent);

      if (models.length === 0 && suggestions.length === 0) {
        console.log(pc.yellow(`No known models for agent: ${agent}`));
        return;
      }

      console.log(pc.bold(`Available models for ${agent}:\n`));

      // Show aliases if any
      const agentModels = KNOWN_MODELS[agent];
      if (agentModels && agentModels.aliases.length > 0) {
        console.log(pc.cyan('Aliases:'));
        for (const alias of agentModels.aliases) {
          console.log(`  ${alias}`);
        }
        console.log();
      }

      // Show models
      if (models.length > 0) {
        console.log(pc.cyan('Models:'));
        for (const model of models) {
          let line = `  ${model.id}`;
          if (model.name && model.name !== model.id) {
            line += pc.dim(` (${model.name})`);
          }
          console.log(line);
        }
      } else {
        console.log(pc.cyan('Models:'));
        for (const model of suggestions) {
          console.log(`  ${model}`);
        }
      }
    } catch (error) {
      console.error(pc.red(`Error fetching models: ${error}`));

      // Fallback to known models
      const suggestions = getModelSuggestions(agent);
      if (suggestions.length > 0) {
        console.log(pc.yellow('\nFalling back to known models:\n'));
        for (const model of suggestions) {
          console.log(`  ${model}`);
        }
      }
    }
  } else {
    console.log(pc.bold('\nAvailable models by agent:\n'));
    for (const [agentName, agentModels] of Object.entries(KNOWN_MODELS)) {
      if (agentName === 'ollama') continue; // Skip ollama (dynamic)

      console.log(pc.cyan(`${agentName}:`));
      if (agentModels.aliases.length > 0) {
        console.log(pc.dim(`  Aliases: ${agentModels.aliases.join(', ')}`));
      }
      for (const model of agentModels.models) {
        console.log(`  ${model}`);
      }
      console.log();
    }
  }
}

export async function modelSetCommand(agent: string, model: string): Promise<void> {
  const validAgents: Agent[] = ['claude', 'gemini', 'codex', 'ollama'];

  if (!validAgents.includes(agent as Agent)) {
    console.error(pc.red(`Invalid agent: ${agent}`));
    console.log(pc.dim(`Valid agents: ${validAgents.join(', ')}`));
    process.exit(1);
  }

  const config = getConfig();
  const agentKey = agent as Agent;

  // Warn if unknown model
  try {
    const suggestions = await getModelSuggestionsAsync(agent);
    if (suggestions.length > 0 && !suggestions.includes(model)) {
      console.log(pc.yellow(`Warning: "${model}" is not a known model for ${agent}`));
      console.log(pc.dim(`Known models: ${suggestions.slice(0, 10).join(', ')}${suggestions.length > 10 ? '...' : ''}`));
    }
  } catch {
    // Ignore errors, just skip validation
  }

  // Update config
  if (!config.adapters[agentKey]) {
    (config.adapters as Record<string, object>)[agentKey] = {};
  }
  (config.adapters[agentKey] as { model?: string }).model = model;

  saveConfig(config);

  console.log(pc.green(`✓ Set ${agent} model to: ${model}`));
}

export function modelClearCommand(agent: string): void {
  const validAgents: Agent[] = ['claude', 'gemini', 'codex', 'ollama'];

  if (!validAgents.includes(agent as Agent)) {
    console.error(pc.red(`Invalid agent: ${agent}`));
    console.log(pc.dim(`Valid agents: ${validAgents.join(', ')}`));
    process.exit(1);
  }

  const config = getConfig();
  const agentKey = agent as Agent;

  if (config.adapters[agentKey]) {
    delete (config.adapters[agentKey] as { model?: string }).model;
    saveConfig(config);
  }

  console.log(pc.green(`✓ Cleared ${agent} model (will use CLI default)`));
}
