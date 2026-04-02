/**
 * pubmed/search — Search PubMed articles.
 *
 * Uses the two-step esearch + efetch pattern:
 *   1. esearch to retrieve matching PMIDs
 *   2. efetch (XML) to get full article metadata
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { parsePubmedArticles } from '../_shared/xml-helpers.js';
import { clamp } from '../_shared/common.js';
import { withMeta } from '../../types.js';

const SORT_MAP: Record<string, string> = {
  relevance: 'relevance',
  date: 'pub_date',
  author: 'author',
  journal: 'journal',
};

cli({
  site: 'pubmed',
  name: 'search',
  description: 'Search PubMed articles',
  database: 'pubmed',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "CRISPR cancer therapy")' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (1-200)' },
    { name: 'sort', default: 'relevance', choices: ['relevance', 'date', 'author', 'journal'], help: 'Sort order' },
  ],
  columns: ['pmid', 'title', 'authors', 'journal', 'year', 'doi'],
  func: async (ctx, args) => {
    const limit = clamp(Number(args.limit), 1, 200);
    const sort = SORT_MAP[String(args.sort)] ?? 'relevance';

    // Step 1: esearch to get PMIDs
    const searchResult = await ctx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'pubmed',
      term: String(args.query),
      retmax: String(limit),
      sort,
      retmode: 'json',
    }));

    const query = String(args.query);
    const result = searchResult as Record<string, unknown>;
    const esearchResult = result?.esearchresult as Record<string, unknown> | undefined;
    const pmids: string[] = (esearchResult?.idlist as string[] | undefined) ?? [];
    const totalCount = Number(esearchResult?.count ?? 0);

    if (!pmids.length) {
      throw new CliError('NOT_FOUND', 'No articles found', 'Try different search terms or check PubMed query syntax');
    }

    // Step 2: efetch to get full article details (XML only for PubMed)
    const xmlData = await ctx.fetchXml(buildEutilsUrl('efetch.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      rettype: 'xml',
    }));

    const articles = parsePubmedArticles(xmlData);
    if (!articles.length) {
      throw new CliError('PARSE_ERROR', 'Failed to parse PubMed response', 'This may be a temporary issue; try again');
    }

    return withMeta(articles, { totalCount, query });
  },
});
