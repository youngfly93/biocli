import { cli, Strategy } from '../../registry.js';
import { ArgumentError, CliError, EmptyResultError, EXIT_CODES } from '../../errors.js';
import { withMeta } from '../../types.js';
import {
  fetchAllStudyMolecularProfiles,
  fetchAllStudySampleLists,
  fetchGenesBySymbol,
  fetchMutationsForProfile,
  selectMutationProfile,
  selectMutationSampleList,
} from '../../databases/cbioportal.js';

function clampLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), 500));
}

cli({
  site: 'cbioportal',
  name: 'mutations',
  description: 'Fetch mutation calls for a gene in a cBioPortal study',
  database: 'cbioportal',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'gene', positional: true, required: true, help: 'HGNC gene symbol (e.g. TP53, EGFR)' },
    { name: 'study', required: true, help: 'cBioPortal study ID (e.g. acc_tcga_pan_can_atlas_2018)', producedBy: ['cbioportal/studies'] },
    { name: 'profile', help: 'Optional molecular profile ID. Defaults to the study mutation profile.', producedBy: ['cbioportal/profiles'] },
    { name: 'sample-list', help: 'Optional sample list ID. Defaults to sequenced/all cases for the study.' },
    { name: 'limit', type: 'int', default: 50, help: 'Max mutation rows to return (1-500)' },
  ],
  examples: [
    {
      goal: 'Fetch TP53 mutation calls for a selected study',
      command: 'biocli cbioportal mutations TP53 --study luad_tcga_pan_can_atlas_2018 --limit 50 -f json',
    },
    {
      goal: 'Inspect EGFR mutation rows with an explicit sample list',
      command: 'biocli cbioportal mutations EGFR --study luad_tcga_pan_can_atlas_2018 --sample-list luad_tcga_pan_can_atlas_2018_all -f json',
    },
  ],
  columns: ['gene', 'sampleId', 'patientId', 'proteinChange', 'mutationType', 'studyId'],
  func: async (ctx, args) => {
    const geneQuery = String(args.gene ?? '').trim().toUpperCase();
    const studyId = String(args.study ?? '').trim();
    if (!geneQuery) throw new ArgumentError('Gene symbol is required', 'Example: biocli cbioportal mutations TP53 --study acc_tcga_pan_can_atlas_2018');
    if (!studyId) throw new ArgumentError('Study ID is required', 'Example: biocli cbioportal mutations TP53 --study acc_tcga_pan_can_atlas_2018');

    const requestedProfileId = String(args.profile ?? '').trim();
    const requestedSampleListId = String(args['sample-list'] ?? '').trim();
    const limit = clampLimit(args.limit, 50);

    const genes = await fetchGenesBySymbol(ctx, geneQuery);
    const gene = genes.find(item => item.hugoGeneSymbol.toUpperCase() === geneQuery) ?? genes[0];
    if (!gene) {
      throw new EmptyResultError('cbioportal/mutations', `No cBioPortal gene matched "${geneQuery}". Try a canonical HGNC symbol like TP53 or EGFR.`);
    }

    const profiles = await fetchAllStudyMolecularProfiles(ctx, studyId);
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

    const sampleLists = await fetchAllStudySampleLists(ctx, studyId);
    const sampleList = selectMutationSampleList(sampleLists, requestedSampleListId || undefined);
    if (!sampleList) {
      throw new CliError(
        requestedSampleListId ? 'ARGUMENT' : 'NOT_FOUND',
        requestedSampleListId
          ? `Sample list "${requestedSampleListId}" was not found in study "${studyId}"`
          : `No usable sample list was found for study "${studyId}"`,
        `Run biocli cbioportal studies ${studyId} or inspect the study in cBioPortal for available cohorts.`,
        requestedSampleListId ? EXIT_CODES.USAGE_ERROR : EXIT_CODES.EMPTY_RESULT,
      );
    }

    const mutations = await fetchMutationsForProfile(ctx, {
      molecularProfileId: profile.molecularProfileId,
      entrezGeneIds: [gene.entrezGeneId],
      sampleListId: sampleList.sampleListId,
      pageSize: limit,
    });

    if (!Array.isArray(mutations) || mutations.length === 0) {
      throw new EmptyResultError(
        'cbioportal/mutations',
        `No mutations were found for ${gene.hugoGeneSymbol} in study "${studyId}" using sample list "${sampleList.sampleListId}".`,
      );
    }

    const rows = mutations.map(mutation => ({
      gene: gene.hugoGeneSymbol,
      entrezGeneId: gene.entrezGeneId,
      sampleId: mutation.sampleId ?? '',
      patientId: mutation.patientId ?? '',
      studyId: mutation.studyId ?? studyId,
      molecularProfileId: mutation.molecularProfileId ?? profile.molecularProfileId,
      proteinChange: mutation.proteinChange ?? '',
      mutationType: mutation.mutationType ?? '',
      mutationStatus: mutation.mutationStatus ?? '',
      chr: mutation.chr ?? '',
      startPosition: Number(mutation.startPosition ?? 0),
      endPosition: Number(mutation.endPosition ?? 0),
      variantAllele: mutation.variantAllele ?? '',
      referenceAllele: mutation.referenceAllele ?? '',
      tumorAltCount: Number(mutation.tumorAltCount ?? 0),
      tumorRefCount: Number(mutation.tumorRefCount ?? 0),
      sampleListId: sampleList.sampleListId,
    }));

    return withMeta(rows, {
      totalCount: rows.length,
      query: `${gene.hugoGeneSymbol} @ ${studyId}`,
    });
  },
});
