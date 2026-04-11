/**
 * CLI discovery: finds YAML/TS CLI definitions and registers them.
 *
 * Supports two modes:
 * 1. FAST PATH (manifest): If a pre-compiled cli-manifest.json exists,
 *    registers all YAML commands instantly without runtime YAML parsing.
 *    TS modules are loaded lazily only when their command is executed.
 * 2. FALLBACK (filesystem scan): Traditional runtime discovery for development.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { type CliCommand, type InternalCliCommand, type Arg, Strategy, registerCommand } from './registry.js';
import { getErrorMessage } from './errors.js';
import type { ManifestEntry } from './build-manifest.js';
import { type YamlCliDefinition, parseYamlArgs, parseYamlCli } from './yaml-schema.js';
import { isRecord } from './utils.js';

// ── Directory paths ─────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Built-in CLIs directory: dist/clis/ or src/clis/ */
export const BUILTIN_CLIS_DIR = path.join(__dirname, 'clis');

/** User runtime directory: ~/.biocli */
export const USER_BIOCLI_DIR = path.join(os.homedir(), '.biocli');
/** @deprecated Use USER_BIOCLI_DIR. */
export const USER_NCBICLI_DIR = USER_BIOCLI_DIR;

/** User CLIs directory: ~/.biocli/clis/ */
export const USER_CLIS_DIR = path.join(USER_BIOCLI_DIR, 'clis');

/** Plugins directory: ~/.biocli/plugins/ */
export const PLUGINS_DIR = path.join(USER_BIOCLI_DIR, 'plugins');

/** Matches files that register commands via cli() or lifecycle hooks */
const PLUGIN_MODULE_PATTERN = /\b(?:cli|onStartup|onBeforeExecute|onAfterExecute)\s*\(/;

// ── Strategy parser ─────────────────────────────────────────────────────────

function parseStrategy(rawStrategy: string | undefined): Strategy {
  if (!rawStrategy) return Strategy.PUBLIC;
  const upper = rawStrategy.toUpperCase();
  if (upper === 'API_KEY') return Strategy.API_KEY;
  return Strategy.PUBLIC;
}

// ── Main discovery entry point ──────────────────────────────────────────────

/**
 * Discover and register CLI commands.
 * Uses pre-compiled manifest when available for instant startup.
 */
export async function discoverClis(...dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    // Fast path: try manifest first (production / post-build)
    const manifestPath = path.resolve(dir, '..', 'cli-manifest.json');
    try {
      await fs.promises.access(manifestPath);
      const loaded = await loadFromManifest(manifestPath, dir);
      if (loaded) continue; // Skip filesystem scan only when manifest is usable
    } catch {
      // Fall through to filesystem scan
    }
    await discoverClisFromFs(dir);
  }
}

// ── Fast path: manifest loading ─────────────────────────────────────────────

/**
 * Fast-path: register commands from pre-compiled manifest.
 * YAML pipelines are inlined — zero YAML parsing at runtime.
 * TS modules are deferred — loaded lazily on first execution.
 */
async function loadFromManifest(manifestPath: string, clisDir: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as ManifestEntry[];
    for (const entry of manifest) {
      if (entry.type === 'yaml') {
        // YAML pipelines fully inlined in manifest — register directly
        const strategy = parseStrategy(entry.strategy);
        const cmd: CliCommand = {
          site: entry.site,
          name: entry.name,
          aliases: entry.aliases,
          description: entry.description ?? '',
          database: entry.database,
          strategy,
          args: entry.args ?? [],
          columns: entry.columns,
          pipeline: entry.pipeline,
          requiredEnv: entry.requiredEnv,
          examples: entry.examples,
          readOnly: entry.readOnly,
          sideEffects: entry.sideEffects,
          artifacts: entry.artifacts,
          timeoutSeconds: entry.timeout,
          source: `manifest:${entry.site}/${entry.name}`,
          defaultFormat: entry.defaultFormat,
          deprecated: entry.deprecated,
          replacedBy: entry.replacedBy,
          noContext: entry.noContext === true ? true : undefined,
          noBatch: entry.noBatch === true ? true : undefined,
        };
        registerCommand(cmd);
      } else if (entry.type === 'ts' && entry.modulePath) {
        // TS adapters: register a lightweight stub.
        // The actual module is loaded lazily on first executeCommand().
        // CRITICAL: noContext MUST be propagated to the stub. Without it,
        // executeCommand() inspects the stub BEFORE lazy-loading and would
        // (a) build an HttpContext via createHttpContextForDatabase() (with
        //     a silent NCBI fallback for unknown database ids), and
        // (b) write the result into the response cache.
        // Both behaviors defeat the purpose of marking a command noContext.
        const strategy = parseStrategy(entry.strategy ?? 'public');
        const modulePath = path.resolve(clisDir, entry.modulePath);
        const cmd: InternalCliCommand = {
          site: entry.site,
          name: entry.name,
          aliases: entry.aliases,
          description: entry.description ?? '',
          database: entry.database,
          strategy,
          args: entry.args ?? [],
          columns: entry.columns,
          requiredEnv: entry.requiredEnv,
          examples: entry.examples,
          readOnly: entry.readOnly,
          sideEffects: entry.sideEffects,
          artifacts: entry.artifacts,
          timeoutSeconds: entry.timeout,
          source: modulePath,
          defaultFormat: entry.defaultFormat,
          deprecated: entry.deprecated,
          replacedBy: entry.replacedBy,
          noContext: entry.noContext === true ? true : undefined,
          noBatch: entry.noBatch === true ? true : undefined,
          _lazy: true,
          _modulePath: modulePath,
        };
        registerCommand(cmd);
      }
    }
    return true;
  } catch (err) {
    console.error(`[biocli] Failed to load manifest ${manifestPath}: ${getErrorMessage(err)}`);
    return false;
  }
}

// ── Fallback: filesystem scan ───────────────────────────────────────────────

/**
 * Check if a .ts/.js file looks like a CLI module (contains cli() call).
 */
async function isCliModule(filePath: string): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return PLUGIN_MODULE_PATTERN.test(content);
  } catch {
    return false;
  }
}

/**
 * Fallback: traditional filesystem scan (used during development with tsx).
 */
async function discoverClisFromFs(dir: string): Promise<void> {
  try { await fs.promises.access(dir); } catch { return; }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  const sitePromises = entries
    .filter(entry => entry.isDirectory())
    .map(async (entry) => {
      const site = entry.name;
      // Skip hidden/shared directories
      if (site.startsWith('.') || site.startsWith('_')) return;
      const siteDir = path.join(dir, site);
      const files = await fs.promises.readdir(siteDir);
      await Promise.all(files.map(async (file) => {
        if (file.startsWith('.')) return; // skip hidden/AppleDouble files
        const filePath = path.join(siteDir, file);
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          await registerYamlCli(filePath, site);
        } else if (
          (file.endsWith('.js') && !file.endsWith('.d.js')) ||
          (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts'))
        ) {
          if (!(await isCliModule(filePath))) return;
          await import(pathToFileURL(filePath).href).catch((err) => {
            console.error(`[biocli] Failed to load module ${filePath}: ${getErrorMessage(err)}`);
          });
        }
      }));
    });
  await Promise.all(sitePromises);
}

async function registerYamlCli(filePath: string, defaultSite: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const def = yaml.load(raw) as YamlCliDefinition | null;
    if (!isRecord(def)) return;
    parseYamlCli(def as YamlCliDefinition, filePath, defaultSite);
  } catch (err) {
    console.error(`[biocli] Failed to parse YAML ${filePath}: ${getErrorMessage(err)}`);
  }
}

// ── Plugin discovery ────────────────────────────────────────────────────────

/**
 * Discover and load plugins from ~/.biocli/plugins/.
 *
 * Each plugin is either:
 * - A directory with a package.json (npm package)
 * - A single .ts/.js file
 */
export async function discoverPlugins(): Promise<void> {
  try {
    await fs.promises.access(PLUGINS_DIR);
  } catch {
    return; // No plugins directory — nothing to do
  }

  const entries = await fs.promises.readdir(PLUGINS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(PLUGINS_DIR, entry.name);

    if (entry.isDirectory()) {
      // Directory plugin: look for package.json with "main" entry
      const pkgPath = path.join(fullPath, 'package.json');
      try {
        await fs.promises.access(pkgPath);
        const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
        const mainFile = pkg.main ?? 'index.js';
        const mainPath = path.resolve(fullPath, mainFile);
        await import(pathToFileURL(mainPath).href);
      } catch (err) {
        console.error(`[biocli] Failed to load plugin ${entry.name}: ${getErrorMessage(err)}`);
      }
    } else if (
      (entry.name.endsWith('.js') && !entry.name.endsWith('.d.js')) ||
      (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
    ) {
      // Single-file plugin
      try {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        if (PLUGIN_MODULE_PATTERN.test(content)) {
          await import(pathToFileURL(fullPath).href);
        }
      } catch (err) {
        console.error(`[biocli] Failed to load plugin ${entry.name}: ${getErrorMessage(err)}`);
      }
    }
  }
}
