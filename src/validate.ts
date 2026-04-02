/**
 * YAML adapter definition validator.
 *
 * Validates that YAML CLI definitions have the correct structure and
 * reference only known pipeline steps.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { isRecord } from './utils.js';
import { getKnownStepNames } from './pipeline/index.js';
import type { YamlCliDefinition } from './yaml-schema.js';

export interface ValidationError {
  file: string;
  errors: string[];
}

/**
 * Validate a single YAML CLI definition file.
 *
 * Checks:
 * - File is valid YAML
 * - Top-level is an object
 * - Required fields present (name or can be derived from filename)
 * - Pipeline steps reference known step handlers
 * - Args have valid types
 *
 * @returns Array of error messages (empty if valid)
 */
export function validateYamlCli(filePath: string): string[] {
  const errors: string[] = [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    errors.push(`Cannot read file: ${err instanceof Error ? err.message : String(err)}`);
    return errors;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    errors.push(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
    return errors;
  }

  if (!isRecord(parsed)) {
    errors.push('Top-level value must be an object (mapping)');
    return errors;
  }

  const def = parsed as YamlCliDefinition;

  // Check description
  if (!def.description) {
    errors.push('Missing "description" field');
  }

  // Validate strategy if present
  const validStrategies = ['public', 'api_key'];
  if (def.strategy && !validStrategies.includes(def.strategy.toLowerCase())) {
    errors.push(`Invalid strategy "${def.strategy}". Must be one of: ${validStrategies.join(', ')}`);
  }

  // Validate args
  if (def.args) {
    if (!isRecord(def.args)) {
      errors.push('"args" must be an object mapping arg names to definitions');
    } else {
      const validArgTypes = ['str', 'string', 'int', 'number', 'bool', 'boolean'];
      for (const [argName, argDef] of Object.entries(def.args)) {
        if (argDef && typeof argDef === 'object' && 'type' in argDef) {
          const argType = (argDef as { type?: string }).type;
          if (argType && !validArgTypes.includes(argType)) {
            errors.push(`Arg "${argName}": invalid type "${argType}". Must be one of: ${validArgTypes.join(', ')}`);
          }
        }
      }
    }
  }

  // Validate pipeline steps
  if (def.pipeline) {
    if (!Array.isArray(def.pipeline)) {
      errors.push('"pipeline" must be an array of step objects');
    } else {
      const knownSteps = getKnownStepNames();
      for (let i = 0; i < def.pipeline.length; i++) {
        const step = def.pipeline[i];
        if (!isRecord(step)) {
          errors.push(`Pipeline step ${i}: must be an object`);
          continue;
        }
        const stepNames = Object.keys(step);
        if (stepNames.length === 0) {
          errors.push(`Pipeline step ${i}: empty step object`);
          continue;
        }
        const stepName = stepNames[0];
        if (!knownSteps.includes(stepName)) {
          errors.push(`Pipeline step ${i}: unknown step "${stepName}". Known steps: ${knownSteps.join(', ')}`);
        }
      }
    }
  }

  // Validate columns
  if (def.columns !== undefined && !Array.isArray(def.columns)) {
    errors.push('"columns" must be an array of strings');
  }

  // Validate timeout
  if (def.timeout !== undefined) {
    if (typeof def.timeout !== 'number' || def.timeout <= 0) {
      errors.push('"timeout" must be a positive number (seconds)');
    }
  }

  return errors;
}

/**
 * Validate all YAML CLI definitions in a directory (recursively scanning site subdirs).
 *
 * @returns Array of ValidationError objects for files with issues
 */
export function validateAll(cliDir: string): ValidationError[] {
  const results: ValidationError[] = [];

  if (!fs.existsSync(cliDir)) {
    return results;
  }

  const siteDirs = fs.readdirSync(cliDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'));

  for (const siteDir of siteDirs) {
    const sitePath = path.join(cliDir, siteDir.name);
    const files = fs.readdirSync(sitePath);

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const filePath = path.join(sitePath, file);
      const errors = validateYamlCli(filePath);
      if (errors.length > 0) {
        results.push({ file: filePath, errors });
      }
    }
  }

  return results;
}
