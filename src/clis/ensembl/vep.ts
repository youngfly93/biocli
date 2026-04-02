/**
 * ensembl/vep — Variant Effect Predictor via Ensembl REST API.
 *
 * Predicts the functional consequences of variants using HGVS notation,
 * rsID, or genomic coordinates.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEnsemblUrl } from '../../databases/ensembl.js';

cli({
  site: 'ensembl',
  name: 'vep',
  description: 'Predict variant effects (VEP)',
  database: 'ensembl',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'variant', positional: true, required: true, help: 'Variant in HGVS (e.g. "NM_000518.5:c.20A>T") or rsID (e.g. rs334)' },
    { name: 'species', default: 'human', help: 'Species (default: human)' },
  ],
  columns: ['input', 'gene', 'consequence', 'impact', 'biotype', 'aminoAcid', 'codons'],
  func: async (ctx, args) => {
    const variant = String(args.variant).trim();
    const species = String(args.species).toLowerCase();

    // Determine endpoint based on input format
    let url: string;
    if (variant.startsWith('rs')) {
      // rsID input
      url = buildEnsemblUrl(`/vep/${species}/id/${variant}`, {
        canonical: '1',
        hgvs: '1',
        protein: '1',
      });
    } else {
      // HGVS notation
      url = buildEnsemblUrl(`/vep/${species}/hgvs/${encodeURIComponent(variant)}`, {
        canonical: '1',
        hgvs: '1',
        protein: '1',
      });
    }

    const data = await ctx.fetchJson(url) as Record<string, unknown>[];

    if (!Array.isArray(data) || !data.length) {
      throw new CliError('NOT_FOUND', `No VEP results for "${variant}"`, 'Check the variant notation');
    }

    const rows: Record<string, string>[] = [];

    for (const entry of data) {
      const transcriptConsequences = (entry.transcript_consequences ?? []) as Record<string, unknown>[];
      const input = String(entry.input ?? entry.id ?? variant);

      if (!transcriptConsequences.length) {
        rows.push({
          input,
          gene: '',
          consequence: String(entry.most_severe_consequence ?? ''),
          impact: '',
          biotype: '',
          aminoAcid: '',
          codons: '',
        });
        continue;
      }

      // Show canonical transcript first, then others
      const sorted = [...transcriptConsequences].sort((a, b) => {
        if (a.canonical && !b.canonical) return -1;
        if (!a.canonical && b.canonical) return 1;
        return 0;
      });

      // Take top 5 most relevant consequences
      for (const tc of sorted.slice(0, 5)) {
        const consequences = (tc.consequence_terms ?? []) as string[];
        rows.push({
          input,
          gene: String(tc.gene_symbol ?? ''),
          consequence: consequences.join(', '),
          impact: String(tc.impact ?? ''),
          biotype: String(tc.biotype ?? ''),
          aminoAcid: String(tc.amino_acids ?? ''),
          codons: String(tc.codons ?? ''),
        });
      }
    }

    return rows;
  },
});
