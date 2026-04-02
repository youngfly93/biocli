/**
 * PubMed & Gene XML parsing helpers.
 *
 * After fast-xml-parser processes NCBI XML (see xml-parser.ts), the
 * result is a deeply nested JS object.  These helpers navigate that
 * structure and return flat, typed records suitable for CLI table output.
 *
 * NOTE: The xml-parser config uses:
 *   - '@_' prefix for attributes  (e.g. @_EIdType)
 *   - '#text' for text nodes
 *   - Tags listed in ARRAY_TAGS are always arrays (Author, PubmedArticle, etc.)
 */

import { isRecord } from '../../utils.js';
import { truncate } from './common.js';

// ── PubMed types & parser ──────────────────────────────────────────────────

export interface PubmedArticle {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
  abstract: string;
}

/**
 * Safely drill into a nested object by a dot-separated path.
 * Returns `undefined` if any intermediate key is missing.
 */
function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!isRecord(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Coerce a value to a string, returning '' for nullish values. */
function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  // fast-xml-parser may produce { '#text': 'value' } for mixed-content nodes
  if (isRecord(v) && '#text' in v) return String(v['#text']);
  return String(v);
}

/**
 * Format author list from parsed Author array.
 *
 * Each Author element is typically:
 *   { LastName: 'Smith', ForeName: 'John', Initials: 'J' }
 * or sometimes:
 *   { CollectiveName: 'COVID-19 Genomics UK Consortium' }
 *
 * Returns first 3 authors as "LastName FN, ..." plus "et al." if more.
 */
function formatAuthors(authorList: unknown): string {
  if (!Array.isArray(authorList)) return '';

  const names: string[] = [];
  for (const author of authorList) {
    if (!isRecord(author)) continue;
    if (author.CollectiveName) {
      names.push(str(author.CollectiveName));
    } else {
      const last = str(author.LastName);
      const fore = str(author.ForeName);
      if (last) {
        names.push(fore ? `${last} ${fore.charAt(0)}` : last);
      }
    }
  }

  if (names.length === 0) return '';
  if (names.length <= 3) return names.join(', ');
  return names.slice(0, 3).join(', ') + ' et al.';
}

/**
 * Extract DOI from Article's ELocationID list.
 *
 * ELocationID can be a single object or array (though xml-parser doesn't
 * force it into an array since it's not in ARRAY_TAGS).  We check for
 * @_EIdType === 'doi'.
 */
function extractDoi(article: Record<string, unknown>): string {
  const eloc = article.ELocationID;
  if (!eloc) return '';

  const candidates = Array.isArray(eloc) ? eloc : [eloc];
  for (const entry of candidates) {
    if (isRecord(entry) && entry['@_EIdType'] === 'doi') {
      return str(entry['#text'] ?? entry);
    }
  }
  return '';
}

/**
 * Extract publication year from a Journal > JournalIssue > PubDate node.
 */
function extractYear(article: Record<string, unknown>): string {
  // Try Journal > JournalIssue > PubDate > Year
  const journalYear = str(dig(article, 'Journal', 'JournalIssue', 'PubDate', 'Year'));
  if (journalYear) return journalYear;

  // Fallback: Journal > JournalIssue > PubDate > MedlineDate (e.g. "2024 Jan-Feb")
  const medlineDate = str(dig(article, 'Journal', 'JournalIssue', 'PubDate', 'MedlineDate'));
  if (medlineDate) {
    const yearMatch = medlineDate.match(/\d{4}/);
    if (yearMatch) return yearMatch[0];
  }

  return '';
}

/**
 * Extract abstract text.
 *
 * AbstractText is always an array (from ARRAY_TAGS).  Each element may be
 * a plain string or an object with @_Label and #text (structured abstracts).
 */
function extractAbstract(article: Record<string, unknown>): string {
  const abstractNode = article.Abstract;
  if (!isRecord(abstractNode)) return '';

  const textList = abstractNode.AbstractText;
  if (!Array.isArray(textList)) return str(textList);

  // Structured abstract: multiple labeled sections
  const parts: string[] = [];
  for (const part of textList) {
    if (isRecord(part)) {
      const label = str(part['@_Label']);
      const text = str(part['#text'] ?? part);
      parts.push(label ? `${label}: ${text}` : text);
    } else {
      parts.push(str(part));
    }
  }
  return parts.join(' ');
}

/**
 * Parse a PubMed efetch XML response (after fast-xml-parser processing)
 * into an array of PubmedArticle records.
 */
export function parsePubmedArticles(parsed: unknown): PubmedArticle[] {
  if (!isRecord(parsed)) return [];

  // Top-level key is PubmedArticleSet
  const articleSet = (parsed as Record<string, unknown>).PubmedArticleSet;
  if (!isRecord(articleSet)) return [];

  // PubmedArticle is always an array (from ARRAY_TAGS)
  const articles = (articleSet as Record<string, unknown>).PubmedArticle;
  if (!Array.isArray(articles)) return [];

  const results: PubmedArticle[] = [];

  for (const pa of articles) {
    if (!isRecord(pa)) continue;

    const citation = pa.MedlineCitation;
    if (!isRecord(citation)) continue;

    const pmid = str(
      isRecord(citation.PMID)
        ? (citation.PMID as Record<string, unknown>)['#text']
        : citation.PMID,
    );

    const article = citation.Article;
    if (!isRecord(article)) continue;

    const articleRec = article as Record<string, unknown>;

    // Title may be a string or { '#text': '...' } with inline markup
    const title = str(articleRec.ArticleTitle).replace(/<[^>]+>/g, '');

    // Authors
    const authorListNode = articleRec.AuthorList;
    const authorArray = isRecord(authorListNode)
      ? (authorListNode as Record<string, unknown>).Author
      : undefined;
    const authors = formatAuthors(authorArray);

    // Journal title
    const journal = str(dig(articleRec, 'Journal', 'Title'));

    // Year
    const year = extractYear(articleRec);

    // DOI
    const doi = extractDoi(articleRec);

    // Abstract
    const abstract = extractAbstract(articleRec);

    results.push({ pmid, title, authors, journal, year, doi, abstract });
  }

  return results;
}

// ── Gene types & parser ────────────────────────────────────────────────────

export interface GeneInfo {
  geneId: string;
  symbol: string;
  name: string;
  organism: string;
  summary: string;
  chromosome: string;
  location: string;
}

/**
 * Parse Gene esummary JSON response into GeneInfo records.
 *
 * The esummary JSON for the gene database has the structure:
 * {
 *   result: {
 *     uids: ["7157", ...],
 *     "7157": { uid: "7157", name: "TP53", description: "...", ... }
 *   }
 * }
 */
export function parseGeneSummaries(parsed: unknown): GeneInfo[] {
  if (!isRecord(parsed)) return [];

  const resultObj = (parsed as Record<string, unknown>).result;
  if (!isRecord(resultObj)) return [];

  const uids = (resultObj as Record<string, unknown>).uids;
  if (!Array.isArray(uids)) return [];

  const results: GeneInfo[] = [];

  for (const uid of uids) {
    const entry = (resultObj as Record<string, unknown>)[String(uid)];
    if (!isRecord(entry)) continue;

    const rec = entry as Record<string, unknown>;

    results.push({
      geneId: str(rec.uid),
      symbol: str(rec.name),
      name: str(rec.description),
      organism: str(dig(rec, 'organism', 'scientificname') ?? rec.orgname),
      summary: truncate(str(rec.summary), 300),
      chromosome: str(rec.chromosome),
      location: str(rec.maplocation),
    });
  }

  return results;
}

/**
 * Parse Gene efetch XML response (Entrezgene-Set) into GeneInfo records.
 *
 * Gene efetch XML has the structure:
 *   Entrezgene-Set > Entrezgene[] > Entrezgene_track-info > Gene-track > Gene-track_geneid
 *   etc.
 *
 * This is considerably more complex than esummary, so we prefer esummary
 * for most gene commands.  This parser is provided for completeness.
 */
export function parseGeneEntries(parsed: unknown): GeneInfo[] {
  if (!isRecord(parsed)) return [];

  const entrezSet = (parsed as Record<string, unknown>)['Entrezgene-Set'];
  if (!isRecord(entrezSet)) return [];

  const genes = (entrezSet as Record<string, unknown>).Entrezgene;
  if (!Array.isArray(genes)) return [];

  const results: GeneInfo[] = [];

  for (const gene of genes) {
    if (!isRecord(gene)) continue;

    const g = gene as Record<string, unknown>;

    // Gene ID
    const geneId = str(dig(g, 'Entrezgene_track-info', 'Gene-track', 'Gene-track_geneid'));

    // Symbol and name from Entrezgene_gene > Gene-ref
    const geneRef = dig(g, 'Entrezgene_gene', 'Gene-ref');
    const symbol = isRecord(geneRef) ? str((geneRef as Record<string, unknown>)['Gene-ref_locus']) : '';
    const name = isRecord(geneRef) ? str((geneRef as Record<string, unknown>)['Gene-ref_desc']) : '';

    // Organism from Entrezgene_source > BioSource > BioSource_org > Org-ref > Org-ref_taxname
    const organism = str(
      dig(g, 'Entrezgene_source', 'BioSource', 'BioSource_org', 'Org-ref', 'Org-ref_taxname'),
    );

    // Summary
    const summary = truncate(str(g['Entrezgene_summary']), 300);

    // Chromosome & location from Entrezgene_gene > Gene-ref
    const chromosome = isRecord(geneRef) ? str((geneRef as Record<string, unknown>)['Gene-ref_maploc']) : '';

    // Map location (more specific)
    const location = str(dig(g, 'Entrezgene_location'));

    results.push({ geneId, symbol, name, organism, summary, chromosome, location });
  }

  return results;
}
