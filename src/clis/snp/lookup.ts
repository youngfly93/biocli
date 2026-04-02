/**
 * snp/lookup — Look up SNP details by rsID.
 *
 * Uses esummary (JSON mode) directly with the numeric SNP ID
 * to retrieve variant metadata from dbSNP.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { buildEutilsUrl } from '../_shared/eutils.js';

cli({
  site: 'snp',
  name: 'lookup',
  description: 'Look up SNP details by rsID',
  database: 'snp',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'rsid', positional: true, required: true, help: 'dbSNP rsID (e.g. rs334, rs7412, rs429358)' },
  ],
  columns: ['rsid', 'gene', 'chromosome', 'position', 'alleles', 'maf', 'clinical', 'function'],
  func: async (ctx, args) => {
    const rsid = String(args.rsid).toLowerCase();
    // Strip 'rs' prefix if present for the search, keep for display
    const numericId = rsid.replace(/^rs/, '');

    // esummary with SNP ID
    const summary = await ctx.fetchJson(buildEutilsUrl('esummary.fcgi', {
      db: 'snp', id: numericId, retmode: 'json',
    })) as Record<string, any>;

    const uids: string[] = summary?.result?.uids ?? [];
    if (!uids.length) throw new CliError('NOT_FOUND', `SNP rs${numericId} not found`);

    const item = summary.result[uids[0]] ?? {};
    // dbSNP esummary fields: snp_id, genes (array), chrpos, docsum, global_mafs, clinical_significance
    const genes = Array.isArray(item.genes) ? item.genes.map((g: any) => g.name).join(', ') : '';
    const chrpos = item.chrpos ?? '';
    const [chr, pos] = chrpos.includes(':') ? chrpos.split(':') : ['', ''];

    // Parse MAF from docsum or global_mafs
    const mafs = Array.isArray(item.global_mafs)
      ? item.global_mafs.map((m: any) => `${m.study}:${m.freq}`).join('; ')
      : '';

    const clinical = Array.isArray(item.clinical_significance)
      ? item.clinical_significance.join(', ')
      : String(item.clinical_significance ?? '');

    const funcAnnot = Array.isArray(item.fxn_class)
      ? item.fxn_class.join(', ')
      : String(item.fxn_class ?? '');

    return [{
      rsid: `rs${item.snp_id ?? numericId}`,
      gene: genes,
      chromosome: chr,
      position: pos,
      alleles: item.docsum ?? '',
      maf: mafs.slice(0, 50) + (mafs.length > 50 ? '...' : ''),
      clinical,
      function: funcAnnot,
    }];
  },
});
