/**
 * pubmed/fetch — Get PubMed article details by PMID.
 *
 * Fetches a single article and returns full metadata including abstract.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { parsePubmedArticles } from '../_shared/xml-helpers.js';

cli({
  site: 'pubmed',
  name: 'fetch',
  description: 'Get PubMed article details by PMID',
  database: 'pubmed',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'pmid', positional: true, required: true, help: 'PubMed ID (e.g. 39088800)' },
  ],
  columns: ['pmid', 'title', 'authors', 'journal', 'year', 'doi', 'abstract'],
  func: async (ctx, args) => {
    const pmid = String(args.pmid).trim();
    if (!/^\d+$/.test(pmid)) {
      throw new CliError('ARGUMENT', `Invalid PMID: "${pmid}"`, 'PMID must be a numeric identifier (e.g. 39088800)');
    }

    const xmlData = await ctx.fetchXml(buildEutilsUrl('efetch.fcgi', {
      db: 'pubmed',
      id: pmid,
      rettype: 'xml',
    }));

    const articles = parsePubmedArticles(xmlData);
    if (!articles.length) {
      throw new CliError('NOT_FOUND', `Article PMID ${pmid} not found`, 'Check that the PMID is correct');
    }

    return articles;
  },
});
