import { pathToFileURL } from 'node:url';
import {
  CANCER_GENE_CONTEXT_ENTRIES,
  CANCER_GENE_CONTEXT_REFERENCE,
} from './cancer-gene-context-v1.js';

interface NcbiSummaryItem {
  name?: string;
}

interface NcbiSummaryResponse {
  result?: Record<string, NcbiSummaryItem | string[]>;
}

export async function validateCancerGeneContextIdentities(): Promise<string[]> {
  const errors: string[] = [];
  const symbols = new Set<string>();
  const ids = new Set<number>();

  for (const entry of CANCER_GENE_CONTEXT_ENTRIES) {
    if (symbols.has(entry.symbol)) errors.push(`Duplicate symbol: ${entry.symbol}`);
    if (ids.has(entry.entrezGeneId)) errors.push(`Duplicate Entrez Gene ID: ${entry.entrezGeneId}`);
    symbols.add(entry.symbol);
    ids.add(entry.entrezGeneId);
  }

  for (let offset = 0; offset < CANCER_GENE_CONTEXT_ENTRIES.length; offset += 100) {
    const batch = CANCER_GENE_CONTEXT_ENTRIES.slice(offset, offset + 100);
    const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    url.search = new URLSearchParams({
      db: 'gene',
      id: batch.map(entry => entry.entrezGeneId).join(','),
      retmode: 'json',
    }).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`NCBI Gene identity request failed: HTTP ${response.status}`);
    }
    const payload = await response.json() as NcbiSummaryResponse;
    for (const entry of batch) {
      const item = payload.result?.[String(entry.entrezGeneId)];
      const currentSymbol = item && !Array.isArray(item) ? item.name : undefined;
      if (!currentSymbol) {
        errors.push(`${entry.symbol}/${entry.entrezGeneId}: NCBI Gene record missing`);
      } else if (currentSymbol.toUpperCase() !== entry.symbol) {
        errors.push(`${entry.symbol}/${entry.entrezGeneId}: NCBI current symbol is ${currentSymbol}`);
      }
    }
  }

  return errors;
}

async function main(): Promise<void> {
  const errors = await validateCancerGeneContextIdentities();
  if (errors.length > 0) {
    console.error(`${CANCER_GENE_CONTEXT_REFERENCE.id}: ${errors.length} validation error(s)`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${CANCER_GENE_CONTEXT_REFERENCE.id}: ${CANCER_GENE_CONTEXT_ENTRIES.length} identities validated against NCBI Gene`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
