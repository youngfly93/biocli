/**
 * aggregate/variant-interpret — Variant interpretation with clinical context.
 *
 * Builds on variant-dossier by adding:
 *   - UniProt protein function context for the affected gene
 *   - Structured interpretation summary (pathogenicity, impact, recommendation)
 *
 * Cross-queries: dbSNP + ClinVar + Ensembl VEP + UniProt
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wrapResult } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { buildEutilsUrl } from '../../databases/ncbi.js';
import { buildEnsemblUrl } from '../../databases/ensembl.js';
import { buildUniprotUrl } from '../../databases/uniprot.js';

// ── Impact severity mapping ──────────────────────────────────────────────────

const IMPACT_SEVERITY: Record<string, number> = {
  HIGH: 4,
  MODERATE: 3,
  LOW: 2,
  MODIFIER: 1,
};

function interpretImpact(impact: string): string {
  switch (impact) {
    case 'HIGH': return 'Likely damaging — causes protein truncation, loss of function, or frameshift';
    case 'MODERATE': return 'Possibly damaging — amino acid change that may affect protein function';
    case 'LOW': return 'Likely benign — synonymous or non-coding change with minimal functional impact';
    case 'MODIFIER': return 'Uncertain — regulatory or non-coding region variant';
    default: return 'Unknown impact';
  }
}

cli({
  site: 'aggregate',
  name: 'variant-interpret',
  description: 'Variant interpretation with clinical context (dbSNP + ClinVar + VEP + UniProt)',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 90,
  args: [
    { name: 'variant', positional: true, required: true, help: 'Variant ID: rsID (rs334), HGVS, or genomic coordinate' },
  ],
  columns: ['variant', 'gene', 'consequence', 'clinicalSignificance', 'interpretation'],
  func: async (_ctx, args) => {
    const variant = String(args.variant).trim();
    if (!variant) throw new CliError('ARGUMENT', 'Variant ID is required');

    const sources: string[] = [];
    const warnings: string[] = [];
    const ids: Record<string, string> = {};

    const ncbiCtx = createHttpContextForDatabase('ncbi');
    const ensemblCtx = createHttpContextForDatabase('ensembl');
    const uniprotCtx = createHttpContextForDatabase('uniprot');

    const isRsId = /^rs\d+$/i.test(variant);
    if (isRsId) ids.rsId = variant;

    // Phase 1: Parallel queries (dbSNP + ClinVar + VEP)
    const [snpResult, clinvarResult, vepResult] = await Promise.allSettled([
      // dbSNP
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
          clinicalSignificance: Array.isArray(entry.clinical_significance)
            ? (entry.clinical_significance as string[]).join(', ')
            : String(entry.clinical_significance ?? ''),
        };
      })() : Promise.resolve(null),

      // ClinVar
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
          // NCBI renamed clinical_significance → germline_classification.description (2024/2025)
          const germline = (item.germline_classification ?? {}) as Record<string, unknown>;
          const sig = String(
            germline.description
            ?? (typeof item.clinical_significance === 'object'
              ? (item.clinical_significance as Record<string, unknown>)?.description ?? ''
              : item.clinical_significance ?? '')
          );
          const traitSet = (germline.trait_set ?? item.trait_set) as Record<string, unknown>[] | undefined;
          const traits = Array.isArray(traitSet)
            ? traitSet.map(t => String(t.trait_name ?? '')).join('; ')
            : '';
          return { significance: sig, condition: traits, accession: String(item.accession ?? '') };
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
        const sorted = [...tc].sort((a, b) =>
          (IMPACT_SEVERITY[String(b.impact ?? '')] ?? 0) - (IMPACT_SEVERITY[String(a.impact ?? '')] ?? 0));
        return sorted.slice(0, 5).map(t => ({
          gene: String(t.gene_symbol ?? ''),
          transcript: String(t.transcript_id ?? ''),
          consequence: ((t.consequence_terms ?? []) as string[]).join(', '),
          impact: String(t.impact ?? ''),
          aminoAcids: String(t.amino_acids ?? ''),
          biotype: String(t.biotype ?? ''),
          canonical: Boolean(t.canonical),
        }));
      })(),
    ]);

    // Extract results
    const snpData = snpResult.status === 'fulfilled' ? snpResult.value : null;
    if (snpData) { sources.push('dbSNP'); if (snpData.gene) ids.gene = snpData.gene; }
    else if (snpResult.status === 'rejected') warnings.push(`dbSNP: ${snpResult.reason}`);

    const clinvar = clinvarResult.status === 'fulfilled' ? clinvarResult.value : [];
    if (clinvar.length) sources.push('ClinVar');
    else if (clinvarResult.status === 'rejected') warnings.push(`ClinVar: ${clinvarResult.reason}`);

    const vep = vepResult.status === 'fulfilled' ? vepResult.value : [];
    if (vep.length) sources.push('Ensembl VEP');
    else if (vepResult.status === 'rejected') warnings.push(`Ensembl VEP: ${vepResult.reason}`);

    const geneName = snpData?.gene ?? vep[0]?.gene ?? '';

    // Phase 2: UniProt lookup for gene context (if we have a gene name)
    let proteinFunction = '';
    if (geneName) {
      try {
        const searchData = await uniprotCtx.fetchJson(
          buildUniprotUrl('/uniprotkb/search', {
            query: `gene_exact:${geneName} AND organism_id:9606`,
            fields: 'accession,cc_function',
            format: 'json',
            size: '1',
          }),
        ) as Record<string, unknown>;
        const results = (searchData?.results ?? []) as Record<string, unknown>[];
        if (results.length > 0) {
          sources.push('UniProt');
          const entry = results[0];
          ids.uniprotAccession = String(entry.primaryAccession ?? '');
          const comments = (entry.comments ?? []) as Record<string, unknown>[];
          const funcComment = comments.find(c => c.commentType === 'FUNCTION');
          const texts = (funcComment?.texts ?? []) as Record<string, unknown>[];
          proteinFunction = texts.map(t => String(t.value ?? '')).join(' ');
        }
      } catch (err) {
        warnings.push(`UniProt: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!snpData && !clinvar.length && !vep.length) {
      throw new CliError('NOT_FOUND', `No data found for variant "${variant}"`,
        'Check the variant ID format (e.g. rs334, NM_000518.5:c.20A>T)');
    }

    // Build interpretation
    const topVep = vep[0];
    const topClinvar = clinvar[0];
    const highestImpact = topVep?.impact ?? 'Unknown';
    const clinSig = topClinvar?.significance ?? snpData?.clinicalSignificance ?? 'Not reported';

    const interpretation = {
      clinicalSignificance: clinSig,
      functionalImpact: interpretImpact(highestImpact),
      consequence: topVep?.consequence ?? 'Unknown',
      affectedGene: geneName,
      proteinFunction: proteinFunction || 'No function annotation available',
      conditions: clinvar.map(c => c.condition).filter(Boolean),
      evidenceSources: sources,
      recommendation: clinSig.toLowerCase().includes('pathogenic')
        ? 'This variant has clinical significance. Consider genetic counseling and further clinical evaluation.'
        : clinSig.toLowerCase().includes('benign')
          ? 'This variant is classified as benign. No clinical action typically required.'
          : 'Clinical significance is uncertain. Consider functional studies or additional evidence.',
    };

    return wrapResult({
      variant,
      gene: geneName,
      chromosome: snpData?.chromosome ?? '',
      position: snpData?.position ?? '',
      interpretation,
      vepConsequences: vep,
      clinicalVariants: clinvar,
      dbsnp: snpData ? { alleles: snpData.alleles } : null,
    }, {
      ids,
      sources,
      warnings,
      query: variant,
      provenance: [
        ...(clinvar.length > 0 ? [{
          source: 'ClinVar',
          recordIds: clinvar.map(item => item.accession),
        }] : []),
      ],
    });
  },
});
