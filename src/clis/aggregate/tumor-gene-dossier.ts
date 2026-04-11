import { cli, Strategy } from '../../registry.js';
import { CliError, EmptyResultError } from '../../errors.js';
import { wrapResult, type BiocliProvenanceOverride } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { reportProgress } from '../../progress.js';
import {
  fetchAllStudyMolecularProfiles,
  fetchAllStudySampleLists,
  fetchGenesBySymbol,
  fetchSampleIdsForList,
  fetchSampleList,
  sampleListCount,
  selectMutationProfile,
  selectMutationSampleList,
  type CbioPortalMutation,
} from '../../databases/cbioportal.js';
import { clampLimit, fetchAllMutationPages, summarizeCounts } from '../cbioportal/common.js';
import { buildGeneDossier, type GeneDossierBuildResult } from './gene-dossier.js';

export interface TumorExemplarVariant {
  proteinChange: string;
  mutationType: string;
  sampleCount: number;
  patientCount: number;
  chr: string;
  startPosition: number;
  endPosition: number;
  variantAllele: string;
  referenceAllele: string;
}

export interface TumorCoMutationRow {
  partnerGene: string;
  partnerEntrezGeneId: number;
  coMutatedSamples: number;
  partnerPatients: number;
  partnerMutationEvents: number;
  coMutationRateInAnchor: number;
  coMutationRateInAnchorPct: number;
  coMutationFrequencyInStudy: number;
  coMutationFrequencyInStudyPct: number;
  topMutationTypes: Array<Record<string, number | string>>;
  topProteinChanges: Array<Record<string, number | string>>;
}

export interface TumorSummary {
  studyId: string;
  molecularProfileId: string;
  sampleListId: string;
  totalSamples: number;
  alterationStatus: 'altered' | 'not_detected';
  alteredSamples: number;
  uniquePatients: number;
  mutationEvents: number;
  mutationFrequency: number;
  mutationFrequencyPct: number;
  topMutationTypes: Array<Record<string, number | string>>;
  topProteinChanges: Array<Record<string, number | string>>;
  exemplarVariants: TumorExemplarVariant[];
  coMutations: TumorCoMutationRow[];
}

export interface TumorBuildResult {
  summary: TumorSummary;
  ids: Record<string, string>;
  sources: string[];
  warnings: string[];
  provenance: BiocliProvenanceOverride[];
}

function buildExemplarVariants(
  mutations: CbioPortalMutation[],
  limit: number,
): TumorExemplarVariant[] {
  const groups = new Map<string, {
    proteinChange: string;
    mutationType: string;
    sampleIds: Set<string>;
    patientIds: Set<string>;
    chr: string;
    startPosition: number;
    endPosition: number;
    variantAllele: string;
    referenceAllele: string;
  }>();

  for (const mutation of mutations) {
    const proteinChange = String(mutation.proteinChange ?? '').trim();
    const mutationType = String(mutation.mutationType ?? '').trim();
    const key = `${proteinChange}::${mutationType}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        proteinChange,
        mutationType,
        sampleIds: new Set<string>(),
        patientIds: new Set<string>(),
        chr: String(mutation.chr ?? ''),
        startPosition: Number(mutation.startPosition ?? 0),
        endPosition: Number(mutation.endPosition ?? 0),
        variantAllele: String(mutation.variantAllele ?? ''),
        referenceAllele: String(mutation.referenceAllele ?? ''),
      };
      groups.set(key, group);
    }
    if (mutation.sampleId) group.sampleIds.add(mutation.sampleId);
    if (mutation.patientId) group.patientIds.add(mutation.patientId);
  }

  return [...groups.values()]
    .sort((a, b) =>
      b.sampleIds.size - a.sampleIds.size
      || b.patientIds.size - a.patientIds.size
      || a.proteinChange.localeCompare(b.proteinChange))
    .slice(0, limit)
    .map(group => ({
      proteinChange: group.proteinChange,
      mutationType: group.mutationType,
      sampleCount: group.sampleIds.size,
      patientCount: group.patientIds.size,
      chr: group.chr,
      startPosition: group.startPosition,
      endPosition: group.endPosition,
      variantAllele: group.variantAllele,
      referenceAllele: group.referenceAllele,
    }));
}

function buildCoMutations(
  anchorGene: string,
  totalSamples: number,
  anchorSampleIds: string[],
  cohortMutations: CbioPortalMutation[],
  limit: number,
  minSamples: number,
): TumorCoMutationRow[] {
  const partners = new Map<string, {
    partnerGene: string;
    partnerEntrezGeneId: number;
    sampleIds: Set<string>;
    patientIds: Set<string>;
    mutationEvents: number;
    mutationTypes: string[];
    proteinChanges: string[];
  }>();

  for (const mutation of cohortMutations) {
    const partnerGene = String(mutation.gene?.hugoGeneSymbol ?? '').trim();
    const partnerKey = partnerGene.toUpperCase();
    if (!partnerGene || partnerKey === anchorGene.toUpperCase()) continue;
    const partnerEntrezGeneId = Number(mutation.gene?.entrezGeneId ?? mutation.entrezGeneId ?? 0);
    if (!Number.isFinite(partnerEntrezGeneId) || partnerEntrezGeneId <= 0) continue;

    let partner = partners.get(partnerKey);
    if (!partner) {
      partner = {
        partnerGene,
        partnerEntrezGeneId,
        sampleIds: new Set<string>(),
        patientIds: new Set<string>(),
        mutationEvents: 0,
        mutationTypes: [],
        proteinChanges: [],
      };
      partners.set(partnerKey, partner);
    }

    if (mutation.sampleId) partner.sampleIds.add(mutation.sampleId);
    if (mutation.patientId) partner.patientIds.add(mutation.patientId);
    partner.mutationEvents += 1;
    if (mutation.mutationType) partner.mutationTypes.push(mutation.mutationType);
    if (mutation.proteinChange) partner.proteinChanges.push(mutation.proteinChange);
  }

  return [...partners.values()]
    .filter(partner => partner.sampleIds.size >= minSamples)
    .sort((a, b) =>
      b.sampleIds.size - a.sampleIds.size
      || b.mutationEvents - a.mutationEvents
      || a.partnerGene.localeCompare(b.partnerGene))
    .slice(0, limit)
    .map(partner => {
      const coMutatedSamples = partner.sampleIds.size;
      const coMutationRateInAnchor = anchorSampleIds.length === 0 ? 0 : coMutatedSamples / anchorSampleIds.length;
      const coMutationFrequencyInStudy = totalSamples === 0 ? 0 : coMutatedSamples / totalSamples;
      return {
        partnerGene: partner.partnerGene,
        partnerEntrezGeneId: partner.partnerEntrezGeneId,
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
}

export async function buildTumorSummary(
  gene: string,
  studyId: string,
  requestedProfileId: string,
  requestedSampleListId: string,
  pageSize: number,
  coMutationLimit: number,
  exemplarLimit: number,
  minCoSamples: number,
): Promise<TumorBuildResult> {
  const cbioCtx = createHttpContextForDatabase('cbioportal');
  reportProgress('Resolving cBioPortal gene…');
  const genes = await fetchGenesBySymbol(cbioCtx, gene);
  const cbioGene = genes.find(item => item.hugoGeneSymbol.toUpperCase() === gene.toUpperCase()) ?? genes[0];
  if (!cbioGene) {
    throw new EmptyResultError('aggregate/tumor-gene-dossier', `No cBioPortal gene matched "${gene}". Try a canonical HGNC symbol like TP53 or EGFR.`);
  }

  reportProgress('Loading cBioPortal study profiles and sample lists…');
  const [profiles, sampleLists] = await Promise.all([
    fetchAllStudyMolecularProfiles(cbioCtx, studyId),
    fetchAllStudySampleLists(cbioCtx, studyId),
  ]);

  const profile = selectMutationProfile(profiles, requestedProfileId || undefined);
  if (!profile) {
    throw new CliError(
      requestedProfileId ? 'ARGUMENT' : 'NOT_FOUND',
      requestedProfileId
        ? `Molecular profile "${requestedProfileId}" was not found in study "${studyId}"`
        : `No mutation profile was found for study "${studyId}"`,
      `Run biocli cbioportal profiles ${studyId} to inspect available molecular profiles.`,
    );
  }

  const sampleList = selectMutationSampleList(sampleLists, requestedSampleListId || undefined);
  if (!sampleList) {
    throw new CliError(
      requestedSampleListId ? 'ARGUMENT' : 'NOT_FOUND',
      requestedSampleListId
        ? `Sample list "${requestedSampleListId}" was not found in study "${studyId}"`
        : `No usable sample list was found for study "${studyId}"`,
      `Run biocli cbioportal mutations ${gene} --study ${studyId} to inspect study defaults.`,
    );
  }

  const sampleListDetail = await fetchSampleList(cbioCtx, sampleList.sampleListId);
  let totalSamples = sampleListCount(sampleListDetail);
  if (totalSamples === 0) {
    totalSamples = (await fetchSampleIdsForList(cbioCtx, sampleList.sampleListId)).length;
  }
  if (totalSamples === 0) {
    throw new EmptyResultError(
      'aggregate/tumor-gene-dossier',
      `Could not determine the denominator for sample list "${sampleList.sampleListId}" in study "${studyId}".`,
    );
  }

  reportProgress('Fetching cBioPortal anchor mutations…');
  const anchorMutations = await fetchAllMutationPages(cbioCtx, {
    molecularProfileId: profile.molecularProfileId,
    entrezGeneIds: [cbioGene.entrezGeneId],
    sampleListId: sampleList.sampleListId,
    pageSize,
    projection: 'DETAILED',
  });

  const anchorSampleIds = [...new Set(
    anchorMutations
      .map(mutation => mutation.sampleId)
      .filter((value): value is string => Boolean(value)),
  )];
  const uniquePatients = new Set(
    anchorMutations
      .map(mutation => mutation.patientId)
      .filter((value): value is string => Boolean(value)),
  );

  const warnings: string[] = [];
  let coMutations: TumorCoMutationRow[] = [];
  if (anchorSampleIds.length > 0) {
    try {
      reportProgress('Fetching cBioPortal co-mutations…');
      const cohortMutations = await fetchAllMutationPages(cbioCtx, {
        molecularProfileId: profile.molecularProfileId,
        sampleIds: anchorSampleIds,
        pageSize,
        projection: 'DETAILED',
      });
      coMutations = buildCoMutations(
        cbioGene.hugoGeneSymbol,
        totalSamples,
        anchorSampleIds,
        cohortMutations,
        coMutationLimit,
        minCoSamples,
      );
    } catch (err) {
      warnings.push(`cBioPortal co-mutations: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const alteredSamples = anchorSampleIds.length;
  const mutationFrequency = totalSamples === 0 ? 0 : alteredSamples / totalSamples;
  const recordIds = [
    `study:${studyId}`,
    `profile:${profile.molecularProfileId}`,
    `sampleList:${sampleList.sampleListId}`,
    `gene:${cbioGene.hugoGeneSymbol}`,
  ];

  return {
    summary: {
      studyId,
      molecularProfileId: profile.molecularProfileId,
      sampleListId: sampleList.sampleListId,
      totalSamples,
      alterationStatus: alteredSamples > 0 ? 'altered' : 'not_detected',
      alteredSamples,
      uniquePatients: uniquePatients.size,
      mutationEvents: anchorMutations.length,
      mutationFrequency,
      mutationFrequencyPct: Number((mutationFrequency * 100).toFixed(2)),
      topMutationTypes: summarizeCounts(
        anchorMutations.map(mutation => mutation.mutationType ?? ''),
        'mutationType',
      ),
      topProteinChanges: summarizeCounts(
        anchorMutations.map(mutation => mutation.proteinChange ?? ''),
        'proteinChange',
      ),
      exemplarVariants: buildExemplarVariants(anchorMutations, exemplarLimit),
      coMutations,
    },
    ids: {
      cbioportalEntrezGeneId: String(cbioGene.entrezGeneId),
      cbioportalStudyId: studyId,
      cbioportalMolecularProfileId: profile.molecularProfileId,
      cbioportalSampleListId: sampleList.sampleListId,
    },
    sources: ['cBioPortal'],
    warnings,
    provenance: [{
      source: 'cBioPortal',
      recordIds,
    }],
  };
}

cli({
  site: 'aggregate',
  name: 'tumor-gene-dossier',
  description: 'Tumor-focused gene dossier (gene profile + cBioPortal prevalence + co-mutations)',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 120,
  args: [
    { name: 'gene', positional: true, required: true, help: 'Gene symbol (e.g. TP53, EGFR)' },
    { name: 'study', required: true, help: 'cBioPortal study ID (e.g. luad_tcga_pan_can_atlas_2018)', producedBy: ['cbioportal/studies'] },
    { name: 'organism', default: 'human', help: 'Organism for the baseline gene dossier (e.g. human, mouse)' },
    { name: 'papers', type: 'int', default: 5, help: 'Number of recent papers to include in the baseline dossier' },
    { name: 'profile', help: 'Optional molecular profile ID. Defaults to the study mutation profile.', producedBy: ['cbioportal/profiles'] },
    { name: 'sample-list', help: 'Optional sample list ID. Defaults to sequenced/all cases for the study.' },
    { name: 'co-mutations', type: 'int', default: 10, help: 'Number of co-mutated partner genes to include' },
    { name: 'variants', type: 'int', default: 5, help: 'Number of exemplar variant groups to include' },
    { name: 'min-co-samples', type: 'int', default: 1, help: 'Minimum co-mutated samples required for a partner gene' },
    { name: 'page-size', type: 'int', default: 500, help: 'Mutation rows fetched per page (1-500)' },
  ],
  examples: [
    {
      goal: 'Summarize TP53 mutation prevalence and co-mutations in a TCGA lung cohort',
      command: 'biocli aggregate tumor-gene-dossier TP53 --study luad_tcga_pan_can_atlas_2018 -f json',
    },
    {
      goal: 'Inspect EGFR in a study with an explicit molecular profile and sample list',
      command: 'biocli aggregate tumor-gene-dossier EGFR --study luad_tcga_pan_can_atlas_2018 --profile luad_tcga_pan_can_atlas_2018_mutations --sample-list luad_tcga_pan_can_atlas_2018_all -f json',
    },
  ],
  whenToUse: 'Use when you need a tumor-cohort-specific gene briefing that mixes baseline biology with cBioPortal prevalence, variants, and co-mutations.',
  columns: ['symbol', 'studyId', 'alteredSamples', 'mutationFrequencyPct', 'coMutations', 'literature'],
  func: async (_ctx, args) => {
    const gene = String(args.gene ?? '').trim();
    const studyId = String(args.study ?? '').trim();
    if (!gene) throw new CliError('ARGUMENT', 'Gene symbol is required');
    if (!studyId) throw new CliError('ARGUMENT', 'Study ID is required');

    const pageSize = clampLimit(args['page-size'], 500, 500);
    const coMutationLimit = clampLimit(args['co-mutations'], 10, 50);
    const exemplarLimit = clampLimit(args.variants, 5, 20);
    const minCoSamples = clampLimit(args['min-co-samples'], 1, 100000);
    const papers = Math.max(1, Math.min(Number(args.papers), 20));
    const requestedProfileId = String(args.profile ?? '').trim();
    const requestedSampleListId = String(args['sample-list'] ?? '').trim();

    reportProgress('Building baseline gene dossier and cBioPortal tumor overlay…');
    const [geneDossier, tumor] = await Promise.all([
      buildGeneDossier(gene, String(args.organism ?? 'human'), papers),
      buildTumorSummary(
        gene,
        studyId,
        requestedProfileId,
        requestedSampleListId,
        pageSize,
        coMutationLimit,
        exemplarLimit,
        minCoSamples,
      ),
    ]);

    return wrapResult({
      ...geneDossier.data,
      tumor: tumor.summary,
    }, {
      ids: {
        ...geneDossier.ids,
        ...tumor.ids,
      },
      sources: [...geneDossier.sources, ...tumor.sources],
      warnings: [...geneDossier.warnings, ...tumor.warnings],
      organism: geneDossier.organism,
      query: `${gene.toUpperCase()} @ ${studyId}`,
      provenance: [...geneDossier.provenance, ...tumor.provenance],
    });
  },
});
