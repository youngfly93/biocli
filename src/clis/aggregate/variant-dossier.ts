/**
 * aggregate/variant-dossier — Comprehensive variant interpretation report.
 *
 * Cross-queries:
 *   - NCBI dbSNP (basic variant info)
 *   - ClinVar (clinical significance)
 *   - Ensembl VEP (functional consequence prediction)
 *
 * Accepts rsID (rs334), HGVS notation, or gene:variant format.
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildEnsemblUrl } from '../../databases/ensembl.js';

cli({
  site: 'aggregate',
  name: 'variant-dossier',
  description: 'Comprehensive variant interpretation (dbSNP + ClinVar + VEP)',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 60,
  args: [
    { name: 'variant', positional: true, required: true, help: 'Variant ID: rsID (rs334), HGVS, or genomic coordinate' },
  ],
  columns: ['variant', 'gene', 'consequence', 'clinicalSignificance', 'condition'],
  func: async (_ctx, args) => {
    const variant = String(args.variant).trim();
    if (!variant) throw new CliError('ARGUMENT', 'Variant ID is required');

    const sources: string[] = [];
    const warnings: string[] = [];
    const ids: Record<string, string> = {};

    const ncbiCtx = createHttpContextForDatabase('ncbi');
    const ensemblCtx = createHttpContextForDatabase('ensembl');

    // Determine if input is rsID
    const isRsId = /^rs\d+$/i.test(variant);
    if (isRsId) ids.rsId = variant;

    // Parallel queries
    const [snpResult, clinvarResult, vepResult] = await Promise.allSettled([
      // dbSNP lookup
      isRsId ? (async () => {
        const data = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
          db: 'snp', id: variant.replace(/^rs/i, ''), retmode: 'json',
        })) as Record<string, unknown>;
        const result = data?.result as Record<string, unknown> | undefined;
        const snpId = variant.replace(/^rs/i, '');
        const entry = result?.[snpId] as Record<string, unknown> | undefined;
        if (!entry) return null;
        return {
          rsid: `rs${snpId}`,
          gene: String((Array.isArray(entry.genes) && entry.genes.length > 0) ? (entry.genes[0] as Record<string, unknown>).name ?? '' : ''),
          chromosome: String(entry.chr ?? ''),
          position: String(entry.chrpos ?? ''),
          alleles: String(entry.docsum ?? ''),
          maf: String(entry.global_maf ?? ''),
        };
      })() : Promise.resolve(null),

      // ClinVar search
      isRsId ? (async () => {
        const sr = await ncbiCtx.fetchJson(buildEutilsUrl('esearch.fcgi', {
          db: 'clinvar', term: `${variant}[Variant ID]`, retmax: '5', retmode: 'json',
        })) as Record<string, unknown>;
        const cvIds: string[] = (sr?.esearchresult as Record<string, unknown>)?.idlist as string[] ?? [];
        if (!cvIds.length) return [];
        const summ = await ncbiCtx.fetchJson(buildEutilsUrl('esummary.fcgi', {
          db: 'clinvar', id: cvIds.join(','), retmode: 'json',
        })) as Record<string, unknown>;
        const resultObj = summ?.result as Record<string, unknown> | undefined;
        const uids: string[] = (resultObj?.uids as string[] | undefined) ?? [];
        return uids.map(uid => {
          const item = (resultObj?.[uid] ?? {}) as Record<string, unknown>;
          const sig = typeof item.clinical_significance === 'object'
            ? String((item.clinical_significance as Record<string, unknown>)?.description ?? '')
            : String(item.clinical_significance ?? '');
          const traits = Array.isArray(item.trait_set)
            ? (item.trait_set as Record<string, unknown>[]).map(t => String(t.trait_name ?? '')).join('; ')
            : '';
          return {
            title: String(item.title ?? ''),
            significance: sig,
            condition: traits,
            accession: String(item.accession ?? ''),
          };
        });
      })() : Promise.resolve([]),

      // Ensembl VEP
      (async () => {
        const vepPath = isRsId
          ? `/vep/human/id/${variant}`
          : `/vep/human/hgvs/${encodeURIComponent(variant)}`;
        const data = await ensemblCtx.fetchJson(
          buildEnsemblUrl(vepPath, { canonical: '1', hgvs: '1', protein: '1' }),
        ) as Record<string, unknown>[];
        if (!Array.isArray(data) || !data.length) return [];
        const entry = data[0];
        const tc = (entry.transcript_consequences ?? []) as Record<string, unknown>[];
        // Pick canonical transcript or first
        const sorted = [...tc].sort((a, b) => (a.canonical ? -1 : 0) - (b.canonical ? -1 : 0));
        return sorted.slice(0, 5).map(t => ({
          gene: String(t.gene_symbol ?? ''),
          transcript: String(t.transcript_id ?? ''),
          consequence: ((t.consequence_terms ?? []) as string[]).join(', '),
          impact: String(t.impact ?? ''),
          aminoAcids: String(t.amino_acids ?? ''),
          codons: String(t.codons ?? ''),
          biotype: String(t.biotype ?? ''),
          canonical: Boolean(t.canonical),
        }));
      })(),
    ]);

    // Assemble
    let snpData: Record<string, string> | null = null;
    if (snpResult.status === 'fulfilled' && snpResult.value) {
      snpData = snpResult.value;
      sources.push('dbSNP');
      if (snpData.gene) ids.gene = snpData.gene;
    } else if (snpResult.status === 'rejected') {
      warnings.push(`dbSNP: ${snpResult.reason}`);
    }

    const clinvar = clinvarResult.status === 'fulfilled' ? clinvarResult.value : [];
    if (clinvar.length) sources.push('ClinVar');
    else if (clinvarResult.status === 'rejected') {
      warnings.push(`ClinVar: ${clinvarResult.reason}`);
    }

    const vep = vepResult.status === 'fulfilled' ? vepResult.value : [];
    if (vep.length) sources.push('Ensembl VEP');
    else if (vepResult.status === 'rejected') {
      warnings.push(`Ensembl VEP: ${vepResult.reason}`);
    }

    if (!snpData && !clinvar.length && !vep.length) {
      throw new CliError('NOT_FOUND', `No data found for variant "${variant}"`,
        'Check the variant ID format (e.g. rs334, NM_000518.5:c.20A>T)');
    }

    const dossier = {
      variant,
      gene: snpData?.gene ?? vep[0]?.gene ?? '',
      chromosome: snpData?.chromosome ?? '',
      position: snpData?.position ?? '',
      vepConsequences: vep,
      clinicalVariants: clinvar,
      dbsnp: snpData ? {
        alleles: snpData.alleles,
        maf: snpData.maf,
      } : null,
    };

    return wrapResult(dossier, {
      ids,
      sources,
      warnings,
      query: variant,
    });
  },
});
