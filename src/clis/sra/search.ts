/**
 * sra/search — Search SRA sequencing runs.
 *
 * Uses the two-step esearch + esummary pattern against db=sra.
 * SRA esummary JSON embeds XML strings in expxml and runs fields,
 * so we extract key metadata using regex helpers.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { clamp } from '../_shared/common.js';

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
  name: 'search',
  description: 'Search SRA sequencing runs',
  database: 'sra',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "RNA-seq human liver")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
  ],
  columns: ['accession', 'title', 'platform', 'organism', 'samples', 'date'],
  func: async (ctx, args) => {
    const limit = clamp(Number(args.limit), 1, 50);

    // Step 1: esearch to get SRA IDs
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'sra',
      term: String(args.query),
      retmax: String(limit),
      retmode: 'json',
    }));

    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const ids: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];

    if (!ids.length) {
      throw new CliError('NOT_FOUND', 'No SRA entries found', 'Try different search terms');
    }

    // Step 2: esummary — SRA embeds XML strings in expxml and runs fields
    const summaryResult = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'sra',
      id: ids.join(','),
      retmode: 'json',
    }));

    const summary = summaryResult as Record<string, unknown>;
    const resultObj = summary?.result as Record<string, unknown> | undefined;
    const uids: string[] = (resultObj?.uids as string[] | undefined) ?? [];

    return uids.map(uid => {
      const item = (resultObj?.[uid] ?? {}) as Record<string, unknown>;
      const expXml = String(item.expxml ?? '');
      const runsXml = String(item.runs ?? '');

      // Extract key fields from embedded XML using regex
      const organism = extractXmlAttr(expXml, 'Organism', 'taxname')
        || extractXmlTag(expXml, 'Organism');
      const platform = extractXmlAttr(expXml, 'Platform', 'instrument_model')
        || extractXmlTag(expXml, 'Platform');
      const title = extractXmlTag(expXml, 'Title');
      const accession = extractXmlAttr(runsXml, 'Run', 'acc') || `SRA${uid}`;

      return {
        accession,
        title: title.length > 80 ? title.slice(0, 80) + '...' : title,
        platform,
        organism,
        samples: String(item.total_runs ?? ''),
        date: String(item.createdate ?? ''),
      };
    });
  },
});
