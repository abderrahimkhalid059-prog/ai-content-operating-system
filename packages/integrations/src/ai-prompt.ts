export interface PromptDefinition {
  identifier: string;
  version: number;
  systemInstructions?: string;
  userTemplate: string;
  requiredVariables: string[];
}

export interface RenderedPrompt {
  identifier: string;
  version: number;
  systemInstructions?: string;
  userPrompt: string;
}

export class PromptRegistry {
  private readonly prompts = new Map<string, PromptDefinition>();

  register(definition: PromptDefinition): void {
    if (!/^[a-z][a-z0-9._-]{2,119}$/.test(definition.identifier) || definition.version < 1) {
      throw new Error('Prompt identifier or version is invalid.');
    }
    const key = this.key(definition.identifier, definition.version);
    if (this.prompts.has(key)) throw new Error(`Prompt already registered: ${key}`);
    this.prompts.set(key, {
      ...definition,
      requiredVariables: [...new Set(definition.requiredVariables)].sort(),
    });
  }

  render(identifier: string, version: number, variables: Record<string, string>): RenderedPrompt {
    const definition = this.prompts.get(this.key(identifier, version));
    if (!definition) throw new Error(`Prompt version not found: ${identifier}@${version}`);
    const missing = definition.requiredVariables.filter(
      (variable) => !(variable in variables) || variables[variable] === '',
    );
    if (missing.length) throw new Error(`Missing prompt variables: ${missing.join(', ')}`);
    const replace = (template: string): string =>
      template.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (_match, variable: string) => {
        if (!(variable in variables)) throw new Error(`Missing prompt variable: ${variable}`);
        return variables[variable]!;
      });
    return {
      identifier,
      version,
      ...(definition.systemInstructions
        ? { systemInstructions: replace(definition.systemInstructions) }
        : {}),
      userPrompt: replace(definition.userTemplate),
    };
  }

  private key(identifier: string, version: number): string {
    return `${identifier}@${version}`;
  }
}
