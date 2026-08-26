/**
 * geo/dataset — Get GEO dataset details by accession.
 *
 * Searches by accession (GSE, GDS, GPL, GSM) in the gds database,
 * then retrieves the full summary via esummary (JSON).
 */

import { cli, Strategy } from '../../registry.js';
import { truncate } from '../_shared/common.js';
import { fetchGeoDatasetMetadata } from '../_shared/dataset-metadata.js';

cli({
  site: 'geo',
  name: 'dataset',
  description: 'Get GEO dataset details by accession',
  database: 'gds',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'accession', positional: true, required: true, help: 'GEO accession (e.g. GSE12345, GDS1234)', producedBy: ['geo/search', 'aggregate/workflow-scout'] },
  ],
  columns: ['accession', 'title', 'organism', 'type', 'platform', 'samples', 'summary', 'date'],
  func: async (ctx, args) => {
    const metadata = await fetchGeoDatasetMetadata(ctx, String(args.accession));

    return [{
      accession: metadata.accession,
      title: metadata.title,
      organism: metadata.organism,
      type: metadata.type,
      platform: metadata.platform,
      samples: metadata.samples,
      summary: truncate(metadata.summary, 300),
      date: metadata.date,
    }];
  },
});
