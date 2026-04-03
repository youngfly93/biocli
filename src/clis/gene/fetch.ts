/**
 * gene/fetch — Download gene sequence by NCBI Gene ID.
 *
 * Uses efetch to retrieve nucleotide or protein sequences in FASTA format.
 * Workflow:
 *   1. esummary to get gene metadata (for organism context)
 *   2. elink to find linked nucleotide/protein records
 *   3. efetch to download the sequence in requested format
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';
import { writeFileSync } from 'node:fs';

cli({
  site: 'gene',
  name: 'fetch',
  description: 'Download gene sequence (nucleotide or protein) in FASTA format',
  database: 'gene',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'id', positional: true, required: true, help: 'NCBI Gene ID (e.g. 7157) or gene symbol with --search' },
    { name: 'type', default: 'nucleotide', choices: ['nucleotide', 'protein'], help: 'Sequence type to download' },
    { name: 'output', help: 'Output file path (default: stdout)' },
  ],
  columns: ['content'],
  defaultFormat: 'plain',
  func: async (ctx, args) => {
    const geneId = String(args.id).trim();
    const seqType = String(args.type);
    const outputFile = args.output ? String(args.output) : undefined;

    if (!/^\d+$/.test(geneId)) {
      throw new CliError('ARGUMENT', `Invalid Gene ID: "${geneId}"`, 'Use a numeric NCBI Gene ID (e.g. 7157 for TP53). Use "biocli gene search" to find IDs.');
    }

    // Step 1: elink to find linked nucleotide or protein records
    const linkDb = seqType === 'protein' ? 'protein' : 'nuccore';
    const linkName = seqType === 'protein' ? 'gene_protein_refseq' : 'gene_nuccore_refseqrna';

    const linkResult = await ctx.fetchJson(buildEutilsUrl('elink.fcgi', {
      dbfrom: 'gene',
      db: linkDb,
      id: geneId,
      linkname: linkName,
      retmode: 'json',
    })) as Record<string, unknown>;

    // Parse elink result to get linked IDs
    const linksets = (linkResult?.linksets ?? []) as Record<string, unknown>[];
    let linkedIds: string[] = [];

    if (linksets.length > 0) {
      const linksetdbs = (linksets[0]?.linksetdbs ?? []) as Record<string, unknown>[];
      if (linksetdbs.length > 0) {
        const links = (linksetdbs[0]?.links ?? []) as string[];
        linkedIds = links;
      }
    }

    // Fallback: try broader link name
    if (!linkedIds.length && seqType === 'nucleotide') {
      const fallbackResult = await ctx.fetchJson(buildEutilsUrl('elink.fcgi', {
        dbfrom: 'gene',
        db: 'nuccore',
        id: geneId,
        linkname: 'gene_nuccore_refseqgene',
        retmode: 'json',
      })) as Record<string, unknown>;

      const fb = (fallbackResult?.linksets ?? []) as Record<string, unknown>[];
      if (fb.length > 0) {
        const fbdbs = (fb[0]?.linksetdbs ?? []) as Record<string, unknown>[];
        if (fbdbs.length > 0) {
          linkedIds = (fbdbs[0]?.links ?? []) as string[];
        }
      }
    }

    if (!linkedIds.length) {
      throw new CliError('NOT_FOUND',
        `No ${seqType} sequences found for Gene ID ${geneId}`,
        `Try the other type: biocli gene fetch ${geneId} --type ${seqType === 'protein' ? 'nucleotide' : 'protein'}`);
    }

    // Step 2: efetch to download FASTA (use first linked ID)
    const targetId = linkedIds[0];
    const fastaUrl = buildEutilsUrl('efetch.fcgi', {
      db: linkDb,
      id: targetId,
      rettype: 'fasta',
      retmode: 'text',
    });

    const fasta = await ctx.fetchText(fastaUrl);

    if (!fasta || !fasta.startsWith('>')) {
      throw new CliError('PARSE_ERROR', 'Failed to retrieve FASTA sequence', 'The linked record may not have a sequence available');
    }

    // Write to file or return for stdout
    if (outputFile) {
      writeFileSync(outputFile, fasta, 'utf-8');
      const lines = fasta.split('\n');
      const header = lines[0];
      const seqLength = lines.slice(1).join('').replace(/\s/g, '').length;
      return [{ content: `Saved ${seqType} sequence to ${outputFile} (${seqLength} bp/aa, ${header})` }];
    }

    return [{ content: fasta.trim() }];
  },
});
