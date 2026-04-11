/**
 * Shared YAML CLI definition types.
 * Used by both discovery.ts (runtime) and build-manifest.ts (build-time).
 *
 * Also provides parseYamlCli() which converts a raw YAML object into a
 * CliCommand and registers it via cli().
 */

import type { Arg } from './registry.js';
import { cli, Strategy } from './registry.js';

// ── YAML definition interfaces ──────────────────────────────────────────────

export interface YamlArgDefinition {
  type?: string;
  default?: unknown;
  required?: boolean;
  positional?: boolean;
  description?: string;
  help?: string;
  choices?: string[];
  producedBy?: string[];
}

export interface YamlCliDefinition {
  site?: string;
  name?: string;
  description?: string;
  database?: string;
  strategy?: string;
  args?: Record<string, YamlArgDefinition>;
  columns?: string[];
  pipeline?: Record<string, unknown>[];
  timeout?: number;
  defaultFormat?: string;
  aliases?: string[];
}

// ── Arg normalizer ──────────────────────────────────────────────────────────

/** Convert YAML args definition to the internal Arg[] format. */
export function parseYamlArgs(args: Record<string, YamlArgDefinition> | undefined): Arg[] {
  if (!args || typeof args !== 'object') return [];
  const result: Arg[] = [];
  for (const [argName, argDef] of Object.entries(args)) {
    result.push({
      name: argName,
      type: argDef?.type ?? 'str',
      default: argDef?.default,
      required: argDef?.required ?? false,
      positional: argDef?.positional ?? false,
      help: argDef?.description ?? argDef?.help ?? '',
      choices: argDef?.choices,
      producedBy: Array.isArray(argDef?.producedBy)
        ? argDef.producedBy.filter((value): value is string => typeof value === 'string')
        : undefined,
    });
  }
  return result;
}

// ── YAML → CliCommand ───────────────────────────────────────────────────────

function parseStrategy(rawStrategy: string | undefined): Strategy {
  if (!rawStrategy) return Strategy.PUBLIC;
  const upper = rawStrategy.toUpperCase();
  if (upper === 'API_KEY') return Strategy.API_KEY;
  return Strategy.PUBLIC;
}

/**
 * Parse a raw YAML object into a CliCommand and register it.
 *
 * @param raw     Parsed YAML object (from js-yaml.load)
 * @param source  File path or identifier for debugging
 * @param defaultSite  Fallback site name if not specified in YAML (e.g. derived from directory name)
 */
export function parseYamlCli(
  raw: YamlCliDefinition,
  source: string,
  defaultSite?: string,
): void {
  const site = raw.site ?? defaultSite ?? 'unknown';
  const name = raw.name ?? source.replace(/\.(yaml|yml)$/, '').split('/').pop() ?? 'unnamed';
  const strategy = parseStrategy(raw.strategy);
  const args = parseYamlArgs(raw.args);

  cli({
    site,
    name,
    aliases: raw.aliases,
    description: raw.description,
    database: raw.database,
    strategy,
    args,
    columns: raw.columns,
    pipeline: raw.pipeline,
    timeoutSeconds: raw.timeout,
    defaultFormat: raw.defaultFormat as CliCommand['defaultFormat'],
  });
}

// Re-import type for the defaultFormat cast
import type { CliCommand } from './registry.js';
