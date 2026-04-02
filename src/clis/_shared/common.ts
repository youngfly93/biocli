/**
 * Common utility functions shared across NCBI adapter commands.
 */

// Re-export clamp from the core utils module.
export { clamp } from '../../utils.js';

/**
 * Truncate a string to `maxLen` characters, appending '...' if trimmed.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
