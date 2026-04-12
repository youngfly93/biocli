/**
 * sra/run — Get SRA run details by accession.
 *
 * Searches for a single SRA accession (SRR, SRX, SRP, etc.) and
 * retrieves detailed run metadata via esummary (JSON). Parses the
 * embedded XML strings in expxml/runs fields.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';

// ── SRA XML extraction helpers ───────────────────────────────────────────────

/** Extract text content of an XML tag (e.g. <Title>foo</Title> -> "foo"). */
function extractXmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
}

/** Extract an attribute value from an XML tag (e.g. <Run acc="SRR123"> -> "SRR123"). */
function extractXmlAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*>`));
  return m ? m[1].trim() : '';
}

cli({
  site: 'sra',
  name: 'run',
  description: 'Get SRA run details by accession',
  database: 'sra',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'accession', positional: true, required: true, help: 'SRA accession (e.g. SRR1234567, SRX1234567)', producedBy: ['sra/search', 'aggregate/workflow-scout'] },
  ],
  columns: ['accession', 'title', 'platform', 'organism', 'strategy', 'source', 'layout', 'date'],
  func: async (ctx, args) => {
    const acc = String(args.accession);

    // Step 1: esearch by accession
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'sra',
      term: `${acc}[Accession]`,
      retmode: 'json',
    }));

    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const ids: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];

    if (!ids.length) {
      throw new CliError('NOT_FOUND', `SRA entry ${acc} not found`, 'Check that the accession is correct (e.g. SRR1234567, SRX1234567)');
    }

    // Step 2: esummary for full details
    const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'sra',
      id: ids[0],
      retmode: 'json',
    }));

    const summary = summaryResult as Record<string, unknown>;
    const resultObj = summary?.result as Record<string, unknown> | undefined;
    const item = (resultObj?.[ids[0]] ?? {}) as Record<string, unknown>;
    const expXml = String(item.expxml ?? '');
    const runsXml = String(item.runs ?? '');

    // Determine sequencing layout from embedded XML
    let layout = '';
    if (expXml.includes('PAIRED')) layout = 'PAIRED';
    else if (expXml.includes('SINGLE')) layout = 'SINGLE';

    return [{
      accession: extractXmlAttr(runsXml, 'Run', 'acc') || acc,
      title: extractXmlTag(expXml, 'Title'),
      platform: extractXmlAttr(expXml, 'Platform', 'instrument_model')
        || extractXmlTag(expXml, 'Platform'),
      organism: extractXmlAttr(expXml, 'Organism', 'taxname')
        || extractXmlTag(expXml, 'Organism'),
      strategy: extractXmlTag(expXml, 'Library_strategy')
        || extractXmlAttr(expXml, 'Library_descriptor', 'LIBRARY_STRATEGY'),
      source: extractXmlTag(expXml, 'Library_source'),
      layout,
      date: String(item.createdate ?? ''),
    }];
  },
});
