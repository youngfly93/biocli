/**
 * Output formatting: table, card, JSON, Markdown, CSV, YAML, plain.
 *
 * Ported from opencli/src/output.ts for biocli.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import yaml from 'js-yaml';

export interface RenderOptions {
  fmt?: string;
  columns?: string[];
  title?: string;
  elapsed?: number;
  source?: string;
  footerExtra?: string;
  /** Search query for keyword highlighting in table/plain output. */
  query?: string;
  /** Total result count from API (e.g. esearch count), for "3 of N" display. */
  totalCount?: number;
}

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [{ value: data }];
}

function resolveColumns(rows: Record<string, unknown>[], opts: RenderOptions): string[] {
  return opts.columns ?? Object.keys(rows[0] ?? {});
}

/** Get terminal width, default to 80 if unavailable. */
function termWidth(): number {
  return process.stdout.columns
    || (process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0)
    || 80;
}

/** Truncate text to maxLen, appending '…' if trimmed. */
function truncateCell(text: string, maxLen: number): string {
  if (maxLen < 2) return '…';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

// ── Column width allocation ───────────────────────────────────────────────────

/**
 * Minimum content widths for known column types.
 * These are "content" widths (excluding the 2-char cell padding cli-table3 adds).
 */
const COL_MIN_CONTENT: Record<string, number> = {
  pmid: 8,
  uid: 8,
  geneid: 6,
  year: 4,
  date: 10,
  samples: 4,
  type: 4,
  symbol: 6,
  chromosome: 4,
};

/**
 * Priority weights: higher = gets more space when distributing surplus.
 * Columns not listed default to 1.
 */
const COL_PRIORITY: Record<string, number> = {
  title: 5,
  name: 4,
  abstract: 5,
  summary: 4,
  description: 4,
  doi: 4,
  journal: 3,
  authors: 3,
  condition: 3,
  significance: 2,
  organism: 2,
  platform: 2,
  accession: 2,
};

/**
 * Allocate column widths so the table fits within terminal width.
 *
 * cli-table3 colWidths includes the 2-char padding (1 left + 1 right),
 * so "colWidth = contentWidth + 2". Border chars (│) add (n+1) total.
 *
 * Total table width = sum(colWidths) + (n + 1)
 */
function allocateColumnWidths(
  columns: string[],
  rows: Record<string, unknown>[],
): number[] {
  const n = columns.length;
  const tw = termWidth();
  const borderChars = n + 1; // │ before each column + │ at the end
  const available = tw - borderChars; // total space for all colWidths

  // Measure natural content width per column (max of header and all row values)
  const natural: number[] = columns.map(col => {
    let maxW = capitalize(col).length;
    for (const row of rows) {
      const v = row[col];
      const len = v === null || v === undefined ? 0 : String(v).length;
      if (len > maxW) maxW = len;
    }
    return maxW + 2; // +2 for cell padding → this is the colWidth value
  });

  const totalNatural = natural.reduce((a, b) => a + b, 0);

  // If everything fits naturally, use natural widths
  if (totalNatural <= available) return natural;

  // Otherwise, compute minimum widths and distribute remaining space by priority
  const mins: number[] = columns.map(col => {
    const headerW = capitalize(col).length;
    const knownMin = COL_MIN_CONTENT[col.toLowerCase()];
    const contentMin = knownMin ?? Math.min(headerW, 8);
    return Math.max(contentMin, headerW) + 2; // +2 for padding
  });

  const totalMins = mins.reduce((a, b) => a + b, 0);
  if (totalMins >= available) {
    // Even minimums don't fit — proportionally shrink minimums
    const ratio = available / totalMins;
    return mins.map(m => Math.max(4, Math.floor(m * ratio)));
  }

  // Distribute surplus space proportionally by priority × natural demand
  const surplus = available - totalMins;
  const wants: number[] = columns.map((col, i) => {
    const priority = COL_PRIORITY[col.toLowerCase()] ?? 1;
    const extra = Math.max(0, natural[i] - mins[i]);
    return priority * extra;
  });
  const totalWant = wants.reduce((a, b) => a + b, 0);

  if (totalWant === 0) return mins;

  return mins.map((min, i) => {
    const share = Math.floor(surplus * wants[i] / totalWant);
    // Never exceed the natural width (no point adding empty space)
    return Math.min(min + share, natural[i]);
  });
}

// ── Terminal hyperlinks (OSC 8) ───────────────────────────────────────────────

/** Whether the terminal supports OSC 8 hyperlinks. */
const HYPERLINKS_SUPPORTED = !!(process.stdout.isTTY && process.env.TERM_PROGRAM !== 'Apple_Terminal');

/** Wrap text in an OSC 8 clickable hyperlink (no-op if unsupported). */
function hyperlink(text: string, url: string): string {
  if (!HYPERLINKS_SUPPORTED) return text;
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

/**
 * Known column names → URL patterns for automatic hyperlinking.
 * Returns the URL if the value can be linked, undefined otherwise.
 */
function autoLinkUrl(column: string, value: string): string | undefined {
  const col = column.toLowerCase();
  if (col === 'doi' && value && !value.startsWith('http')) {
    return `https://doi.org/${value}`;
  }
  if (col === 'pmid' && /^\d+$/.test(value)) {
    return `https://pubmed.ncbi.nlm.nih.gov/${value}/`;
  }
  if (col === 'geneid' && /^\d+$/.test(value)) {
    return `https://www.ncbi.nlm.nih.gov/gene/${value}`;
  }
  if (col === 'accession') {
    if (/^GSE\d+$/i.test(value)) return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${value}`;
    if (/^SRR\d+$/i.test(value)) return `https://www.ncbi.nlm.nih.gov/sra/${value}`;
    if (/^RCV\d+$/i.test(value)) return `https://www.ncbi.nlm.nih.gov/clinvar/${value}/`;
  }
  if (col === 'uid' && /^\d+$/.test(value)) {
    // ClinVar UID
    return `https://www.ncbi.nlm.nih.gov/clinvar/variation/${value}/`;
  }
  return undefined;
}

/** Apply hyperlink to a cell value if the column is linkable. */
function linkCell(column: string, text: string): string {
  const url = autoLinkUrl(column, text);
  return url ? hyperlink(text, url) : text;
}

/** Highlight query keywords in text using chalk.bold.underline. */
function highlightQuery(text: string, query?: string): string {
  if (!query || !text) return text;
  // Split query into individual words, escape regex chars
  const words = query.split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return text;
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(re, (match) => chalk.bold.underline(match));
}

export function render(data: unknown, opts: RenderOptions = {}): void {
  const fmt = opts.fmt ?? 'table';
  if (data === null || data === undefined) {
    console.log(data);
    return;
  }
  switch (fmt) {
    case 'json': renderJson(data); break;
    case 'plain': renderPlain(data, opts); break;
    case 'md': case 'markdown': renderMarkdown(data, opts); break;
    case 'report': renderReport(data, opts); break;
    case 'csv': renderCsv(data, opts); break;
    case 'yaml': case 'yml': renderYaml(data); break;
    default: renderTable(data, opts); break;
  }
}

// ── Card view for single records ──────────────────────────────────────────────

function renderCard(row: Record<string, unknown>, columns: string[], opts: RenderOptions): void {
  const tw = termWidth();
  const labelWidth = Math.max(...columns.map(c => capitalize(c).length)) + 2;
  const valueWidth = tw - labelWidth - 6; // padding and borders

  console.log();
  console.log(chalk.dim(`  ── ${opts.title ?? 'result'} ${'─'.repeat(Math.max(0, tw - (opts.title?.length ?? 6) - 8))}`));

  for (const col of columns) {
    const raw = row[col];
    const value = raw === null || raw === undefined ? '' : String(raw);
    const label = capitalize(col);

    if (!value) continue;

    // Long text fields get their own block
    if (value.length > valueWidth) {
      console.log(chalk.bold.cyan(`  ${label}`));
      // Word-wrap the value
      const wrapped = wordWrap(highlightQuery(value, opts.query), tw - 4);
      for (const line of wrapped) {
        console.log(`    ${line}`);
      }
    } else {
      const paddedLabel = label.padEnd(labelWidth);
      const displayed = linkCell(col, highlightQuery(value, opts.query));
      console.log(`  ${chalk.bold.cyan(paddedLabel)}${displayed}`);
    }
  }

  // Footer
  const footer: string[] = [];
  if (opts.elapsed) footer.push(`${opts.elapsed.toFixed(1)}s`);
  if (opts.source) footer.push(opts.source);
  if (opts.footerExtra) footer.push(opts.footerExtra);
  console.log(chalk.dim(`  ${'─'.repeat(Math.max(0, tw - 4))}${footer.length ? '\n  ' + footer.join(' · ') : ''}`));
}

/** Simple word-wrap: break text into lines of at most `width` characters. */
function wordWrap(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= width) {
      lines.push(remaining);
      break;
    }
    // Find last space within width
    let breakAt = remaining.lastIndexOf(' ', width);
    if (breakAt <= 0) breakAt = width;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return lines;
}

// ── Table view ────────────────────────────────────────────────────────────────

function renderTable(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) {
    console.log();
    console.log(chalk.yellow('  No results found'));
    if (opts.query) {
      console.log(chalk.dim(`  Try a broader search term or check spelling`));
    }
    return;
  }
  const columns = resolveColumns(rows, opts);

  // Single record → card view (much more readable than a 1-row wide table)
  if (rows.length === 1) {
    renderCard(rows[0], columns, opts);
    return;
  }

  // Compute column widths that fit within the terminal
  const colWidths = allocateColumnWidths(columns, rows);

  const header = columns.map(c => capitalize(c));
  const table = new Table({
    head: header.map(h => chalk.bold(h)),
    style: { head: [], border: [] },
    colWidths,
  });

  for (const row of rows) {
    table.push(columns.map((c, i) => {
      const v = (row as Record<string, unknown>)[c];
      if (v === null || v === undefined) return '';
      let text = String(v);
      // Truncate plain text to fit column content width FIRST,
      // then apply ANSI formatting. This avoids breaking escape sequences
      // and prevents invisible bytes from inflating width.
      const contentW = colWidths[i] - 2; // subtract cell padding
      text = truncateCell(text, contentW);
      // Apply highlighting on truncated plain text (safe — chalk codes
      // are handled by cli-table3's strip-ansi for width calculation).
      // NOTE: No OSC 8 hyperlinks in table cells — they break width calc.
      return highlightQuery(text, opts.query);
    }));
  }

  console.log();
  if (opts.title) console.log(chalk.dim(`  ${opts.title}`));
  console.log(table.toString());
  renderFooter(rows.length, opts);
}

// ── Footer helper ─────────────────────────────────────────────────────────────

function renderFooter(count: number, opts: RenderOptions): void {
  const footer: string[] = [];
  const hasMore = opts.totalCount && opts.totalCount > count;
  if (hasMore) {
    footer.push(`${count} of ${opts.totalCount!.toLocaleString()} items`);
  } else {
    footer.push(`${count} items`);
  }
  if (opts.elapsed) footer.push(`${opts.elapsed.toFixed(1)}s`);
  if (opts.source) footer.push(opts.source);
  if (opts.footerExtra) footer.push(opts.footerExtra);
  console.log(chalk.dim(footer.join(' · ')));
  if (hasMore) {
    console.log(chalk.dim(`  Use --limit <n> to show more results`));
  }
}

function renderJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function renderPlain(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;

  // Single-row single-field shortcuts for simple commands.
  if (rows.length === 1) {
    const row = rows[0];
    const entries = Object.entries(row);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === 'response' || key === 'content' || key === 'text' || key === 'value') {
        console.log(highlightQuery(String(value ?? ''), opts.query));
        return;
      }
    }
  }

  rows.forEach((row, index) => {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
    entries.forEach(([key, value]) => {
      console.log(`${key}: ${highlightQuery(String(value), opts.query)}`);
    });
    if (index < rows.length - 1) console.log('');
  });
}

function renderMarkdown(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;
  const columns = resolveColumns(rows, opts);
  console.log('| ' + columns.join(' | ') + ' |');
  console.log('| ' + columns.map(() => '---').join(' | ') + ' |');
  for (const row of rows) {
    console.log('| ' + columns.map(c => String((row as Record<string, unknown>)[c] ?? '')).join(' | ') + ' |');
  }
}

function renderCsv(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  if (!rows.length) return;
  const columns = resolveColumns(rows, opts);
  console.log(columns.join(','));
  for (const row of rows) {
    console.log(columns.map(c => {
      const v = String((row as Record<string, unknown>)[c] ?? '');
      return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
}

function renderReport(data: unknown, opts: RenderOptions): void {
  const rows = normalizeRows(data);
  const columns = resolveColumns(rows, opts);

  // Title
  const title = opts.title ?? opts.source ?? 'biocli Report';
  console.log(`# ${title}`);
  console.log();
  console.log(`*Generated on ${new Date().toISOString()}*`);
  console.log();

  // Metadata
  if (opts.query) console.log(`**Query**: ${opts.query}`);
  if (opts.totalCount !== undefined) console.log(`**Total results**: ${opts.totalCount} (showing ${rows.length})`);
  console.log(`**Columns**: ${columns.join(', ')}`);
  console.log();

  if (!rows.length) {
    console.log('*No results found.*');
    return;
  }

  // Data table
  console.log('## Results');
  console.log();
  console.log('| ' + columns.join(' | ') + ' |');
  console.log('| ' + columns.map(() => '---').join(' | ') + ' |');
  for (const row of rows) {
    const cells = columns.map(c => {
      const v = String((row as Record<string, unknown>)[c] ?? '');
      // Truncate long values in report tables
      return v.length > 80 ? v.slice(0, 80) + '...' : v;
    });
    console.log('| ' + cells.join(' | ') + ' |');
  }

  console.log();
  console.log('---');
  console.log('*Generated by [biocli](https://github.com/youngfly93/biocli)*');
}

function renderYaml(data: unknown): void {
  console.log(yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
