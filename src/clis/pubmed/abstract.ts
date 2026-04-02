/**
 * pubmed/abstract — Get abstract text for a PubMed article.
 *
 * Returns only the PMID and abstract text, defaulting to plain output
 * format for easy piping and reading.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { parsePubmedArticles } from '../_shared/xml-helpers.js';

cli({
  site: 'pubmed',
  name: 'abstract',
  description: 'Get abstract text for a PubMed article',
  database: 'pubmed',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'pmid', positional: true, required: true, help: 'PubMed ID' },
  ],
  columns: ['pmid', 'abstract'],
  defaultFormat: 'plain',
  func: async (ctx, args) => {
    const pmid = String(args.pmid).trim();
    if (!/^\d+$/.test(pmid)) {
      throw new CliError('ARGUMENT', `Invalid PMID: "${pmid}"`, 'PMID must be a numeric identifier');
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

    const article = articles[0];
    if (!article.abstract) {
      throw new CliError('EMPTY_RESULT', `No abstract available for PMID ${pmid}`, 'This article may not have an abstract');
    }

    return [{ pmid: article.pmid, abstract: article.abstract }];
  },
});
