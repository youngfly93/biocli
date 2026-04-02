/**
 * kegg/disease — Find diseases linked to a KEGG gene.
 *
 * Shorthand for `kegg link --target disease`. Adds disease name resolution.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildKeggUrl, parseKeggTsv, parseKeggEntry } from '../../databases/kegg.js';
import { withMeta } from '../../types.js';

cli({
  site: 'kegg',
  name: 'disease',
  description: 'Find diseases linked to a KEGG gene',
  database: 'kegg',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'gene', positional: true, required: true, help: 'KEGG gene ID (e.g. hsa:7157)' },
  ],
  columns: ['geneId', 'diseaseId', 'diseaseName'],
  func: async (ctx, args) => {
    const gene = String(args.gene).trim();

    // Step 1: Get disease links
    const linkText = await ctx.fetchText(buildKeggUrl(`/link/disease/${gene}`));
    if (!linkText.trim()) {
      throw new CliError('NOT_FOUND', `No disease links found for ${gene}`, 'Check the gene ID (e.g. hsa:7157)');
    }

    const links = parseKeggTsv(linkText);

    // Step 2: Get disease names (batch, max 10 per request)
    const diseaseIds = links.map(l => l.value).filter(Boolean);
    const names: Record<string, string> = {};

    // Batch in groups of 10
    for (let i = 0; i < diseaseIds.length; i += 10) {
      const batch = diseaseIds.slice(i, i + 10);
      try {
        const text = await ctx.fetchText(buildKeggUrl(`/get/${batch.join('+')}`));
        // Parse multiple entries separated by ///
        const entries = text.split('///').filter(e => e.trim());
        for (const entryText of entries) {
          const entry = parseKeggEntry(entryText);
          if (entry.ENTRY && entry.NAME) {
            const id = 'ds:' + entry.ENTRY.split(/\s+/)[0];
            names[id] = entry.NAME;
          }
        }
      } catch {
        // Non-fatal — display without names
      }
    }

    const rows = links.map(l => ({
      geneId: l.key,
      diseaseId: l.value,
      diseaseName: names[l.value] ?? '',
    }));

    return withMeta(rows, { totalCount: rows.length, query: gene });
  },
});
