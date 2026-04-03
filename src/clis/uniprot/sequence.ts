/**
 * uniprot/sequence — Download protein sequence in FASTA format.
 *
 * Uses UniProt REST API with format=fasta to retrieve the canonical
 * protein sequence for a given accession.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';
import { writeFileSync } from 'node:fs';

cli({
  site: 'uniprot',
  name: 'sequence',
  description: 'Download protein sequence in FASTA format',
  database: 'uniprot',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'accession', positional: true, required: true, help: 'UniProt accession (e.g. P04637) or multiple comma-separated' },
    { name: 'output', help: 'Output file path (default: stdout)' },
  ],
  columns: ['content'],
  defaultFormat: 'plain',
  func: async (ctx, args) => {
    const input = String(args.accession).trim();
    const outputFile = args.output ? String(args.output) : undefined;
    const accessions = input.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    if (!accessions.length) {
      throw new CliError('ARGUMENT', 'At least one UniProt accession is required');
    }

    const fastaChunks: string[] = [];

    for (const acc of accessions) {
      const fasta = await ctx.fetchText(
        buildUniprotUrl(`/uniprotkb/${acc}.fasta`),
      );

      if (!fasta || !fasta.startsWith('>')) {
        throw new CliError('NOT_FOUND', `UniProt entry ${acc} not found or has no sequence`,
          'Check the accession is correct (e.g. P04637 for TP53_HUMAN)');
      }

      fastaChunks.push(fasta.trim());
    }

    const allFasta = fastaChunks.join('\n');

    if (outputFile) {
      writeFileSync(outputFile, allFasta + '\n', 'utf-8');
      const seqCount = fastaChunks.length;
      const totalLength = allFasta.split('\n')
        .filter(l => !l.startsWith('>'))
        .join('')
        .replace(/\s/g, '')
        .length;
      return [{ content: `Saved ${seqCount} sequence(s) to ${outputFile} (${totalLength} aa total)` }];
    }

    return [{ content: allFasta }];
  },
});
