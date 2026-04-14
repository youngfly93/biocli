import type { BatchSuccessRecord } from './batch-types.js';
import { isRecord } from './utils.js';

export interface FlattenedBatchTable {
  headers: string[];
  rows: Record<string, unknown>[];
}

function flattenGeneProfileRecord(record: BatchSuccessRecord): Record<string, unknown> | null {
  const result = record.result;
  if (!isRecord(result) || !isRecord(result.data)) return null;
  const data = result.data;
  const pathways = Array.isArray(data.pathways) ? data.pathways : [];
  const goTerms = Array.isArray(data.goTerms) ? data.goTerms : [];
  const interactions = Array.isArray(data.interactions) ? data.interactions : [];
  const diseases = Array.isArray(data.diseases) ? data.diseases : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const sources = Array.isArray(result.sources) ? result.sources : [];

  return {
    input: record.input,
    query: result.query,
    symbol: data.symbol,
    name: data.name,
    organism: result.organism,
    completeness: result.completeness,
    sources: sources.join(';'),
    warningsCount: warnings.length,
    pathwayCount: pathways.length,
    goTermCount: goTerms.length,
    interactionCount: interactions.length,
    diseaseCount: diseases.length,
    ncbiGeneId: isRecord(result.ids) ? result.ids.ncbiGeneId : '',
    uniprotAccession: isRecord(result.ids) ? result.ids.uniprotAccession : '',
    ensemblGeneId: isRecord(result.ids) ? result.ids.ensemblGeneId : '',
    queriedAt: result.queriedAt,
  };
}

function flattenDrugTargetRecord(record: BatchSuccessRecord): Record<string, unknown> | null {
  const result = record.result;
  if (!isRecord(result) || !isRecord(result.data)) return null;
  const data = result.data;
  const summary = isRecord(data.summary) ? data.summary : {};
  const agentSummary = isRecord(data.agentSummary) ? data.agentSummary : {};
  const target = isRecord(data.target) ? data.target : {};
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const topCandidate = (candidates[0] && isRecord(candidates[0])) ? candidates[0] : {};
  const ranking = isRecord(topCandidate.ranking) ? topCandidate.ranking : {};
  const tumorStudy = isRecord(data.tumorStudy) ? data.tumorStudy : {};
  const topSummaryCandidate = Array.isArray(agentSummary.topCandidates) && isRecord(agentSummary.topCandidates[0])
    ? agentSummary.topCandidates[0]
    : {};
  const topSensitivitySignal = Array.isArray(agentSummary.topSensitivitySignals) && isRecord(agentSummary.topSensitivitySignals[0])
    ? agentSummary.topSensitivitySignals[0]
    : {};
  const tumorContext = isRecord(agentSummary.tumorContext) ? agentSummary.tumorContext : {};
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const sources = Array.isArray(result.sources) ? result.sources : [];

  return {
    input: record.input,
    query: result.query,
    targetSymbol: target.symbol,
    targetName: target.name,
    rankingMode: summary.rankingMode,
    diseaseFilter: summary.diseaseFilter ?? '',
    totalCandidates: summary.totalCandidates ?? 0,
    matchedCandidates: summary.matchedCandidates ?? 0,
    returnedCandidates: summary.returnedCandidates ?? 0,
    approvedDrugs: summary.approvedDrugs ?? 0,
    clinicalCandidates: summary.clinicalCandidates ?? 0,
    sensitivitySupportedCandidates: summary.sensitivitySupportedCandidates ?? 0,
    topFinding: agentSummary.topFinding ?? '',
    matchedDisease: agentSummary.matchedDisease ?? summary.diseaseFilter ?? '',
    topDrugName: topCandidate.drugName ?? '',
    topDrugStage: topCandidate.maxClinicalStage ?? '',
    topDrugType: topCandidate.drugType ?? '',
    topDrugScore: ranking.score ?? '',
    topSummaryDrugName: topSummaryCandidate.drugName ?? '',
    topSummaryDrugStage: topSummaryCandidate.maxClinicalStageLabel ?? topSummaryCandidate.maxClinicalStage ?? '',
    topSummaryDrugScore: topSummaryCandidate.score ?? '',
    topSummaryReasons: Array.isArray(topSummaryCandidate.reasons) ? topSummaryCandidate.reasons.join(';') : '',
    topSensitivityDrugName: topSensitivitySignal.drugName ?? '',
    topSensitivityDataset: topSensitivitySignal.dataset ?? '',
    topSensitivityTissue: topSensitivitySignal.tissue ?? '',
    topSensitivityCellLine: topSensitivitySignal.cellLineName ?? '',
    topSensitivityZScore: topSensitivitySignal.zScore ?? '',
    tumorStudyId: tumorStudy.studyId ?? '',
    tumorMutationFrequencyPct: tumorStudy.mutationFrequencyPct ?? '',
    tumorAlteredSamples: tumorContext.alteredSamples ?? '',
    tumorTotalSamples: tumorContext.totalSamples ?? '',
    recommendedNextStepType: isRecord(agentSummary.recommendedNextStep) ? agentSummary.recommendedNextStep.type ?? '' : '',
    completeness: result.completeness,
    warningsCount: warnings.length,
    sources: sources.join(';'),
    ensemblGeneId: isRecord(result.ids) ? result.ids.ensemblGeneId : '',
    queriedAt: result.queriedAt,
  };
}

function flattenTumorGeneDossierRecord(record: BatchSuccessRecord): Record<string, unknown> | null {
  const result = record.result;
  if (!isRecord(result) || !isRecord(result.data)) return null;
  const data = result.data;
  const tumor = isRecord(data.tumor) ? data.tumor : {};
  const agentSummary = isRecord(data.agentSummary) ? data.agentSummary : {};
  const coMutations = Array.isArray(tumor.coMutations) ? tumor.coMutations : [];
  const exemplarVariants = Array.isArray(tumor.exemplarVariants) ? tumor.exemplarVariants : [];
  const literature = Array.isArray(data.literature) ? data.literature : [];
  const topCoMutation = (coMutations[0] && isRecord(coMutations[0])) ? coMutations[0] : {};
  const topSummaryCoMutation = Array.isArray(agentSummary.topCoMutations) && isRecord(agentSummary.topCoMutations[0])
    ? agentSummary.topCoMutations[0]
    : {};
  const topSummaryVariant = Array.isArray(agentSummary.exemplarVariants) && isRecord(agentSummary.exemplarVariants[0])
    ? agentSummary.exemplarVariants[0]
    : {};
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const sources = Array.isArray(result.sources) ? result.sources : [];

  return {
    input: record.input,
    query: result.query,
    symbol: data.symbol,
    name: data.name,
    organism: result.organism,
    studyId: tumor.studyId ?? '',
    alterationStatus: tumor.alterationStatus ?? '',
    alteredSamples: tumor.alteredSamples ?? 0,
    totalSamples: tumor.totalSamples ?? 0,
    mutationEvents: tumor.mutationEvents ?? 0,
    mutationFrequencyPct: tumor.mutationFrequencyPct ?? 0,
    topFinding: agentSummary.topFinding ?? '',
    coMutationCount: coMutations.length,
    topCoMutationGene: topCoMutation.partnerGene ?? '',
    topCoMutationRatePct: topCoMutation.coMutationRateInAnchorPct ?? '',
    topCoMutationContextTag: topSummaryCoMutation.contextTag ?? '',
    exemplarVariantCount: exemplarVariants.length,
    topVariantProteinChange: topSummaryVariant.proteinChange ?? '',
    topVariantMutationType: topSummaryVariant.mutationType ?? '',
    recommendedNextStepType: isRecord(agentSummary.recommendedNextStep) ? agentSummary.recommendedNextStep.type ?? '' : '',
    literatureCount: literature.length,
    completeness: result.completeness,
    warningsCount: warnings.length,
    sources: sources.join(';'),
    ncbiGeneId: isRecord(result.ids) ? result.ids.ncbiGeneId : '',
    uniprotAccession: isRecord(result.ids) ? result.ids.uniprotAccession : '',
    cbioportalStudyId: isRecord(result.ids) ? result.ids.cbioportalStudyId : '',
    queriedAt: result.queriedAt,
  };
}

export function flattenBatchSuccesses(
  command: string,
  successes: BatchSuccessRecord[],
): FlattenedBatchTable | null {
  if (command === 'aggregate/gene-profile') {
    const rows = successes
      .map(flattenGeneProfileRecord)
      .filter((row): row is Record<string, unknown> => Boolean(row));
    if (rows.length === 0) return null;
    return {
      headers: [
        'input',
        'query',
        'symbol',
        'name',
        'organism',
        'completeness',
        'sources',
        'warningsCount',
        'pathwayCount',
        'goTermCount',
        'interactionCount',
        'diseaseCount',
        'ncbiGeneId',
        'uniprotAccession',
        'ensemblGeneId',
        'queriedAt',
      ],
      rows,
    };
  }
  if (command === 'aggregate/drug-target') {
    const rows = successes
      .map(flattenDrugTargetRecord)
      .filter((row): row is Record<string, unknown> => Boolean(row));
    if (rows.length === 0) return null;
    return {
      headers: [
        'input',
        'query',
        'targetSymbol',
        'targetName',
        'rankingMode',
        'diseaseFilter',
        'totalCandidates',
        'matchedCandidates',
        'returnedCandidates',
        'approvedDrugs',
        'clinicalCandidates',
        'sensitivitySupportedCandidates',
        'topFinding',
        'matchedDisease',
        'topDrugName',
        'topDrugStage',
        'topDrugType',
        'topDrugScore',
        'topSummaryDrugName',
        'topSummaryDrugStage',
        'topSummaryDrugScore',
        'topSummaryReasons',
        'topSensitivityDrugName',
        'topSensitivityDataset',
        'topSensitivityTissue',
        'topSensitivityCellLine',
        'topSensitivityZScore',
        'tumorStudyId',
        'tumorMutationFrequencyPct',
        'tumorAlteredSamples',
        'tumorTotalSamples',
        'recommendedNextStepType',
        'completeness',
        'warningsCount',
        'sources',
        'ensemblGeneId',
        'queriedAt',
      ],
      rows,
    };
  }
  if (command === 'aggregate/tumor-gene-dossier') {
    const rows = successes
      .map(flattenTumorGeneDossierRecord)
      .filter((row): row is Record<string, unknown> => Boolean(row));
    if (rows.length === 0) return null;
    return {
      headers: [
        'input',
        'query',
        'symbol',
        'name',
        'organism',
        'studyId',
        'alterationStatus',
        'alteredSamples',
        'totalSamples',
        'mutationEvents',
        'mutationFrequencyPct',
        'topFinding',
        'coMutationCount',
        'topCoMutationGene',
        'topCoMutationRatePct',
        'topCoMutationContextTag',
        'exemplarVariantCount',
        'topVariantProteinChange',
        'topVariantMutationType',
        'recommendedNextStepType',
        'literatureCount',
        'completeness',
        'warningsCount',
        'sources',
        'ncbiGeneId',
        'uniprotAccession',
        'cbioportalStudyId',
        'queriedAt',
      ],
      rows,
    };
  }
  return null;
}
