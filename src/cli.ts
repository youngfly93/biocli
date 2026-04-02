/**
 * CLI entry point: registers built-in commands and wires up Commander.
 *
 * Built-in commands are registered inline here (list, validate, config, etc.).
 * Dynamic adapter commands are registered via commander-adapter.ts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { render as renderOutput } from './output.js';
import { getVersion } from './version.js';
import { printCompletionScript, getCompletions } from './completion.js';
import { registerAllCommands } from './commander-adapter.js';
import { validateAll } from './validate.js';
import { loadConfig, saveConfig, getConfigPath } from './config.js';
import { BUILTIN_CLIS_DIR, USER_CLIS_DIR } from './discovery.js';

export function runCli(): void {
  const program = new Command();
  const version = getVersion();

  program
    .name('ncbicli')
    .description('Query NCBI databases from the terminal')
    .version(version)
    .enablePositionalOptions()
    .addHelpText('before', `
  ${chalk.bold.cyan('ncbicli')} ${chalk.dim(`v${version}`)}  ${chalk.dim('─')}  Query NCBI databases from the terminal
  ${chalk.dim('PubMed · Gene · GEO · SRA · ClinVar · SNP · Taxonomy')}
`)
    .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('ncbicli pubmed search "CRISPR cancer"')}       Search PubMed articles
  ${chalk.cyan('ncbicli pubmed fetch 30684591')}               Get article details by PMID
  ${chalk.cyan('ncbicli pubmed abstract 30684591')}            Get abstract text
  ${chalk.cyan('ncbicli pubmed cited-by 30684591')}            Find citing articles
  ${chalk.cyan('ncbicli gene search TP53')}                    Search genes
  ${chalk.cyan('ncbicli gene info 7157')}                      Gene details by ID
  ${chalk.cyan('ncbicli geo search "breast cancer RNA-seq"')}  Search GEO datasets
  ${chalk.cyan('ncbicli sra search "CRISPR human"')}           Search SRA runs
  ${chalk.cyan('ncbicli clinvar search BRCA1')}                Search clinical variants
  ${chalk.cyan('ncbicli snp lookup rs334')}                    Look up SNP by rsID
  ${chalk.cyan('ncbicli taxonomy lookup "Homo sapiens"')}      Taxonomy lookup

${chalk.bold('Output formats:')}
  -f table ${chalk.dim('(default)')}    -f json     -f csv
  -f yaml                -f md       -f plain

${chalk.bold('Configuration:')}
  ${chalk.cyan('ncbicli config set api_key YOUR_KEY')}   Set NCBI API key (increases rate limit to 10 req/s)
  ${chalk.cyan('ncbicli config set email you@example.com')}
  ${chalk.cyan('ncbicli config show')}                   Show current config
`);

  // ── Hidden: shell completion data endpoint ──────────────────────────────
  program
    .option('--get-completions', 'Internal: return completion candidates')
    .option('--cursor <n>', 'Internal: cursor position for completions');

  // ── Built-in: list ────────────────────────────────────────────────────────

  program
    .command('list')
    .description('List all available CLI commands')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .option('--json', 'JSON output (shorthand)')
    .action((opts) => {
      const registry = getRegistry();
      const commands = [...new Set(registry.values())].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      const fmt = opts.json && opts.format === 'table' ? 'json' : opts.format;

      if (fmt !== 'table') {
        const rows = commands.map(c => ({
          command: fullName(c),
          site: c.site,
          name: c.name,
          aliases: c.aliases?.join(', ') ?? '',
          description: c.description,
          strategy: strategyLabel(c),
          database: c.database ?? '',
        }));
        renderOutput(rows, {
          fmt,
          columns: ['command', 'site', 'name', 'aliases', 'description', 'strategy', 'database'],
          title: 'ncbicli/list',
          source: 'ncbicli list',
        });
        return;
      }

      // Table (default) — grouped by site
      const sites = new Map<string, CliCommand[]>();
      for (const cmd of commands) {
        const g = sites.get(cmd.site) ?? [];
        g.push(cmd);
        sites.set(cmd.site, g);
      }

      console.log();
      console.log(chalk.bold('  ncbicli') + chalk.dim(' — available commands'));
      console.log();
      for (const [site, cmds] of sites) {
        console.log(chalk.bold.cyan(`  ${site}`));
        for (const cmd of cmds) {
          const label = strategyLabel(cmd);
          const tag = label === 'public'
            ? chalk.green('[public]')
            : chalk.yellow(`[${label}]`);
          const aliases = cmd.aliases?.length ? chalk.dim(` (aliases: ${cmd.aliases.join(', ')})`) : '';
          const db = cmd.database ? chalk.dim(` [${cmd.database}]`) : '';
          console.log(`    ${cmd.name} ${tag}${db}${aliases}${cmd.description ? chalk.dim(` — ${cmd.description}`) : ''}`);
        }
        console.log();
      }
      console.log(chalk.dim(`  ${commands.length} commands total`));
    });

  // ── Built-in: validate ────────────────────────────────────────────────────

  program
    .command('validate')
    .description('Validate YAML adapter definitions')
    .option('-d, --dir <path>', 'Directory to validate', BUILTIN_CLIS_DIR)
    .action((opts) => {
      const dirs = [opts.dir];
      // Also check user CLIs if they exist
      try {
        const { existsSync } = require('node:fs');
        if (existsSync(USER_CLIS_DIR)) dirs.push(USER_CLIS_DIR);
      } catch { /* ignore */ }

      let totalErrors = 0;
      for (const dir of dirs) {
        const results = validateAll(dir);
        if (results.length === 0) {
          console.log(chalk.green(`All YAML definitions in ${dir} are valid.`));
          continue;
        }

        for (const result of results) {
          console.error(chalk.red(`\n${result.file}:`));
          for (const error of result.errors) {
            console.error(chalk.yellow(`  - ${error}`));
          }
          totalErrors += result.errors.length;
        }
      }

      if (totalErrors > 0) {
        console.error(chalk.red(`\n${totalErrors} validation error(s) found.`));
        process.exitCode = 1;
      }
    });

  // ── Built-in: config ──────────────────────────────────────────────────────

  const configCmd = program
    .command('config')
    .description('Manage ncbicli configuration');

  configCmd
    .command('show')
    .description('Show current configuration')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml', 'yaml')
    .action((opts) => {
      const config = loadConfig();
      // Mask API key for display
      const display = { ...config };
      if (display.api_key) {
        display.api_key = display.api_key.slice(0, 4) + '****' + display.api_key.slice(-4);
      }
      renderOutput([display], { fmt: opts.format, title: 'ncbicli/config' });
    });

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value (api_key, email, defaults.format, defaults.limit)')
    .action((key: string, value: string) => {
      const config = loadConfig();
      if (key === 'api_key' || key === 'email') {
        (config as Record<string, unknown>)[key] = value;
      } else if (key === 'defaults.format') {
        config.defaults = config.defaults ?? {};
        config.defaults.format = value;
      } else if (key === 'defaults.limit') {
        config.defaults = config.defaults ?? {};
        config.defaults.limit = parseInt(value, 10);
        if (isNaN(config.defaults.limit)) {
          console.error(chalk.red(`Invalid limit value: "${value}". Must be a number.`));
          process.exitCode = 1;
          return;
        }
      } else {
        console.error(chalk.red(`Unknown config key: "${key}".`));
        console.error(chalk.dim('Valid keys: api_key, email, defaults.format, defaults.limit'));
        process.exitCode = 1;
        return;
      }
      saveConfig(config);
      console.log(chalk.green(`Set ${key} = ${key === 'api_key' ? '****' : value}`));
    });

  configCmd
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(getConfigPath());
    });

  // ── Built-in: completion ──────────────────────────────────────────────────

  program
    .command('completion [shell]')
    .description('Output shell completion script (bash, zsh, fish)')
    .action((shell?: string) => {
      printCompletionScript(shell ?? 'bash');
    });

  // ── Register dynamic adapter commands ─────────────────────────────────────

  registerAllCommands(program);

  // ── Handle hidden --get-completions flag ─────────────────────────────────

  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--get-completions')) {
    const cursorIdx = rawArgs.indexOf('--cursor');
    const cursor = cursorIdx >= 0 ? parseInt(rawArgs[cursorIdx + 1], 10) : 1;
    const words = rawArgs.filter((a, i) =>
      a !== '--get-completions' && i !== cursorIdx && i !== cursorIdx + 1,
    );
    const candidates = getCompletions(words, cursor);
    if (candidates.length > 0) {
      process.stdout.write(candidates.join('\n') + '\n');
    }
    return;
  }

  // ── Parse and execute ────────────────────────────────────────────────────���

  program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  });
}
