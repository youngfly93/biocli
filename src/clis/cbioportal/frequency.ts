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

cli({
  site: 'cbioportal',
  name: 'frequency',
  description: 'Summarize mutation prevalence for a gene in a cBioPortal study',
  database: 'cbioportal',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'gene', positional: true, required: true, help: 'HGNC gene symbol (e.g. TP53, EGFR)' },
    { name: 'study', required: true, help: 'cBioPortal study ID (e.g. acc_tcga_pan_can_atlas_2018)' },
    { name: 'profile', help: 'Optional molecular profile ID. Defaults to the study mutation profile.' },
    { name: 'sample-list', help: 'Optional sample list ID. Defaults to sequenced/all cases for the study.' },
    { name: 'page-size', type: 'int', default: 500, help: 'Mutation rows fetched per page (1-500)' },
  ],
  examples: [
    {
      goal: 'Estimate TP53 mutation prevalence in a TCGA lung adenocarcinoma cohort',
      command: 'biocli cbioportal frequency TP53 --study luad_tcga_pan_can_atlas_2018 -f json',
    },
    {
      goal: 'Run frequency with an explicit profile and cohort',
      command: 'biocli cbioportal frequency EGFR --study luad_tcga_pan_can_atlas_2018 --profile luad_tcga_pan_can_atlas_2018_mutations --sample-list luad_tcga_pan_can_atlas_2018_all -f json',
    },
  ],
  columns: ['gene', 'studyId', 'mutatedSamples', 'totalSamples', 'mutationFrequencyPct', 'mutationEvents'],
  func: async (ctx, args) => {
    const geneQuery = String(args.gene ?? '').trim().toUpperCase();
    const studyId = String(args.study ?? '').trim();
    if (!geneQuery) throw new ArgumentError('Gene symbol is required', 'Example: biocli cbioportal frequency TP53 --study acc_tcga_pan_can_atlas_2018');
    if (!studyId) throw new ArgumentError('Study ID is required', 'Example: biocli cbioportal frequency TP53 --study acc_tcga_pan_can_atlas_2018');

    const requestedProfileId = String(args.profile ?? '').trim();
    const requestedSampleListId = String(args['sample-list'] ?? '').trim();
    const pageSize = clampLimit(args['page-size'], 500, 500);

    const genes = await fetchGenesBySymbol(ctx, geneQuery);
    const gene = genes.find(item => item.hugoGeneSymbol.toUpperCase() === geneQuery) ?? genes[0];
    if (!gene) {
      throw new EmptyResultError('cbioportal/frequency', `No cBioPortal gene matched "${geneQuery}". Try a canonical HGNC symbol like TP53 or EGFR.`);
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
        'cbioportal/frequency',
        `Could not determine the denominator for sample list "${sampleList.sampleListId}" in study "${studyId}".`,
      );
    }

    const mutations = await fetchAllMutationPages(ctx, {
      molecularProfileId: profile.molecularProfileId,
      entrezGeneIds: [gene.entrezGeneId],
      sampleListId: sampleList.sampleListId,
      pageSize,
    });

    if (mutations.length === 0) {
      throw new EmptyResultError(
        'cbioportal/frequency',
        `No mutations were found for ${gene.hugoGeneSymbol} in study "${studyId}" using sample list "${sampleList.sampleListId}".`,
      );
    }

    const uniqueSamples = new Set(mutations.map(mutation => mutation.sampleId).filter((value): value is string => Boolean(value)));
    const uniquePatients = new Set(mutations.map(mutation => mutation.patientId).filter((value): value is string => Boolean(value)));
    const mutatedSamples = uniqueSamples.size;
    const mutationEvents = mutations.length;
    const mutationFrequency = mutatedSamples / totalSamples;

    const summary = {
      gene: gene.hugoGeneSymbol,
      entrezGeneId: gene.entrezGeneId,
      studyId,
      molecularProfileId: profile.molecularProfileId,
      sampleListId: sampleList.sampleListId,
      totalSamples,
      mutatedSamples,
      uniquePatients: uniquePatients.size,
      mutationEvents,
      mutationFrequency,
      mutationFrequencyPct: Number((mutationFrequency * 100).toFixed(2)),
      topMutationTypes: summarizeCounts(
        mutations.map(mutation => mutation.mutationType ?? ''),
        'mutationType',
      ),
      topProteinChanges: summarizeCounts(
        mutations.map(mutation => mutation.proteinChange ?? ''),
        'proteinChange',
      ),
    };

    return withMeta([summary], {
      totalCount: 1,
      query: `${gene.hugoGeneSymbol} @ ${studyId}`,
    });
  },
});
