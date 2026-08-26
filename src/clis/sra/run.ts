/**
 * sra/run — Get SRA run details by accession.
 *
 * Searches for a single SRA accession (SRR, SRX, SRP, etc.) and
 * retrieves detailed run metadata via esummary (JSON). Parses the
 * embedded XML strings in expxml/runs fields.
 */

import { cli, Strategy } from '../../registry.js';
import { fetchSraRunMetadata } from '../_shared/dataset-metadata.js';

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
    const metadata = await fetchSraRunMetadata(ctx, String(args.accession));

    return [{
      accession: metadata.accession,
      title: metadata.title,
      platform: metadata.platform,
      organism: metadata.organism,
      strategy: metadata.strategy,
      source: metadata.librarySource,
      layout: metadata.layout,
      date: metadata.date,
    }];
  },
});
