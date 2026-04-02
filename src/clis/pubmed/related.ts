/**
 * pubmed/related — Find related articles for a given PubMed article.
 *
 * Uses elink with linkname 'pubmed_pubmed' to discover related PMIDs
 * (NCBI's pre-computed similarity), then efetch for article metadata.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { parsePubmedArticles } from '../_shared/xml-helpers.js';
import { clamp } from '../_shared/common.js';
import { isRecord } from '../../utils.js';

cli({
  site: 'pubmed',
  name: 'related',
  description: 'Find related PubMed articles',
  database: 'pubmed',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'pmid', positional: true, required: true, help: 'PubMed ID' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-100)' },
  ],
  columns: ['pmid', 'title', 'authors', 'journal', 'year', 'doi'],
  func: async (ctx, args) => {
    const pmid = String(args.pmid).trim();
    if (!/^\d+$/.test(pmid)) {
      throw new CliError('ARGUMENT', `Invalid PMID: "${pmid}"`, 'PMID must be a numeric identifier');
    }
    const limit = clamp(Number(args.limit), 1, 100);

    // Step 1: elink to get related PMIDs
    const linkResult = await ctx.fetchJson(buildEutilsUrl('elink.fcgi', {
      dbfrom: 'pubmed',
      db: 'pubmed',
      id: pmid,
      linkname: 'pubmed_pubmed',
      retmode: 'json',
    }));

    // Navigate elink JSON response
    const linksets = (linkResult as Record<string, unknown>)?.linksets;
    if (!Array.isArray(linksets) || !linksets.length) {
      throw new CliError('NOT_FOUND', `No related articles found for PMID ${pmid}`, 'Try a different article');
    }

    const firstLinkset = linksets[0] as Record<string, unknown>;
    const linksetdbs = firstLinkset?.linksetdbs;
    if (!Array.isArray(linksetdbs) || !linksetdbs.length) {
      throw new CliError('NOT_FOUND', `No related articles found for PMID ${pmid}`, 'Try a different article');
    }

    // Find the correct linksetdb entry
    let relatedIds: string[] = [];
    for (const lsdb of linksetdbs) {
      if (!isRecord(lsdb)) continue;
      const links = (lsdb as Record<string, unknown>).links;
      if (Array.isArray(links) && links.length > 0) {
        relatedIds = links.map(String);
        break;
      }
    }

    if (!relatedIds.length) {
      throw new CliError('NOT_FOUND', `No related articles found for PMID ${pmid}`, 'Try a different article');
    }

    // Exclude the queried PMID itself from results
    relatedIds = relatedIds.filter((id) => id !== pmid);

    // Trim to requested limit
    const trimmedIds = relatedIds.slice(0, limit);

    if (!trimmedIds.length) {
      throw new CliError('NOT_FOUND', `No related articles found for PMID ${pmid}`, 'Try a different article');
    }

    // Step 2: efetch those PMIDs
    const xmlData = await ctx.fetchXml(buildEutilsUrl('efetch.fcgi', {
      db: 'pubmed',
      id: trimmedIds.join(','),
      rettype: 'xml',
    }));

    const articles = parsePubmedArticles(xmlData);
    if (!articles.length) {
      throw new CliError('PARSE_ERROR', 'Failed to parse related articles', 'Try again later');
    }

    return articles;
  },
});
