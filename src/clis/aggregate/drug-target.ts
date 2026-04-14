/**
 * aggregate/drug-target — target-centric drugability and clinical candidate summary.
 *
 * Builds a compact drug-target view from Open Targets:
 *   - target identity and tractability features
 *   - associated diseases
 *   - known drugs / clinical candidates with disease context
 *   - clinical evidence source summary
 */

import { cli, Strategy } from '../../registry.js';
import { CliError, EmptyResultError } from '../../errors.js';
import { parseBatchInput } from '../../batch.js';
import { wrapResult, type BiocliCompleteness } from '../../types.js';
import { createHttpContextForDatabase } from '../../databases/index.js';
import { reportProgress } from '../../progress.js';
import { fetchStudy, type CbioPortalStudy } from '../../databases/cbioportal.js';
import {
  fetchDrugsByIds,
  fetchTargetDrugSnapshot,
  resolveTarget,
  type OpenTargetsClinicalDiseaseRow,
  type OpenTargetsClinicalReport,
  type OpenTargetsClinicalTargetRow,
  type OpenTargetsDrugDetail,
  type OpenTargetsTractabilityRow,
} from '../../databases/opentargets.js';
import { clampLimit } from '../cbioportal/common.js';
import { buildTumorSummary, type TumorBuildResult, type TumorSummary } from './tumor-gene-dossier.js';
import {
  findGdscDrugEntriesByName,
  gdscPaths,
  getGdscDownloadMeta,
  loadGdscSensitivityIndex,
  refreshGdscDataset,
  type GdscDrugEntry,
  type GdscSensitivityHit,
  type GdscSensitivityIndex,
} from '../../datasets/gdsc.js';
import { runAggregateBatch, type AggregateBatchOptions, type AggregateBatchPreparation } from './batch-runtime.js';

const STAGE_ORDER: Record<string, number> = {
  APPROVAL: 60,
  PHASE_4: 50,
  PHASE_3: 40,
  PHASE_2: 30,
  PHASE_1_2: 25,
  PHASE_1: 20,
  EARLY_PHASE_1: 15,
  PHASE_0: 10,
  PRECLINICAL: 5,
  UNKNOWN: 0,
};

const MODALITY_LABELS: Record<string, string> = {
  AB: 'antibody',
  OC: 'other modality',
  PR: 'PROTAC / degrader',
  SM: 'small molecule',
};

interface DrugTargetDiseaseContext {
  id?: string;
  name: string;
  sourceName?: string;
}

interface DrugTargetEvidenceSourceCount {
  source: string;
  count: number;
}

interface DrugTargetClinicalEvidence {
  id: string;
  source: string;
  clinicalStage: string;
  clinicalStageLabel: string;
  trialPhase?: string;
  year?: number;
  title?: string;
  url?: string;
}

interface DrugTargetSensitivityHit extends GdscSensitivityHit {
  gdscDrugId: string;
  gdscDrugName: string;
}

interface DrugTargetSensitivityDataset {
  dataset: 'GDSC1' | 'GDSC2';
  matchedTissues: string[];
  matchedMeasurementCount: number;
  bestZScore?: number;
  topSensitiveHits: DrugTargetSensitivityHit[];
}

interface DrugTargetSensitivity {
  source: 'GDSC';
  release?: string;
  matchedDrugIds: string[];
  matchedDrugNames: string[];
  matchedTissues: string[];
  matchedMeasurementCount: number;
  datasets: DrugTargetSensitivityDataset[];
  strongestHits: DrugTargetSensitivityHit[];
  signals: string[];
}

interface DrugTargetRanking {
  score: number;
  matchedDiseaseTerms: string[];
  matchedGeneTerms: string[];
  matchedStudyTerms: string[];
  signals: string[];
}

interface DrugTargetCandidate {
  chemblId: string;
  drugName: string;
  maxClinicalStage: string;
  maxClinicalStageLabel: string;
  drugType: string;
  actionTypes: string[];
  description: string;
  approvedIndications: string[];
  diseaseContexts: DrugTargetDiseaseContext[];
  evidenceSourceCounts: DrugTargetEvidenceSourceCount[];
  clinicalReports: DrugTargetClinicalEvidence[];
  ranking: DrugTargetRanking;
  sensitivity?: DrugTargetSensitivity;
}

interface DrugTargetAgentSummaryCandidate {
  drugName: string;
  chemblId: string;
  maxClinicalStage: string;
  maxClinicalStageLabel: string;
  score: number;
  reasons: string[];
}

interface DrugTargetAgentSummarySignal {
  drugName: string;
  dataset: 'GDSC1' | 'GDSC2';
  tissue: string;
  cellLineName: string;
  zScore: number;
}

interface DrugTargetAgentSummaryTumorContext {
  studyId: string;
  mutationFrequencyPct: number;
  alteredSamples: number;
  totalSamples: number;
  topCoMutations: string[];
}

interface DrugTargetRecommendedNextStep {
  type: string;
  command?: string;
  focus?: string;
  rationale: string;
}

interface DrugTargetAgentSummary {
  topFinding: string;
  topCandidates: DrugTargetAgentSummaryCandidate[];
  matchedDisease: string | null;
  tumorContext: DrugTargetAgentSummaryTumorContext | null;
  topSensitivitySignals: DrugTargetAgentSummarySignal[];
  warnings: string[];
  completeness: BiocliCompleteness;
  recommendedNextStep: DrugTargetRecommendedNextStep;
}

interface DrugTargetData {
  target: {
    input: string;
    symbol: string;
    name: string;
    ensemblId: string;
    biotype?: string;
  };
  summary: {
    rankingMode: 'global' | 'disease-aware' | 'study-aware';
    diseaseFilter?: string;
    totalCandidates: number;
    matchedCandidates: number;
    returnedCandidates: number;
    approvedDrugs: number;
    clinicalCandidates: number;
    sensitivitySupportedCandidates: number;
  };
  tractability: {
    positiveFeatureCount: number;
    enabledModalities: Array<{
      modality: string;
      modalityLabel: string;
      features: string[];
    }>;
  };
  agentSummary: DrugTargetAgentSummary;
  associatedDiseases: Array<{
    id: string;
    name: string;
    score: number;
  }>;
  candidates: DrugTargetCandidate[];
  tumorStudy?: TumorSummary;
}

interface MutableCandidate {
  chemblId: string;
  drugName: string;
  maxClinicalStage: string;
  drugType: string;
  diseaseContexts: DrugTargetDiseaseContext[];
  clinicalReports: DrugTargetClinicalEvidence[];
}

interface CandidateRankingComputation {
  score: number;
  matchedDiseaseTerms: string[];
  matchedGeneTerms: string[];
  matchedStudyTerms: string[];
  signals: string[];
}

interface CandidateSensitivityComputation {
  summary: DrugTargetSensitivity;
  rankingScore: number;
  rankingSignals: string[];
}

interface DrugTargetCommandArgs {
  gene?: unknown;
  disease?: unknown;
  study?: unknown;
  profile?: unknown;
  'sample-list'?: unknown;
  'co-mutations'?: unknown;
  variants?: unknown;
  'min-co-samples'?: unknown;
  'page-size'?: unknown;
  limit?: unknown;
  diseaseLimit?: unknown;
  reportLimit?: unknown;
  __batch?: AggregateBatchOptions;
}

function buildDrugTargetBatchCacheArgs(
  item: string,
  args: DrugTargetCommandArgs,
): Record<string, unknown> {
  return {
    gene: item,
    disease: args.disease ?? '',
    study: args.study ?? '',
    profile: args.profile ?? '',
    sampleList: args['sample-list'] ?? '',
    coMutations: args['co-mutations'] ?? 5,
    variants: args.variants ?? 3,
    minCoSamples: args['min-co-samples'] ?? 1,
    pageSize: args['page-size'] ?? 500,
    limit: args.limit ?? 8,
    diseaseLimit: args.diseaseLimit ?? 5,
    reportLimit: args.reportLimit ?? 3,
  };
}

async function prepareDrugTargetBatchRun(
  batch: AggregateBatchOptions,
): Promise<AggregateBatchPreparation | void> {
  const gdscCtx = createHttpContextForDatabase('gdsc');
  try {
    if (batch.forceRefresh) {
      reportProgress('Refreshing GDSC snapshot before batch run…');
      await refreshGdscDataset(gdscCtx, { force: true });
    } else {
      reportProgress('Preloading GDSC snapshot before batch run…');
    }
    await loadGdscSensitivityIndex(gdscCtx);
  } catch (error) {
    reportProgress(`GDSC preload unavailable; continuing without upfront refresh: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const meta = getGdscDownloadMeta();
  if (!meta) return;

  return {
    snapshots: [{
      dataset: 'GDSC',
      source: 'local-dataset',
      path: gdscPaths().dir,
      release: meta.release,
      fetchedAt: meta.fetchedAt,
      staleAfterDays: meta.staleAfterDays,
      refreshed: batch.forceRefresh === true,
    }],
  };
}

interface PhraseMatch {
  term: string;
  score: number;
}

const GENERIC_STUDY_TERMS = new Set([
  'cancer',
  'carcinoma',
  'adenocarcinoma',
  'neoplasm',
  'solid tumor',
  'solid tumors',
  'tumor',
  'tumors',
]);

function normalizeTerm(value: string): string {
  return value.trim().toLowerCase();
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._:/=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildDrugTargetCommandSnippet(
  gene: string,
  diseaseFilter: string,
  studyId: string,
): string {
  const parts = ['biocli', 'aggregate', 'drug-target', shellQuote(gene)];
  if (diseaseFilter) {
    parts.push('--disease', shellQuote(diseaseFilter));
  }
  if (studyId) {
    parts.push('--study', shellQuote(studyId));
  }
  parts.push('-f', 'json');
  return parts.join(' ');
}

function deriveAgentCompleteness(warnings: string[]): BiocliCompleteness {
  return warnings.length === 0 ? 'complete' : 'partial';
}

function buildDrugTargetTumorContext(
  tumorSummary: TumorSummary | undefined,
): DrugTargetAgentSummaryTumorContext | null {
  if (!tumorSummary) return null;
  return {
    studyId: tumorSummary.studyId,
    mutationFrequencyPct: tumorSummary.mutationFrequencyPct,
    alteredSamples: tumorSummary.alteredSamples,
    totalSamples: tumorSummary.totalSamples,
    topCoMutations: tumorSummary.coMutations.slice(0, 3).map(item => item.partnerGene),
  };
}

function buildDrugTargetTopSensitivitySignals(
  candidates: DrugTargetCandidate[],
): DrugTargetAgentSummarySignal[] {
  const signals: DrugTargetAgentSummarySignal[] = [];
  for (const candidate of candidates) {
    for (const hit of candidate.sensitivity?.strongestHits ?? []) {
      const zScore = hit.zScore;
      if (zScore == null || !Number.isFinite(zScore)) continue;
      signals.push({
        drugName: candidate.drugName,
        dataset: hit.dataset,
        tissue: hit.tissue,
        cellLineName: hit.cellLineName,
        zScore,
      });
    }
  }
  return signals
    .sort((a, b) =>
      a.zScore - b.zScore
      || a.drugName.localeCompare(b.drugName)
      || a.dataset.localeCompare(b.dataset))
    .slice(0, 3);
}

function buildDrugTargetRecommendedNextStep(
  gene: string,
  diseaseFilter: string,
  studyId: string,
  topCandidates: DrugTargetAgentSummaryCandidate[],
  matchedDisease: string | null,
  tumorContext: DrugTargetAgentSummaryTumorContext | null,
): DrugTargetRecommendedNextStep {
  if (topCandidates.length === 0 && diseaseFilter) {
    return {
      type: 'broaden-disease-filter',
      command: buildDrugTargetCommandSnippet(gene, '', studyId),
      focus: 'Rerun without the disease filter and inspect the global candidate set.',
      rationale: `No candidates matched the current disease filter "${diseaseFilter}".`,
    };
  }

  if (topCandidates.length === 0) {
    return {
      type: 'review-target-context',
      command: buildDrugTargetCommandSnippet(gene, diseaseFilter, studyId),
      focus: 'Inspect tractability and disease associations to decide whether another gene or disease context is more promising.',
      rationale: `No drug candidates were retained for ${gene}.`,
    };
  }

  const lead = topCandidates[0];
  return {
    type: studyId ? 'inspect-tumor-prioritized-candidate' : 'inspect-candidate',
    command: buildDrugTargetCommandSnippet(gene, diseaseFilter, studyId),
    focus: tumorContext
      ? `Review ${lead.drugName} together with ${tumorContext.studyId} cohort prevalence and co-mutation context.`
      : `Review ${lead.drugName} and its supporting evidence${matchedDisease ? ` for ${matchedDisease}` : ''}.`,
    rationale: tumorContext
      ? `The top candidate is ranked with study-aware evidence and the selected cohort shows ${tumorContext.mutationFrequencyPct}% alteration prevalence.`
      : `The top candidate has the strongest combined ranking signal${matchedDisease ? ` for ${matchedDisease}` : ''}.`,
  };
}

function buildDrugTargetTopFinding(
  symbol: string,
  matchedDisease: string | null,
  topCandidates: DrugTargetAgentSummaryCandidate[],
  tumorContext: DrugTargetAgentSummaryTumorContext | null,
): string {
  const lead = topCandidates[0];
  if (!lead && matchedDisease) {
    return `No drug candidates were retained for ${symbol} after applying the ${matchedDisease} disease filter.`;
  }
  if (!lead) {
    return `No drug or clinical candidates were returned for ${symbol}.`;
  }
  if (tumorContext && matchedDisease) {
    return `${symbol} has ${lead.maxClinicalStageLabel.toLowerCase()} support for ${matchedDisease}, led by ${lead.drugName}; the selected cohort shows ${tumorContext.mutationFrequencyPct}% alteration prevalence.`;
  }
  if (matchedDisease) {
    return `${symbol} has ${lead.maxClinicalStageLabel.toLowerCase()} candidates aligned with ${matchedDisease}, led by ${lead.drugName}.`;
  }
  return `${symbol} has ${lead.maxClinicalStageLabel.toLowerCase()} target-support candidates, led by ${lead.drugName}.`;
}

function buildDrugTargetAgentSummary(args: {
  gene: string;
  symbol: string;
  diseaseFilter: string;
  studyId: string;
  associatedDiseases: Array<{ id: string; name: string; score: number }>;
  returnedCandidates: DrugTargetCandidate[];
  tumorSummary?: TumorSummary;
  warnings: string[];
}): DrugTargetAgentSummary {
  const matchedDisease = args.diseaseFilter || args.associatedDiseases[0]?.name || null;
  const topCandidates = args.returnedCandidates.slice(0, 3).map(candidate => ({
    drugName: candidate.drugName,
    chemblId: candidate.chemblId,
    maxClinicalStage: candidate.maxClinicalStage,
    maxClinicalStageLabel: candidate.maxClinicalStageLabel,
    score: candidate.ranking.score,
    reasons: candidate.ranking.signals.slice(0, 3),
  }));
  const tumorContext = buildDrugTargetTumorContext(args.tumorSummary);
  const topSensitivitySignals = buildDrugTargetTopSensitivitySignals(args.returnedCandidates);
  return {
    topFinding: buildDrugTargetTopFinding(args.symbol, matchedDisease, topCandidates, tumorContext),
    topCandidates,
    matchedDisease,
    tumorContext,
    topSensitivitySignals,
    warnings: [...args.warnings],
    completeness: deriveAgentCompleteness(args.warnings),
    recommendedNextStep: buildDrugTargetRecommendedNextStep(
      args.gene,
      args.diseaseFilter,
      args.studyId,
      topCandidates,
      matchedDisease,
      tumorContext,
    ),
  };
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizePhrase(value)
    .split(' ')
    .filter(Boolean);
}

function stageRank(stage: string | null | undefined): number {
  const normalized = String(stage ?? '').trim().toUpperCase();
  return STAGE_ORDER[normalized] ?? 0;
}

function bestStage(a: string | null | undefined, b: string | null | undefined): string {
  return stageRank(a) >= stageRank(b) ? String(a ?? '').trim() : String(b ?? '').trim();
}

function formatStageLabel(stage: string | null | undefined): string {
  const normalized = String(stage ?? '').trim();
  if (!normalized) return 'Unknown';
  return normalized
    .toLowerCase()
    .split('_')
    .map(part => part ? part[0]!.toUpperCase() + part.slice(1) : part)
    .join(' ');
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function uniqueNormalizedTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const normalized = normalizePhrase(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms;
}

function mapDiseaseContexts(rows: OpenTargetsClinicalDiseaseRow[]): DrugTargetDiseaseContext[] {
  const contexts: DrugTargetDiseaseContext[] = [];
  for (const row of rows) {
    if (row.disease?.name) {
      contexts.push({
        id: row.disease.id,
        name: row.disease.name,
        sourceName: row.diseaseFromSource || undefined,
      });
      continue;
    }

    const sourceName = String(row.diseaseFromSource ?? '').trim();
    if (!sourceName) continue;
    contexts.push({ name: sourceName, sourceName });
  }

  return uniqueByKey(contexts, context =>
    `${context.id ?? ''}::${context.name.toLowerCase()}::${context.sourceName?.toLowerCase() ?? ''}`);
}

function diseaseMatchesFilter(contexts: DrugTargetDiseaseContext[], diseaseFilter: string): boolean {
  const normalized = normalizeTerm(diseaseFilter);
  if (!normalized) return true;
  return contexts.some(context =>
    context.name.toLowerCase().includes(normalized)
    || (context.sourceName?.toLowerCase().includes(normalized) ?? false));
}

function selectDiseaseContexts(
  contexts: DrugTargetDiseaseContext[],
  diseaseFilter: string,
  limit: number,
): DrugTargetDiseaseContext[] {
  const normalizedFilter = normalizeTerm(diseaseFilter);
  const matched = diseaseFilter
    ? contexts.filter(context =>
        context.name.toLowerCase().includes(normalizedFilter)
        || (context.sourceName?.toLowerCase().includes(normalizedFilter) ?? false))
    : contexts;
  const selected = matched.length > 0 ? matched : contexts;
  return [...selected]
    .sort((a, b) =>
      diseaseContextRank(b, normalizedFilter) - diseaseContextRank(a, normalizedFilter)
      || a.name.localeCompare(b.name)
      || (a.sourceName ?? '').localeCompare(b.sourceName ?? ''))
    .slice(0, limit);
}

function diseaseContextRank(context: DrugTargetDiseaseContext, normalizedFilter: string): number {
  const name = context.name.toLowerCase();
  const sourceName = (context.sourceName ?? '').toLowerCase();
  if (!normalizedFilter) return context.id ? 1 : 0;
  if (name.includes(normalizedFilter)) return context.id ? 4 : 3;
  if (sourceName.includes(normalizedFilter)) return context.id ? 2 : 1;
  return 0;
}

function phraseMatchScore(text: string, term: string): number {
  const normalizedText = normalizePhrase(text);
  const normalizedTerm = normalizePhrase(term);
  if (!normalizedText || !normalizedTerm) return 0;
  if (normalizedText === normalizedTerm) return 12;
  const termTokens = tokenize(normalizedTerm);
  const textTokens = tokenize(normalizedText);
  if (termTokens.length === 0) return 0;
  const textTokenSet = new Set(textTokens);

  const containsTokenSequence = (haystack: string[], needle: string[]): boolean => {
    if (needle.length === 0 || haystack.length < needle.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      let matches = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  };

  if (containsTokenSequence(textTokens, termTokens)) return termTokens.length >= 2 ? 10 : termTokens[0]!.length >= 4 ? 7 : 0;
  if (containsTokenSequence(termTokens, textTokens)) return textTokens.length >= 2 ? 8 : textTokens[0]!.length >= 4 ? 5 : 0;

  const overlap = termTokens.filter(token => textTokenSet.has(token)).length;
  if (overlap >= Math.min(2, termTokens.length)) {
    return termTokens.length >= 2 ? 7 : 4;
  }
  if (overlap === 1 && termTokens.length === 1 && normalizedTerm.length >= 4) return 3;
  return 0;
}

function bestPhraseMatches(
  contexts: DrugTargetDiseaseContext[],
  terms: string[],
): PhraseMatch[] {
  if (terms.length === 0 || contexts.length === 0) return [];

  const matches = new Map<string, number>();
  for (const context of contexts) {
    const candidates = [context.name, context.sourceName ?? ''].filter(Boolean);
    for (const term of terms) {
      let best = 0;
      for (const candidate of candidates) {
        best = Math.max(best, phraseMatchScore(candidate, term));
      }
      if (best === 0) continue;
      matches.set(term, Math.max(matches.get(term) ?? 0, best));
    }
  }

  return [...matches.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term, score]) => ({ term, score }));
}

function bestPhraseMatchesFromStrings(values: string[], terms: string[]): PhraseMatch[] {
  return bestPhraseMatches(
    values
      .filter(Boolean)
      .map(value => ({ name: value, sourceName: value })),
    terms,
  );
}

function compareSensitivityHit(a: DrugTargetSensitivityHit, b: DrugTargetSensitivityHit): number {
  const aZ = Number.isFinite(a.zScore) ? Number(a.zScore) : Number.POSITIVE_INFINITY;
  const bZ = Number.isFinite(b.zScore) ? Number(b.zScore) : Number.POSITIVE_INFINITY;
  if (aZ !== bZ) return aZ - bZ;

  const aAuc = Number.isFinite(a.auc) ? Number(a.auc) : Number.POSITIVE_INFINITY;
  const bAuc = Number.isFinite(b.auc) ? Number(b.auc) : Number.POSITIVE_INFINITY;
  if (aAuc !== bAuc) return aAuc - bAuc;

  return a.cellLineName.localeCompare(b.cellLineName);
}

function buildCandidateSensitivity(
  drugName: string,
  gdscIndex: GdscSensitivityIndex | null,
  tissueTerms: string[],
): CandidateSensitivityComputation | null {
  if (!gdscIndex) return null;
  const entries = findGdscDrugEntriesByName(gdscIndex, drugName);
  if (entries.length === 0) return null;

  const matchedDrugIds = new Set<string>();
  const matchedDrugNames = new Set<string>();
  const matchedTissues = new Set<string>();
  const datasetSummaries: DrugTargetSensitivityDataset[] = [];
  const strongestHits: DrugTargetSensitivityHit[] = [];

  const includeAllTissues = tissueTerms.length === 0;
  for (const entry of entries) {
    matchedDrugIds.add(entry.compound.drugId);
    matchedDrugNames.add(entry.compound.drugName);

    for (const dataset of entry.datasets) {
      const tissueCandidates = dataset.tissues.map(tissue => ({
        tissue,
        score: bestPhraseMatchesFromStrings([tissue.tissue], tissueTerms)[0]?.score ?? 0,
      }));

      const selectedTissues = includeAllTissues
        ? tissueCandidates.slice(0, 3)
        : tissueCandidates
            .filter(item => item.score > 0)
            .sort((a, b) =>
              b.score - a.score
              || b.tissue.rowCount - a.tissue.rowCount
              || a.tissue.tissue.localeCompare(b.tissue.tissue));

      if (!includeAllTissues && selectedTissues.length === 0) continue;

      const datasetWideHits = includeAllTissues
        ? [
            ...dataset.topHits,
            ...dataset.tissues.flatMap(tissue => tissue.topHits),
          ]
        : selectedTissues.flatMap(item => item.tissue.topHits);

      const topSensitiveHits = uniqueByKey(
        datasetWideHits
          .map(hit => ({
            ...hit,
            gdscDrugId: entry.compound.drugId,
            gdscDrugName: entry.compound.drugName,
          })),
        hit => `${hit.dataset}::${hit.gdscDrugId}::${hit.cellLineName}::${hit.sangerModelId ?? ''}::${hit.tissue}`,
      )
        .sort(compareSensitivityHit)
        .slice(0, 3);

      if (topSensitiveHits.length === 0) continue;

      const matchedMeasurementCount = includeAllTissues
        ? dataset.rowCount
        : selectedTissues.reduce((sum, item) => sum + item.tissue.rowCount, 0);

      const matchedTissueNames = includeAllTissues
        ? uniqueByKey(topSensitiveHits.map(hit => hit.tissue), value => value)
        : selectedTissues.map(item => item.tissue.tissue);

      for (const tissue of matchedTissueNames) matchedTissues.add(tissue);
      strongestHits.push(...topSensitiveHits);

      datasetSummaries.push({
        dataset: dataset.dataset,
        matchedTissues: matchedTissueNames,
        matchedMeasurementCount,
        bestZScore: topSensitiveHits[0]?.zScore ?? dataset.bestZScore,
        topSensitiveHits,
      });
    }
  }

  if (datasetSummaries.length === 0) return null;

  const strongest = uniqueByKey(
    strongestHits,
    hit => `${hit.dataset}::${hit.gdscDrugId}::${hit.cellLineName}::${hit.sangerModelId ?? ''}::${hit.tissue}`,
  )
    .sort(compareSensitivityHit)
    .slice(0, 5);

  const matchedMeasurementCount = datasetSummaries.reduce((sum, dataset) => sum + dataset.matchedMeasurementCount, 0);
  const uniqueDatasets = uniqueByKey(datasetSummaries.map(dataset => dataset.dataset), value => value);
  const bestZScore = strongest[0]?.zScore;
  const rankingScore = Number((
    (bestZScore !== undefined ? Math.min(Math.max(-bestZScore, 0), 4) : 0)
    + Math.min(uniqueDatasets.length, 2) * 0.8
    + Math.min(matchedMeasurementCount, 10) * 0.1
    + (matchedTissues.size > 0 ? 1.5 : includeAllTissues ? 0.5 : 0)
  ).toFixed(2));

  const signals = [
    `GDSC support: ${matchedMeasurementCount} measurements across ${uniqueDatasets.length} dataset${uniqueDatasets.length === 1 ? '' : 's'}`,
  ];
  if (matchedTissues.size > 0) {
    signals.push(`GDSC matched tissues: ${[...matchedTissues].slice(0, 3).join(', ')}`);
  }
  if (strongest[0]?.zScore !== undefined) {
    signals.push(`GDSC best z-score: ${Number(strongest[0].zScore).toFixed(2)} in ${strongest[0].cellLineName}`);
  }

  return {
    summary: {
      source: 'GDSC',
      release: gdscIndex.meta.release,
      matchedDrugIds: [...matchedDrugIds].sort(),
      matchedDrugNames: [...matchedDrugNames].sort(),
      matchedTissues: [...matchedTissues].sort(),
      matchedMeasurementCount,
      datasets: datasetSummaries.sort((a, b) => a.dataset.localeCompare(b.dataset)),
      strongestHits: strongest,
      signals,
    },
    rankingScore,
    rankingSignals: signals,
  };
}

function isGenericStudyTerm(term: string): boolean {
  return GENERIC_STUDY_TERMS.has(normalizePhrase(term));
}

function buildStudyContextTerms(
  study: CbioPortalStudy | null,
  associatedDiseases: Array<{ id: string; name: string; score: number }>,
): string[] {
  const baseTerms = uniqueNormalizedTerms([
    study?.cancerType?.name ?? '',
    study?.name?.replace(/\s*\([^)]*\)\s*/g, ' ') ?? '',
    study?.cancerType?.shortName ?? '',
    study?.cancerType?.parent ?? '',
  ])
    .filter(term => term.length >= 4 || /^[a-z0-9]{3,6}$/.test(term))
    .filter(term => !isGenericStudyTerm(term));

  const baseTokens = new Set(baseTerms.flatMap(term => tokenize(term)));
  const associatedTerms = associatedDiseases
    .slice(0, 3)
    .map(item => normalizePhrase(item.name))
    .filter(term => term && !isGenericStudyTerm(term))
    .filter((term) => {
      if (baseTerms.length === 0) return true;
      const tokens = tokenize(term);
      return tokens.some(token => baseTokens.has(token));
    });

  return uniqueNormalizedTerms([...baseTerms, ...associatedTerms]);
}

function computeCandidateRanking(
  candidate: {
    maxClinicalStage: string;
    diseaseContexts: DrugTargetDiseaseContext[];
    clinicalReports: DrugTargetClinicalEvidence[];
    evidenceSourceCounts: DrugTargetEvidenceSourceCount[];
    sensitivity?: CandidateSensitivityComputation | null;
  },
  diseaseFilter: string,
  studyTerms: string[],
  geneTerms: string[],
): CandidateRankingComputation {
  const diseaseTerms = diseaseFilter ? uniqueNormalizedTerms([diseaseFilter]) : [];
  const matchedDiseaseTerms = bestPhraseMatches(candidate.diseaseContexts, diseaseTerms);
  const matchedStudyTerms = bestPhraseMatches(candidate.diseaseContexts, studyTerms);
  const matchedGeneTerms = bestPhraseMatchesFromStrings(
    candidate.clinicalReports.map(report => report.title ?? ''),
    geneTerms,
  );

  const stageComponent = stageRank(candidate.maxClinicalStage) / 10;
  const diseaseComponent = (matchedDiseaseTerms[0]?.score ?? 0) * 1.5;
  const studyComponent = (matchedStudyTerms[0]?.score ?? 0) * 1.2;
  const geneComponent = (matchedGeneTerms[0]?.score ?? 0) * 0.9;
  const reportComponent = Math.min(candidate.clinicalReports.length, 3);
  const sourceComponent = Math.min(candidate.evidenceSourceCounts.length, 2) * 0.5;
  const sensitivityComponent = candidate.sensitivity?.rankingScore ?? 0;
  const score = Number((stageComponent + diseaseComponent + studyComponent + geneComponent + reportComponent + sourceComponent + sensitivityComponent).toFixed(2));

  const signals = [`clinical stage: ${formatStageLabel(candidate.maxClinicalStage)}`];
  if (matchedDiseaseTerms.length > 0) {
    signals.push(`matched disease filter: ${matchedDiseaseTerms.slice(0, 2).map(item => item.term).join(', ')}`);
  }
  if (matchedGeneTerms.length > 0) {
    signals.push(`matched gene context: ${matchedGeneTerms.slice(0, 2).map(item => item.term).join(', ')}`);
  }
  if (matchedStudyTerms.length > 0) {
    signals.push(`matched study context: ${matchedStudyTerms.slice(0, 2).map(item => item.term).join(', ')}`);
  }
  if (candidate.clinicalReports.length > 0) {
    signals.push(`clinical evidence links: ${candidate.clinicalReports.length}`);
  }
  if (candidate.sensitivity?.rankingSignals.length) {
    signals.push(...candidate.sensitivity.rankingSignals);
  }

  return {
    score,
    matchedDiseaseTerms: matchedDiseaseTerms.slice(0, 3).map(item => item.term),
    matchedGeneTerms: matchedGeneTerms.slice(0, 3).map(item => item.term),
    matchedStudyTerms: matchedStudyTerms.slice(0, 3).map(item => item.term),
    signals,
  };
}

function summarizeEvidenceSources(reports: DrugTargetClinicalEvidence[]): DrugTargetEvidenceSourceCount[] {
  const counts = new Map<string, number>();
  for (const report of reports) {
    counts.set(report.source, (counts.get(report.source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, count]) => ({ source, count }));
}

function summarizeTractability(rows: OpenTargetsTractabilityRow[]) {
  const positive = rows.filter(row => row.value);
  const grouped = new Map<string, string[]>();
  for (const row of positive) {
    const list = grouped.get(row.modality) ?? [];
    list.push(row.label);
    grouped.set(row.modality, list);
  }

  return {
    positiveFeatureCount: positive.length,
    enabledModalities: [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([modality, features]) => ({
        modality,
        modalityLabel: MODALITY_LABELS[modality] ?? modality.toLowerCase(),
        features: uniqueByKey(features, value => value),
      })),
  };
}

function buildClinicalEvidence(
  reports: OpenTargetsClinicalReport[],
  reportLimit: number,
): DrugTargetClinicalEvidence[] {
  return uniqueByKey(
    reports.map(report => ({
      id: report.id,
      source: report.source,
      clinicalStage: report.clinicalStage,
      clinicalStageLabel: formatStageLabel(report.clinicalStage),
      trialPhase: report.trialPhase ?? undefined,
      year: report.year ?? undefined,
      title: report.title ?? undefined,
      url: report.url ?? undefined,
    })),
    report => report.id,
  )
    .sort((a, b) =>
      stageRank(b.clinicalStage) - stageRank(a.clinicalStage)
      || (b.year ?? 0) - (a.year ?? 0)
      || a.source.localeCompare(b.source)
      || a.id.localeCompare(b.id))
    .slice(0, reportLimit);
}

function aggregateCandidates(
  rows: OpenTargetsClinicalTargetRow[],
  drugDetails: OpenTargetsDrugDetail[],
  diseaseFilter: string,
  studyTerms: string[],
  geneTerms: string[],
  tissueTerms: string[],
  gdscIndex: GdscSensitivityIndex | null,
  limit: number,
  diseaseContextLimit: number,
  reportLimit: number,
): {
  totalCandidates: number;
  matchedCandidateCount: number;
  approvedCandidateCount: number;
  clinicalCandidateCount: number;
  sensitivitySupportedCandidateCount: number;
  returnedCandidates: DrugTargetCandidate[];
} {
  const byDrug = new Map<string, MutableCandidate>();

  for (const row of rows) {
    const drug = row.drug;
    if (!drug?.id || !drug.name) continue;

    const existing = byDrug.get(drug.id);
    const nextDiseases = mapDiseaseContexts(row.diseases);
    const nextReports = buildClinicalEvidence(row.clinicalReports, Math.max(reportLimit * 3, reportLimit));

    if (existing) {
      existing.maxClinicalStage = bestStage(existing.maxClinicalStage, row.maxClinicalStage);
      existing.diseaseContexts.push(...nextDiseases);
      existing.clinicalReports.push(...nextReports);
      continue;
    }

    byDrug.set(drug.id, {
      chemblId: drug.id,
      drugName: drug.name,
      maxClinicalStage: bestStage(row.maxClinicalStage, drug.maximumClinicalStage),
      drugType: drug.drugType,
      diseaseContexts: nextDiseases,
      clinicalReports: nextReports,
    });
  }

  const detailMap = new Map(drugDetails.map(detail => [detail.id, detail] as const));
  const allCandidates = [...byDrug.values()].map((candidate) => {
    const detail = detailMap.get(candidate.chemblId);
    const allDiseaseContexts = uniqueByKey(candidate.diseaseContexts, context =>
      `${context.id ?? ''}::${context.name.toLowerCase()}::${context.sourceName?.toLowerCase() ?? ''}`);
    const reports = buildClinicalEvidence(candidate.clinicalReports, reportLimit);
    const maxClinicalStage = bestStage(candidate.maxClinicalStage, detail?.maximumClinicalStage);
    const diseaseContexts = selectDiseaseContexts(allDiseaseContexts, diseaseFilter, diseaseContextLimit);
    const sensitivity = buildCandidateSensitivity(
      detail?.name ?? candidate.drugName,
      gdscIndex,
      tissueTerms,
    );
    const ranking = computeCandidateRanking({
      maxClinicalStage,
      diseaseContexts: allDiseaseContexts,
      clinicalReports: reports,
      evidenceSourceCounts: summarizeEvidenceSources(reports),
      sensitivity,
    }, diseaseFilter, studyTerms, geneTerms);
    const evidenceSourceCounts = summarizeEvidenceSources(reports);
    return {
      chemblId: candidate.chemblId,
      drugName: detail?.name ?? candidate.drugName,
      maxClinicalStage,
      maxClinicalStageLabel: formatStageLabel(maxClinicalStage),
      drugType: detail?.drugType ?? candidate.drugType,
      actionTypes: uniqueByKey(detail?.mechanismsOfAction?.uniqueActionTypes ?? [], value => value),
      description: detail?.description ?? '',
      approvedIndications: (detail?.indications?.rows ?? []).map(r => r.disease.name),
      diseaseContexts,
      evidenceSourceCounts,
      clinicalReports: reports,
      ranking,
      ...(sensitivity ? { sensitivity: sensitivity.summary } : {}),
    };
  });

  const matched = allCandidates
    .filter(candidate => !diseaseFilter || diseaseMatchesFilter(candidate.diseaseContexts, diseaseFilter))
    .sort((a, b) =>
      b.ranking.score - a.ranking.score
      || stageRank(b.maxClinicalStage) - stageRank(a.maxClinicalStage)
      || b.diseaseContexts.length - a.diseaseContexts.length
      || b.clinicalReports.length - a.clinicalReports.length
      || a.drugName.localeCompare(b.drugName));

  const returned = matched.slice(0, limit);
  return {
    totalCandidates: allCandidates.length,
    matchedCandidateCount: matched.length,
    approvedCandidateCount: matched.filter(candidate => candidate.maxClinicalStage === 'APPROVAL').length,
    clinicalCandidateCount: matched.filter(candidate => stageRank(candidate.maxClinicalStage) >= stageRank('PHASE_1')).length,
    sensitivitySupportedCandidateCount: matched.filter(candidate => candidate.sensitivity).length,
    returnedCandidates: returned,
  };
}

async function buildDrugTargetResult(
  args: DrugTargetCommandArgs,
): Promise<ReturnType<typeof wrapResult<DrugTargetData>>> {
  const gene = String(args.gene ?? '').trim();
  if (!gene) throw new CliError('ARGUMENT', 'Gene symbol or Ensembl gene ID is required');

  const diseaseFilter = String(args.disease ?? '').trim();
  const studyId = String(args.study ?? '').trim();
  const requestedProfileId = String(args.profile ?? '').trim();
  const requestedSampleListId = String(args['sample-list'] ?? '').trim();
  const pageSize = clampLimit(args['page-size'], 500, 500);
  const coMutationLimit = clampLimit(args['co-mutations'], 5, 50);
  const exemplarLimit = clampLimit(args.variants, 3, 20);
  const minCoSamples = clampLimit(args['min-co-samples'], 1, 100000);
  const limit = Math.max(1, Math.min(Number(args.limit ?? 8), 25));
  const diseaseLimit = Math.max(1, Math.min(Number(args.diseaseLimit ?? 5), 10));
  const reportLimit = Math.max(1, Math.min(Number(args.reportLimit ?? 3), 5));

  const opentargetsCtx = createHttpContextForDatabase('opentargets');
  reportProgress('Resolving Open Targets target…');
  const resolved = await resolveTarget(opentargetsCtx, gene);
  if (!resolved) {
    throw new EmptyResultError(
      'aggregate/drug-target',
      `No Open Targets target matched "${gene}". Try a canonical HGNC symbol like EGFR or TP53.`,
    );
  }

  reportProgress('Fetching Open Targets drug snapshot…');
  const snapshot = await fetchTargetDrugSnapshot(opentargetsCtx, resolved.id, 0, diseaseLimit);
  if (!snapshot) {
    throw new EmptyResultError(
      'aggregate/drug-target',
      `Open Targets did not return a target snapshot for "${resolved.id}".`,
    );
  }

  const chemblIds = snapshot.drugAndClinicalCandidates.rows
    .map(row => row.drug?.id ?? '')
    .filter(Boolean);
  reportProgress('Fetching Open Targets drug details…');
  const drugDetails = await fetchDrugsByIds(opentargetsCtx, chemblIds);
  if (studyId) reportProgress('Fetching cBioPortal tumor overlay…');
  const tumorOverlay: TumorBuildResult | null = studyId
    ? await buildTumorSummary(
        resolved.approvedSymbol || gene,
        studyId,
        requestedProfileId,
        requestedSampleListId,
        pageSize,
        coMutationLimit,
        exemplarLimit,
        minCoSamples,
      )
    : null;

  const associatedDiseases = snapshot.associatedDiseases.rows
    .filter(row => row.disease?.id && row.disease?.name)
    .map(row => ({
      id: String(row.disease!.id),
      name: String(row.disease!.name),
      score: Number(row.score ?? 0),
    }));

  const gdscWarnings: string[] = [];
  let gdscIndex: GdscSensitivityIndex | null = null;
  try {
    reportProgress('Loading GDSC sensitivity index…');
    const gdscCtx = createHttpContextForDatabase('gdsc');
    gdscIndex = await loadGdscSensitivityIndex(gdscCtx);
  } catch (error) {
    gdscWarnings.push(`GDSC sensitivity evidence unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const studyMetaWarnings: string[] = [];
  let studyMeta: CbioPortalStudy | null = null;
  if (studyId) {
    const cbioCtx = createHttpContextForDatabase('cbioportal');
    try {
      reportProgress('Fetching cBioPortal study metadata…');
      studyMeta = await fetchStudy(cbioCtx, studyId);
    } catch (error) {
      studyMetaWarnings.push(
        `cBioPortal study metadata: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const studyTerms = studyId
    ? buildStudyContextTerms(studyMeta, associatedDiseases)
    : [];
  const geneTerms = studyId
    ? uniqueNormalizedTerms([
        snapshot.approvedSymbol,
        `${snapshot.approvedSymbol} mutation`,
        `${snapshot.approvedSymbol} mutations`,
        `${snapshot.approvedSymbol} mutant`,
        `${snapshot.approvedSymbol} exon 20`,
        ...(tumorOverlay?.summary.topProteinChanges ?? [])
          .slice(0, 3)
          .map(item => String(item.proteinChange ?? '')),
      ])
    : [];
  const tissueTerms = uniqueNormalizedTerms([
    diseaseFilter,
    ...studyTerms,
  ]);

  reportProgress('Ranking drug candidates…');
  const {
    totalCandidates,
    matchedCandidateCount,
    approvedCandidateCount,
    clinicalCandidateCount,
    sensitivitySupportedCandidateCount,
    returnedCandidates,
  } = aggregateCandidates(
    snapshot.drugAndClinicalCandidates.rows,
    drugDetails,
    diseaseFilter,
    studyTerms,
    geneTerms,
    tissueTerms,
    gdscIndex,
    limit,
    diseaseLimit,
    reportLimit,
  );

  const warnings: string[] = [];
  if (totalCandidates === 0) {
    warnings.push(`Open Targets reported no drug or clinical candidates for ${snapshot.approvedSymbol}.`);
  } else if (diseaseFilter && matchedCandidateCount === 0) {
    warnings.push(`No drug candidates matched disease filter "${diseaseFilter}".`);
  }
  warnings.push(...gdscWarnings);
  warnings.push(...studyMetaWarnings);
  if (tumorOverlay?.warnings.length) {
    warnings.push(...tumorOverlay.warnings);
  }

  const agentSummary = buildDrugTargetAgentSummary({
    gene,
    symbol: snapshot.approvedSymbol,
    diseaseFilter,
    studyId,
    associatedDiseases,
    returnedCandidates,
    tumorSummary: tumorOverlay?.summary,
    warnings,
  });

  const data: DrugTargetData = {
    target: {
      input: gene,
      symbol: snapshot.approvedSymbol,
      name: snapshot.approvedName ?? '',
      ensemblId: snapshot.id,
      biotype: snapshot.biotype ?? undefined,
    },
    summary: {
      rankingMode: studyId ? 'study-aware' : diseaseFilter ? 'disease-aware' : 'global',
      diseaseFilter: diseaseFilter || undefined,
      totalCandidates,
      matchedCandidates: matchedCandidateCount,
      returnedCandidates: returnedCandidates.length,
      approvedDrugs: approvedCandidateCount,
      clinicalCandidates: clinicalCandidateCount,
      sensitivitySupportedCandidates: sensitivitySupportedCandidateCount,
    },
    tractability: summarizeTractability(snapshot.tractability),
    agentSummary,
    associatedDiseases,
    candidates: returnedCandidates,
    ...(tumorOverlay ? { tumorStudy: tumorOverlay.summary } : {}),
  };

  const querySuffix = [
    diseaseFilter ? `[disease=${diseaseFilter}]` : '',
    studyId ? `@ ${studyId}` : '',
  ].filter(Boolean).join(' ');

  return wrapResult(data, {
    ids: {
      ensemblGeneId: snapshot.id,
      ...(tumorOverlay?.ids ?? {}),
    },
    sources: [
      'Open Targets',
      ...(returnedCandidates.some(candidate => candidate.sensitivity) ? ['GDSC'] : []),
      ...(tumorOverlay?.sources ?? []),
    ],
    warnings,
    query: querySuffix ? `${gene} ${querySuffix}` : gene,
    provenance: [
      {
        source: 'Open Targets',
        recordIds: [snapshot.id],
      },
      ...(returnedCandidates.some(candidate => candidate.sensitivity)
        ? [{
            source: 'GDSC',
            url: 'https://www.cancerrxgene.org/downloads/bulk_download',
            databaseRelease: gdscIndex?.meta.release,
            recordIds: uniqueByKey(
              returnedCandidates.flatMap(candidate => candidate.sensitivity?.matchedDrugIds ?? []),
              value => value,
            ),
          }]
        : []),
      ...(tumorOverlay?.provenance ?? []),
    ],
  });
}

cli({
  site: 'aggregate',
  name: 'drug-target',
  description: 'Target tractability and drug candidate summary from Open Targets',
  database: 'aggregate',
  strategy: Strategy.PUBLIC,
  defaultFormat: 'json',
  timeoutSeconds: 180,
  noContext: true,
  args: [
    { name: 'gene', positional: true, required: true, help: 'Gene symbol or Ensembl gene ID (for example EGFR or ENSG00000146648)' },
    { name: 'disease', help: 'Optional disease filter applied to disease contexts (for example lung or glioblastoma)' },
    { name: 'study', help: 'Optional cBioPortal study ID for a tumor-specific overlay (for example luad_tcga_pan_can_atlas_2018)', producedBy: ['cbioportal/studies'] },
    { name: 'profile', help: 'Optional cBioPortal molecular profile ID. Only used with --study.', producedBy: ['cbioportal/profiles'] },
    { name: 'sample-list', help: 'Optional cBioPortal sample list ID. Only used with --study.' },
    { name: 'co-mutations', type: 'int', default: 5, help: 'Number of co-mutated partner genes to include when --study is set' },
    { name: 'variants', type: 'int', default: 3, help: 'Number of exemplar variant groups to include when --study is set' },
    { name: 'min-co-samples', type: 'int', default: 1, help: 'Minimum co-mutated samples required for a partner gene when --study is set' },
    { name: 'page-size', type: 'int', default: 500, help: 'cBioPortal mutation rows fetched per page when --study is set (1-500)' },
    { name: 'limit', type: 'int', default: 8, help: 'Maximum number of drug candidates to return (1-25)' },
    { name: 'diseaseLimit', type: 'int', default: 5, help: 'Number of top associated diseases to surface (1-10)' },
    { name: 'reportLimit', type: 'int', default: 3, help: 'Number of clinical report links to keep per candidate (1-5)' },
  ],
  examples: [
    {
      goal: 'Run a batch target scan for a gene list and keep a resumable run directory',
      command: 'biocli aggregate drug-target --input-file genes.txt --disease lung --outdir runs/drug-target --resume -f json',
    },
    {
      goal: 'Prioritize EGFR drugs for lung cancer with a tumor-study overlay',
      command: 'biocli aggregate drug-target EGFR --disease lung --study luad_tcga_pan_can_atlas_2018 -f json',
    },
  ],
  whenToUse: 'Use when you need target tractability and candidate therapies for a gene list or a single gene, optionally with tumor-study context.',
  columns: ['drugName', 'maxClinicalStage', 'drugType'],
  func: async (_ctx, args) => {
    const batch = (args.__batch ?? {}) as AggregateBatchOptions;
    const parsedBatch = parseBatchInput({
      positionalValue: typeof args.gene === 'string' ? args.gene : undefined,
      inputFile: batch.inputFile,
      inputFormat: batch.inputFormat,
      key: batch.key,
    });
    const genes = parsedBatch ?? [String(args.gene ?? '').trim()].filter(Boolean);
    if (genes.length === 0) {
      throw new CliError('ARGUMENT', 'Gene symbol or Ensembl gene ID is required');
    }

    const explicitBatch = Boolean(
      parsedBatch
      || batch.inputFile
      || batch.outdir
      || batch.resume
      || batch.resumeFrom
      || batch.skipCached
      || batch.forceRefresh,
    );
    if (!explicitBatch && genes.length === 1) {
      return buildDrugTargetResult(args as DrugTargetCommandArgs);
    }

    const batchResult = await runAggregateBatch({
      command: 'aggregate/drug-target',
      items: genes,
      batch,
      progressLabel: 'Batch drug-target',
      cacheArgs: (gene) => buildDrugTargetBatchCacheArgs(gene, args as DrugTargetCommandArgs),
      prepareRun: async ({ batch: batchOpts }) => prepareDrugTargetBatchRun(batchOpts),
      executor: async (gene) => buildDrugTargetResult({
        ...args,
        gene,
      } as DrugTargetCommandArgs),
    });

    return batchResult.results;
  },
});
