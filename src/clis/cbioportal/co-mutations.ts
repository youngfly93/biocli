import { cli, Strategy } from '../../registry.js';
import { ArgumentError, CliError, EmptyResultError, EXIT_CODES } from '../../errors.js';
import { withMeta } from '../../types.js';
import {
  fetchAllStudyMolecularProfiles,
  fetchAllStudySampleLists,
  fetchGenesBySymbol,
  fetchSampleIdsForList,
  fetchSampleList,
  sampleListCount,
  selectMutationProfile,
  selectMutationSampleList,
} from '../../databases/cbioportal.js';
import { clampLimit, fetchAllMutationPages, summarizeCounts } from './common.js';

interface PartnerAccumulator {
  anchorGene: string;
  partnerGene: string;
  partnerEntrezGeneId: number;
  sampleIds: Set<string>;
  patientIds: Set<string>;
  mutationEvents: number;
  mutationTypes: string[];
  proteinChanges: string[];
}

cli({
  site: 'cbioportal',
  name: 'co-mutations',
  description: 'Rank genes co-mutated with an anchor gene inside a cBioPortal study',
  database: 'cbioportal',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'gene', positional: true, required: true, help: 'Anchor HGNC gene symbol (e.g. TP53, EGFR)' },
    { name: 'study', required: true, help: 'cBioPortal study ID (e.g. acc_tcga_pan_can_atlas_2018)' },
    { name: 'profile', help: 'Optional molecular profile ID. Defaults to the study mutation profile.' },
    { name: 'sample-list', help: 'Optional sample list ID. Defaults to sequenced/all cases for the study.' },
    { name: 'limit', type: 'int', default: 20, help: 'Max partner genes to return (1-100)' },
    { name: 'min-samples', type: 'int', default: 1, help: 'Minimum co-mutated samples required for a partner gene' },
    { name: 'page-size', type: 'int', default: 500, help: 'Mutation rows fetched per page (1-500)' },
  ],
  columns: [
    'partnerGene',
    'coMutatedSamples',
    'coMutationRateInAnchorPct',
    'coMutationFrequencyInStudyPct',
    'partnerMutationEvents',
  ],
  func: async (ctx, args) => {
    const geneQuery = String(args.gene ?? '').trim().toUpperCase();
    const studyId = String(args.study ?? '').trim();
    if (!geneQuery) throw new ArgumentError('Gene symbol is required', 'Example: biocli cbioportal co-mutations TP53 --study acc_tcga_pan_can_atlas_2018');
    if (!studyId) throw new ArgumentError('Study ID is required', 'Example: biocli cbioportal co-mutations TP53 --study acc_tcga_pan_can_atlas_2018');

    const requestedProfileId = String(args.profile ?? '').trim();
    const requestedSampleListId = String(args['sample-list'] ?? '').trim();
    const pageSize = clampLimit(args['page-size'], 500, 500);
    const limit = clampLimit(args.limit, 20, 100);
    const minSamples = clampLimit(args['min-samples'], 1, 100000);

    const genes = await fetchGenesBySymbol(ctx, geneQuery);
    const gene = genes.find(item => item.hugoGeneSymbol.toUpperCase() === geneQuery) ?? genes[0];
    if (!gene) {
      throw new EmptyResultError('cbioportal/co-mutations', `No cBioPortal gene matched "${geneQuery}". Try a canonical HGNC symbol like TP53 or EGFR.`);
    }

    const [profiles, sampleLists] = await Promise.all([
      fetchAllStudyMolecularProfiles(ctx, studyId),
      fetchAllStudySampleLists(ctx, studyId),
    ]);

    const profile = selectMutationProfile(profiles, requestedProfileId || undefined);
    if (!profile) {
      throw new CliError(
        requestedProfileId ? 'ARGUMENT' : 'NOT_FOUND',
        requestedProfileId
          ? `Molecular profile "${requestedProfileId}" was not found in study "${studyId}"`
          : `No mutation profile was found for study "${studyId}"`,
        `Run biocli cbioportal profiles ${studyId} to inspect available molecular profiles.`,
        requestedProfileId ? EXIT_CODES.USAGE_ERROR : EXIT_CODES.EMPTY_RESULT,
      );
    }

    const sampleList = selectMutationSampleList(sampleLists, requestedSampleListId || undefined);
    if (!sampleList) {
      throw new CliError(
        requestedSampleListId ? 'ARGUMENT' : 'NOT_FOUND',
        requestedSampleListId
          ? `Sample list "${requestedSampleListId}" was not found in study "${studyId}"`
          : `No usable sample list was found for study "${studyId}"`,
        `Run biocli cbioportal mutations ${gene.hugoGeneSymbol} --study ${studyId} to inspect study defaults.`,
        requestedSampleListId ? EXIT_CODES.USAGE_ERROR : EXIT_CODES.EMPTY_RESULT,
      );
    }

    const sampleListDetail = await fetchSampleList(ctx, sampleList.sampleListId);
    let totalSamples = sampleListCount(sampleListDetail);
    if (totalSamples === 0) {
      totalSamples = (await fetchSampleIdsForList(ctx, sampleList.sampleListId)).length;
    }
    if (totalSamples === 0) {
      throw new EmptyResultError(
        'cbioportal/co-mutations',
        `Could not determine the denominator for sample list "${sampleList.sampleListId}" in study "${studyId}".`,
      );
    }

    const anchorMutations = await fetchAllMutationPages(ctx, {
      molecularProfileId: profile.molecularProfileId,
      entrezGeneIds: [gene.entrezGeneId],
      sampleListId: sampleList.sampleListId,
      pageSize,
    });
    const anchorSampleIds = [...new Set(
      anchorMutations
        .map(mutation => mutation.sampleId)
        .filter((value): value is string => Boolean(value)),
    )];

    if (anchorSampleIds.length === 0) {
      throw new EmptyResultError(
        'cbioportal/co-mutations',
        `No mutations were found for ${gene.hugoGeneSymbol} in study "${studyId}" using sample list "${sampleList.sampleListId}".`,
      );
    }

    const cohortMutations = await fetchAllMutationPages(ctx, {
      molecularProfileId: profile.molecularProfileId,
      sampleIds: anchorSampleIds,
      pageSize,
      projection: 'DETAILED',
    });

    const partners = new Map<string, PartnerAccumulator>();
    for (const mutation of cohortMutations) {
      const partnerGene = String(mutation.gene?.hugoGeneSymbol ?? '').trim();
      const partnerKey = partnerGene.toUpperCase();
      if (!partnerGene || partnerKey === gene.hugoGeneSymbol.toUpperCase()) continue;
      const partnerEntrezGeneId = Number(mutation.gene?.entrezGeneId ?? mutation.entrezGeneId ?? 0);
      if (!Number.isFinite(partnerEntrezGeneId) || partnerEntrezGeneId <= 0) continue;

      let acc = partners.get(partnerKey);
      if (!acc) {
        acc = {
          anchorGene: gene.hugoGeneSymbol,
          partnerGene,
          partnerEntrezGeneId,
          sampleIds: new Set<string>(),
          patientIds: new Set<string>(),
          mutationEvents: 0,
          mutationTypes: [],
          proteinChanges: [],
        };
        partners.set(partnerKey, acc);
      }

      if (mutation.sampleId) acc.sampleIds.add(mutation.sampleId);
      if (mutation.patientId) acc.patientIds.add(mutation.patientId);
      acc.mutationEvents += 1;
      if (mutation.mutationType) acc.mutationTypes.push(mutation.mutationType);
      if (mutation.proteinChange) acc.proteinChanges.push(mutation.proteinChange);
    }

    const rows = [...partners.values()]
      .filter(partner => partner.sampleIds.size >= minSamples)
      .sort((a, b) =>
        b.sampleIds.size - a.sampleIds.size
        || b.mutationEvents - a.mutationEvents
        || a.partnerGene.localeCompare(b.partnerGene))
      .slice(0, limit)
      .map(partner => {
        const coMutatedSamples = partner.sampleIds.size;
        const coMutationRateInAnchor = coMutatedSamples / anchorSampleIds.length;
        const coMutationFrequencyInStudy = coMutatedSamples / totalSamples;
        return {
          anchorGene: partner.anchorGene,
          partnerGene: partner.partnerGene,
          partnerEntrezGeneId: partner.partnerEntrezGeneId,
          studyId,
          molecularProfileId: profile.molecularProfileId,
          sampleListId: sampleList.sampleListId,
          totalSamples,
          anchorMutatedSamples: anchorSampleIds.length,
          coMutatedSamples,
          partnerPatients: partner.patientIds.size,
          partnerMutationEvents: partner.mutationEvents,
          coMutationRateInAnchor,
          coMutationRateInAnchorPct: Number((coMutationRateInAnchor * 100).toFixed(2)),
          coMutationFrequencyInStudy,
          coMutationFrequencyInStudyPct: Number((coMutationFrequencyInStudy * 100).toFixed(2)),
          topMutationTypes: summarizeCounts(partner.mutationTypes, 'mutationType'),
          topProteinChanges: summarizeCounts(partner.proteinChanges, 'proteinChange'),
        };
      });

    if (rows.length === 0) {
      throw new EmptyResultError(
        'cbioportal/co-mutations',
        `No partner genes met the co-mutation threshold (${minSamples} sample${minSamples === 1 ? '' : 's'}) for ${gene.hugoGeneSymbol} in study "${studyId}".`,
      );
    }

    return withMeta(rows, {
      totalCount: rows.length,
      query: `${gene.hugoGeneSymbol} @ ${studyId}`,
    });
  },
});
