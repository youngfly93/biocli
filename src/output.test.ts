/**
 * Tests for warning rendering behavior in the output layer.
 *
 * The critical invariant: warnings appear EXACTLY ONCE per render call,
 * regardless of format. Before this test existed, the table path
 * accidentally double-emitted warnings because both the shared `render()`
 * dispatcher AND the format-specific `renderFooter()` were calling into
 * parallel warning-emission helpers.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render } from './output.js';

/**
 * Capture console.error into an array of concatenated string args per call.
 * Returns a restore fn that the test should call in afterEach.
 */
function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return {
    lines,
    restore: () => { console.error = original; },
  };
}

/** Count how many times a 'Warnings:' header appears in captured stderr. */
function countWarningHeaders(lines: string[]): number {
  // chalk may wrap with escape codes; match substring "Warnings:" ignoring color.
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');
  return lines.filter(l => stripAnsi(l).trim() === 'Warnings:').length;
}

describe('render() warning emission (double-warning regression)', () => {
  let captured: ReturnType<typeof captureStderr>;
  const originalLog = console.log;

  beforeEach(() => {
    captured = captureStderr();
    console.log = () => { /* silenced */ };
  });

  afterEach(() => {
    captured.restore();
    console.log = originalLog;
  });

  it('table format emits each warning EXACTLY ONCE (regression)', () => {
    render(
      [{ a: 1 }, { a: 2 }],
      { fmt: 'table', warnings: ['dup-check'] },
    );
    const warningLines = captured.lines.filter(l => l.includes('dup-check'));
    expect(warningLines.length).toBe(1);
    expect(countWarningHeaders(captured.lines)).toBe(1);
  });

  it('plain format emits each warning exactly once', () => {
    render([{ a: 1 }], { fmt: 'plain', warnings: ['one warning'] });
    const warningLines = captured.lines.filter(l => l.includes('one warning'));
    expect(warningLines.length).toBe(1);
  });

  it('json format emits warnings to stderr exactly once', () => {
    render({ data: [] }, { fmt: 'json', warnings: ['json warning'] });
    const warningLines = captured.lines.filter(l => l.includes('json warning'));
    expect(warningLines.length).toBe(1);
  });

  it('csv format emits warnings exactly once', () => {
    render([{ a: 1 }], { fmt: 'csv', warnings: ['csv warning'] });
    const warningLines = captured.lines.filter(l => l.includes('csv warning'));
    expect(warningLines.length).toBe(1);
  });

  it('yaml format emits warnings exactly once', () => {
    render([{ a: 1 }], { fmt: 'yaml', warnings: ['yaml warning'] });
    const warningLines = captured.lines.filter(l => l.includes('yaml warning'));
    expect(warningLines.length).toBe(1);
  });

  it('multiple warnings in table format each appear exactly once', () => {
    render(
      [{ a: 1 }, { a: 2 }, { a: 3 }],
      { fmt: 'table', warnings: ['warning A', 'warning B', 'warning C'] },
    );
    expect(captured.lines.filter(l => l.includes('warning A')).length).toBe(1);
    expect(captured.lines.filter(l => l.includes('warning B')).length).toBe(1);
    expect(captured.lines.filter(l => l.includes('warning C')).length).toBe(1);
    expect(countWarningHeaders(captured.lines)).toBe(1);
  });

  it('empty warnings array emits nothing', () => {
    render([{ a: 1 }], { fmt: 'table', warnings: [] });
    expect(countWarningHeaders(captured.lines)).toBe(0);
  });

  it('undefined warnings field emits nothing', () => {
    render([{ a: 1 }], { fmt: 'table' });
    expect(countWarningHeaders(captured.lines)).toBe(0);
  });

  it('null data still emits warnings exactly once', () => {
    render(null, { fmt: 'table', warnings: ['null-path'] });
    expect(captured.lines.filter(l => l.includes('null-path')).length).toBe(1);
  });
});
