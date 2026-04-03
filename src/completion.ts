/**
 * Shell tab-completion support for biocli.
 *
 * Provides:
 *  - Shell script generators for bash, zsh, and fish
 *  - Dynamic completion logic that returns candidates for the current cursor position
 */

import { getRegistry } from './registry.js';

// ── Dynamic completion logic ───────────────────────────────────────────────

/**
 * Built-in (non-dynamic) top-level commands.
 */
const BUILTIN_COMMANDS = [
  'list',
  'validate',
  'config',
  'completion',
];

/**
 * Return completion candidates given the current command-line words and cursor index.
 *
 * @param words  - The argv after 'biocli' (words[0] is the first arg, e.g. site name)
 * @param cursor - 1-based position of the word being completed (1 = first arg)
 */
export function getCompletions(words: string[], cursor: number): string[] {
  // cursor === 1 → completing the first argument (site name or built-in command)
  if (cursor <= 1) {
    const sites = new Set<string>();
    for (const [, cmd] of getRegistry()) {
      sites.add(cmd.site);
    }
    return [...BUILTIN_COMMANDS, ...sites].sort();
  }

  const site = words[0];

  // If the first word is a built-in command, no further completion
  if (BUILTIN_COMMANDS.includes(site)) {
    // Special case: 'config' has subcommands
    if (site === 'config' && cursor === 2) {
      return ['show', 'set', 'path'];
    }
    return [];
  }

  // cursor === 2 → completing the sub-command name under a site
  if (cursor === 2) {
    const subcommands: string[] = [];
    for (const [, cmd] of getRegistry()) {
      if (cmd.site === site) {
        subcommands.push(cmd.name);
        if (cmd.aliases?.length) subcommands.push(...cmd.aliases);
      }
    }
    return [...new Set(subcommands)].sort();
  }

  // cursor >= 3 → no further completion
  return [];
}

// ── Shell script generators ────────────────────────────────────────────────

export function generateCompletion(shell: 'bash' | 'zsh' | 'fish'): string {
  switch (shell) {
    case 'bash':
      return bashCompletionScript();
    case 'zsh':
      return zshCompletionScript();
    case 'fish':
      return fishCompletionScript();
  }
}

function bashCompletionScript(): string {
  return `# Bash completion for biocli
# Add to ~/.bashrc:  eval "$(biocli completion bash)"
_biocli_completions() {
  local cur words cword
  _get_comp_words_by_ref -n : cur words cword

  local completions
  completions=$(biocli --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)

  COMPREPLY=( $(compgen -W "$completions" -- "$cur") )
  __ltrim_colon_completions "$cur"
}
complete -F _biocli_completions biocli
`;
}

function zshCompletionScript(): string {
  return `# Zsh completion for biocli
# Add to ~/.zshrc:  eval "$(biocli completion zsh)"
_biocli() {
  local -a completions
  local cword=$((CURRENT - 1))
  completions=(\${(f)"$(biocli --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)"})
  compadd -a completions
}
compdef _biocli biocli
`;
}

function fishCompletionScript(): string {
  return `# Fish completion for biocli
# Add to ~/.config/fish/config.fish:  biocli completion fish | source
complete -c biocli -f -a '(
  set -l tokens (commandline -cop)
  set -l cursor (count (commandline -cop))
  biocli --get-completions --cursor $cursor $tokens[2..] 2>/dev/null
)'
`;
}

/**
 * Print the completion script for the requested shell.
 */
export function printCompletionScript(shell: string): void {
  if (shell !== 'bash' && shell !== 'zsh' && shell !== 'fish') {
    console.error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(generateCompletion(shell));
}
