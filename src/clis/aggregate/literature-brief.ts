/**
 * aggregate/literature-brief — PubMed literature summary for a topic.
 *
 * Fetches recent papers and returns structured data with abstracts,
 * optimized for AI agent consumption and literature review tasks.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { parsePubmedArticles } from '../_shared/xml-helpers.js';

cli({
  site: 'aggregate',
  name: 'literature-brief',
  description: 'Literature summary with abstracts for a research topic',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 60,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query (e.g. "TP53 immunotherapy", "CRISPR cancer")' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of papers (1-50)' },
    { name: 'sort', default: 'relevance', choices: ['relevance', 'date'], help: 'Sort order' },
    { name: 'years', type: 'int', default: 5, help: 'Limit to last N years' },
  ],
  columns: ['pmid', 'title', 'journal', 'year', 'abstract'],
  func: async (_ctx, args) => {
    const query = String(args.query).trim();
    if (!query) throw new CliError('ARGUMENT', 'Search query is required');

    const limit = Math.max(1, Math.min(Number(args.limit), 50));
    const sort = String(args.sort) === 'date' ? 'pub_date' : 'relevance';
    const years = Math.max(1, Math.min(Number(args.years), 20));

    const ncbiCtx = createHttpContextForDatabase('ncbi');
    const warnings: string[] = [];

    // Build date-restricted query
    const dateQuery = `${query} AND "last ${years} years"[PDat]`;

    // Step 1: esearch
    const searchResult = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
      db: 'pubmed',
      term: dateQuery,
      retmax: String(limit),
      sort,
      retmode: 'json',
    })) as Record<string, unknown>;

    const esearch = searchResult?.esearchresult as Record<string, unknown> | undefined;
    const pmids: string[] = (esearch?.idlist as string[] | undefined) ?? [];
    const totalCount = Number(esearch?.count ?? 0);

    if (!pmids.length) {
      throw new CliError('NOT_FOUND', `No papers found for "${query}"`,
        'Try broader terms or increase --years');
    }

    // Step 2: efetch with full abstracts
    const xmlData = await ncbiCtx.fetchXml(buildEutilsUrl('efetch.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      rettype: 'xml',
    }));

    const articles = parsePubmedArticles(xmlData);
    if (!articles.length) {
      throw new CliError('PARSE_ERROR', 'Failed to parse PubMed response');
    }

    const papers = articles.map(a => ({
      pmid: a.pmid,
      title: a.title,
      authors: a.authors,
      journal: a.journal,
      year: a.year,
      doi: a.doi,
      abstract: a.abstract,
    }));

    return wrapResult(
      { papers, totalAvailable: totalCount },
      {
        sources: ['PubMed'],
        warnings,
        query,
        ids: { totalPmids: String(totalCount) },
      },
    );
  },
});
