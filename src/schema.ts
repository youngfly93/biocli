/**
 * JSON Schema definitions for biocli result types and command outputs.
 *
 * Used by the `biocli schema` command to help agents validate actual
 * `-f json` stdout for a specific command, not just the internal envelope.
 */

import { fullName, getRegistry, type CliCommand } from './registry.js';

type JsonSchema = Record<string, unknown>;

function cloneSchema<T>(schema: T): T {
  return JSON.parse(JSON.stringify(schema)) as T;
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  extra: JsonSchema = {},
): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...extra,
  };
}

function arraySchema(items: JsonSchema, extra: JsonSchema = {}): JsonSchema {
  return {
    type: 'array',
    items,
    ...extra,
  };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: 'null' }] };
}

function stringEnum(values: string[]): JsonSchema {
  return { type: 'string', enum: values };
}

export const biocliResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'BiocliResult',
  description: 'Structured result envelope returned by biocli aggregation commands (gene-profile, gene-dossier, etc.)',
  type: 'object',
  properties: {
    biocliVersion: {
      type: 'string',
      description: 'biocli version that produced this result envelope',
    },
    data: {
      description: 'Primary result payload (structure varies by command)',
    },
    ids: {
      type: 'object',
      description: 'Cross-database identifiers (e.g. geneId, uniprotAccession, ensemblId)',
      additionalProperties: { type: 'string' },
    },
    sources: {
      type: 'array',
      description: 'Database backends that contributed to this result',
      items: { type: 'string' },
    },
    warnings: {
      type: 'array',
      description: 'Non-fatal issues encountered during data retrieval',
      items: { type: 'string' },
    },
    queriedAt: {
      type: 'string',
      format: 'date-time',
      description: 'ISO 8601 timestamp of when the query was executed',
    },
    organism: {
      type: 'string',
      description: 'Scientific name of the organism (if applicable)',
    },
    query: {
      type: 'string',
      description: 'Original query string',
    },
    completeness: {
      type: 'string',
      enum: ['complete', 'partial', 'degraded'],
      description: 'High-level status describing whether the result is complete or degraded',
    },
    provenance: {
      type: 'object',
      description: 'Structured provenance for every contributing source',
      properties: {
        retrievedAt: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 timestamp of when this result was assembled',
        },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                description: 'Human-readable source label',
              },
              url: {
                type: 'string',
                description: 'Canonical landing page or API root for this source',
              },
              databaseRelease: {
                type: 'string',
                description: 'Source database release, when available',
              },
              apiVersion: {
                type: 'string',
                description: 'API version or protocol family, when available',
              },
              recordIds: {
                type: 'array',
                description: 'Identifiers for the records used from this source',
                items: { type: 'string' },
              },
              doi: {
                type: 'string',
                description: 'Citation DOI for the source database, when available',
              },
            },
            required: ['source'],
          },
        },
      },
      required: ['retrievedAt', 'sources'],
    },
  },
  required: ['biocliVersion', 'data', 'ids', 'sources', 'warnings', 'queriedAt', 'query', 'completeness', 'provenance'],
};

export const resultWithMetaSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ResultWithMeta',
  description: 'Internal result envelope returned by atomic biocli commands before rendering strips the metadata in JSON mode',
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      description: 'Array of result records (columns vary by command)',
      items: { type: 'object' },
    },
    meta: {
      type: 'object',
      properties: {
        totalCount: {
          type: 'number',
          description: 'Total number of results available (may exceed returned rows)',
        },
        query: {
          type: 'string',
          description: 'Original query string',
        },
      },
    },
  },
  required: ['rows'],
};

function biocliEnvelopeSchema(
  commandName: string,
  dataSchema: JsonSchema,
  description: string,
): JsonSchema {
  const schema = cloneSchema(biocliResultSchema) as JsonSchema;
  schema.title = `biocli ${commandName} JSON output`;
  schema.description = description;
  const properties = schema.properties as Record<string, JsonSchema>;
  properties.data = dataSchema;
  return schema;
}

function commandSchemaTitle(commandName: string): string {
  return `biocli ${commandName} JSON output`;
}

function commandArraySchema(
  commandName: string,
  rowSchema: JsonSchema,
  description?: string,
): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: commandSchemaTitle(commandName),
    description: description ?? `JSON stdout returned by biocli ${commandName} -f json.`,
    ...arraySchema(rowSchema),
  };
}

function inferColumnType(column: string): JsonSchema {
  const key = column.toLowerCase();
  if (/(count|score|frequency|pct|percent|length|position|year|rank|samples|events|size|auc|ic50|zscore|total|limit)/.test(key)) {
    return { type: 'number' };
  }
  if (key === 'content' || key === 'abstract' || key === 'summary') {
    return { type: 'string' };
  }
  return {};
}

function rowSchemaFromColumns(columns?: string[]): JsonSchema {
  if (!columns || columns.length === 0) {
    return { type: 'object', additionalProperties: true };
  }
  const properties = Object.fromEntries(
    columns.map(column => [column, inferColumnType(column)] as const),
  );
  return {
    type: 'object',
    properties,
    additionalProperties: true,
  };
}

function genericRowArraySchema(cmd: CliCommand): JsonSchema {
  return commandArraySchema(
    fullName(cmd),
    rowSchemaFromColumns(cmd.columns),
    `JSON stdout returned by biocli ${fullName(cmd)} -f json. Atomic commands emit row arrays.`,
  );
}

function genericBiocliSchema(cmd: CliCommand): JsonSchema {
  return biocliEnvelopeSchema(
    fullName(cmd),
    {
      description: 'Command-specific payload. Use command examples or inspect one live result for full field details.',
    },
    `JSON stdout returned by biocli ${fullName(cmd)} -f json. Aggregate/workflow commands emit a BiocliResult envelope.`,
  );
}

const identifierNameSchema = objectSchema({
  id: { type: 'string' },
  name: { type: 'string' },
}, ['id', 'name']);

const workflowStepSchema = objectSchema({
  step: { type: 'string' },
  status: { type: 'string' },
  detail: { type: 'string' },
}, ['step', 'status', 'detail']);

const geneProfileDataSchema = objectSchema({
  symbol: { type: 'string' },
  name: { type: 'string' },
  summary: { type: 'string' },
  chromosome: { type: 'string' },
  location: { type: 'string' },
  function: { type: 'string' },
  subcellularLocation: { type: 'string' },
  pathways: arraySchema(objectSchema({
    id: { type: 'string' },
    name: { type: 'string' },
    source: { type: 'string' },
  }, ['id', 'name', 'source'])),
  goTerms: arraySchema(objectSchema({
    id: { type: 'string' },
    name: { type: 'string' },
    aspect: { type: 'string' },
  }, ['id', 'name', 'aspect'])),
  interactions: arraySchema(objectSchema({
    partner: { type: 'string' },
    score: { type: 'number' },
  }, ['partner', 'score'])),
  diseases: arraySchema(objectSchema({
    id: { type: 'string' },
    name: { type: 'string' },
    source: { type: 'string' },
  }, ['id', 'name', 'source'])),
}, [
  'symbol',
  'name',
  'summary',
  'chromosome',
  'location',
  'function',
  'subcellularLocation',
  'pathways',
  'goTerms',
  'interactions',
  'diseases',
]);

const recentLiteratureSchema = objectSchema({
  pmid: { type: 'string' },
  title: { type: 'string' },
  authors: { type: 'string' },
  journal: { type: 'string' },
  year: { type: 'string' },
  doi: { type: 'string' },
}, ['pmid', 'title', 'authors', 'journal', 'year', 'doi']);

const clinicalVariantSchema = objectSchema({
  title: { type: 'string' },
  significance: { type: 'string' },
  condition: { type: 'string' },
  accession: { type: 'string' },
}, ['title', 'significance', 'condition', 'accession']);

const geneDossierDataSchema = objectSchema({
  symbol: { type: 'string' },
  name: { type: 'string' },
  summary: { type: 'string' },
  function: { type: 'string' },
  chromosome: { type: 'string' },
  location: { type: 'string' },
  pathways: arraySchema(identifierNameSchema),
  goTerms: arraySchema(objectSchema({
    id: { type: 'string' },
    name: { type: 'string' },
    aspect: { type: 'string' },
  }, ['id', 'name', 'aspect'])),
  interactions: arraySchema(objectSchema({
    partner: { type: 'string' },
    score: { type: 'number' },
  }, ['partner', 'score'])),
  recentLiterature: arraySchema(recentLiteratureSchema),
  clinicalVariants: arraySchema(clinicalVariantSchema),
}, [
  'symbol',
  'name',
  'summary',
  'function',
  'chromosome',
  'location',
  'pathways',
  'goTerms',
  'interactions',
  'recentLiterature',
  'clinicalVariants',
]);

const tumorSummarySchema = objectSchema({
  studyId: { type: 'string' },
  molecularProfileId: { type: 'string' },
  sampleListId: { type: 'string' },
  totalSamples: { type: 'number' },
  alterationStatus: stringEnum(['altered', 'not_detected']),
  alteredSamples: { type: 'number' },
  uniquePatients: { type: 'number' },
  mutationEvents: { type: 'number' },
  mutationFrequency: { type: 'number' },
  mutationFrequencyPct: { type: 'number' },
  topMutationTypes: arraySchema(objectSchema({}, [], { additionalProperties: true })),
  topProteinChanges: arraySchema(objectSchema({}, [], { additionalProperties: true })),
  exemplarVariants: arraySchema(objectSchema({
    proteinChange: { type: 'string' },
    mutationType: { type: 'string' },
    sampleCount: { type: 'number' },
    patientCount: { type: 'number' },
    chr: { type: 'string' },
    startPosition: { type: 'number' },
    endPosition: { type: 'number' },
    variantAllele: { type: 'string' },
    referenceAllele: { type: 'string' },
  }, [
    'proteinChange',
    'mutationType',
    'sampleCount',
    'patientCount',
    'chr',
    'startPosition',
    'endPosition',
    'variantAllele',
    'referenceAllele',
  ])),
  coMutations: arraySchema(objectSchema({
    partnerGene: { type: 'string' },
    partnerEntrezGeneId: { type: 'number' },
    coMutatedSamples: { type: 'number' },
    partnerPatients: { type: 'number' },
    partnerMutationEvents: { type: 'number' },
    coMutationRateInAnchor: { type: 'number' },
    coMutationRateInAnchorPct: { type: 'number' },
    coMutationFrequencyInStudy: { type: 'number' },
    coMutationFrequencyInStudyPct: { type: 'number' },
    topMutationTypes: arraySchema(objectSchema({}, [], { additionalProperties: true })),
    topProteinChanges: arraySchema(objectSchema({}, [], { additionalProperties: true })),
  }, [
    'partnerGene',
    'partnerEntrezGeneId',
    'coMutatedSamples',
    'partnerPatients',
    'partnerMutationEvents',
    'coMutationRateInAnchor',
    'coMutationRateInAnchorPct',
    'coMutationFrequencyInStudy',
    'coMutationFrequencyInStudyPct',
    'topMutationTypes',
    'topProteinChanges',
  ])),
}, [
  'studyId',
  'molecularProfileId',
  'sampleListId',
  'totalSamples',
  'alterationStatus',
  'alteredSamples',
  'uniquePatients',
  'mutationEvents',
  'mutationFrequency',
  'mutationFrequencyPct',
  'topMutationTypes',
  'topProteinChanges',
  'exemplarVariants',
  'coMutations',
]);

const tumorGeneDossierDataSchema = objectSchema({
  ...(geneDossierDataSchema.properties as Record<string, JsonSchema>),
  tumor: tumorSummarySchema,
}, [
  ...((geneDossierDataSchema.required as string[]) ?? []),
  'tumor',
]);

const drugTargetDataSchema = objectSchema({
  target: objectSchema({
    input: { type: 'string' },
    symbol: { type: 'string' },
    name: { type: 'string' },
    ensemblId: { type: 'string' },
    biotype: { type: 'string' },
  }, ['input', 'symbol', 'name', 'ensemblId']),
  summary: objectSchema({
    rankingMode: stringEnum(['global', 'disease-aware', 'study-aware']),
    diseaseFilter: { type: 'string' },
    totalCandidates: { type: 'number' },
    matchedCandidates: { type: 'number' },
    returnedCandidates: { type: 'number' },
    approvedDrugs: { type: 'number' },
    clinicalCandidates: { type: 'number' },
    sensitivitySupportedCandidates: { type: 'number' },
  }, [
    'rankingMode',
    'totalCandidates',
    'matchedCandidates',
    'returnedCandidates',
    'approvedDrugs',
    'clinicalCandidates',
    'sensitivitySupportedCandidates',
  ]),
  tractability: objectSchema({
    positiveFeatureCount: { type: 'number' },
    enabledModalities: arraySchema(objectSchema({
      modality: { type: 'string' },
      modalityLabel: { type: 'string' },
      features: arraySchema({ type: 'string' }),
    }, ['modality', 'modalityLabel', 'features'])),
  }, ['positiveFeatureCount', 'enabledModalities']),
  associatedDiseases: arraySchema(objectSchema({
    id: { type: 'string' },
    name: { type: 'string' },
    score: { type: 'number' },
  }, ['id', 'name', 'score'])),
  candidates: arraySchema(objectSchema({
    chemblId: { type: 'string' },
    drugName: { type: 'string' },
    maxClinicalStage: { type: 'string' },
    maxClinicalStageLabel: { type: 'string' },
    drugType: { type: 'string' },
    actionTypes: arraySchema({ type: 'string' }),
    diseaseContexts: arraySchema(objectSchema({
      id: { type: 'string' },
      name: { type: 'string' },
      sourceName: { type: 'string' },
    }, ['name'])),
    evidenceSourceCounts: arraySchema(objectSchema({
      source: { type: 'string' },
      count: { type: 'number' },
    }, ['source', 'count'])),
    clinicalReports: arraySchema(objectSchema({
      id: { type: 'string' },
      source: { type: 'string' },
      clinicalStage: { type: 'string' },
      clinicalStageLabel: { type: 'string' },
      trialPhase: { type: 'string' },
      year: { type: 'number' },
      title: { type: 'string' },
      url: { type: 'string' },
    }, ['id', 'source', 'clinicalStage', 'clinicalStageLabel'])),
    ranking: objectSchema({
      score: { type: 'number' },
      matchedDiseaseTerms: arraySchema({ type: 'string' }),
      matchedGeneTerms: arraySchema({ type: 'string' }),
      matchedStudyTerms: arraySchema({ type: 'string' }),
      signals: arraySchema({ type: 'string' }),
    }, ['score', 'matchedDiseaseTerms', 'matchedGeneTerms', 'matchedStudyTerms', 'signals']),
    sensitivity: nullable(objectSchema({
      source: { const: 'GDSC' },
      release: { type: 'string' },
      matchedDrugIds: arraySchema({ type: 'string' }),
      matchedDrugNames: arraySchema({ type: 'string' }),
      matchedTissues: arraySchema({ type: 'string' }),
      matchedMeasurementCount: { type: 'number' },
      datasets: arraySchema(objectSchema({
        dataset: stringEnum(['GDSC1', 'GDSC2']),
        matchedTissues: arraySchema({ type: 'string' }),
        matchedMeasurementCount: { type: 'number' },
        bestZScore: { type: 'number' },
        topSensitiveHits: arraySchema(objectSchema({}, [], { additionalProperties: true })),
      }, ['dataset', 'matchedTissues', 'matchedMeasurementCount', 'topSensitiveHits'])),
      strongestHits: arraySchema(objectSchema({}, [], { additionalProperties: true })),
      signals: arraySchema({ type: 'string' }),
    }, [
      'source',
      'matchedDrugIds',
      'matchedDrugNames',
      'matchedTissues',
      'matchedMeasurementCount',
      'datasets',
      'strongestHits',
      'signals',
    ])),
  }, [
    'chemblId',
    'drugName',
    'maxClinicalStage',
    'maxClinicalStageLabel',
    'drugType',
    'actionTypes',
    'diseaseContexts',
    'evidenceSourceCounts',
    'clinicalReports',
    'ranking',
  ])),
  tumorStudy: tumorSummarySchema,
}, ['target', 'summary', 'tractability', 'associatedDiseases', 'candidates']);

const workflowScoutDataSchema = objectSchema({
  candidates: arraySchema(objectSchema({
    rank: { type: 'number' },
    accession: { type: 'string' },
    title: { type: 'string' },
    samples: { type: 'number' },
    date: { type: 'string' },
    relevance: { type: 'string' },
    source: { type: 'string' },
  }, ['rank', 'accession', 'title', 'samples', 'date', 'relevance', 'source'])),
  summary: { type: 'string' },
  nextSteps: arraySchema({ type: 'string' }),
}, ['candidates', 'summary', 'nextSteps']);

const workflowPrepareDataSchema = objectSchema({
  outdir: { type: 'string' },
  dataset: { type: 'string' },
  steps: arraySchema(workflowStepSchema),
}, ['outdir', 'dataset', 'steps']);

const workflowAnnotateDataSchema = objectSchema({
  outdir: { type: 'string' },
  genes: arraySchema({ type: 'string' }),
  steps: arraySchema(workflowStepSchema),
  summary: objectSchema({
    geneCount: { type: 'number' },
    annotatedCount: { type: 'number' },
    pathwayCount: { type: 'number' },
    enrichmentTerms: { type: 'number' },
    sources: arraySchema({ type: 'string' }),
    warnings: arraySchema({ type: 'string' }),
  }, ['geneCount', 'annotatedCount', 'pathwayCount', 'enrichmentTerms', 'sources', 'warnings']),
}, ['outdir', 'genes', 'steps', 'summary']);

const workflowProfileDataSchema = objectSchema({
  outdir: { type: 'string' },
  genes: arraySchema({ type: 'string' }),
  steps: arraySchema(workflowStepSchema),
  summary: objectSchema({
    geneCount: { type: 'number' },
    interactionCount: { type: 'number' },
    sharedPathwayCount: { type: 'number' },
    goTermCount: { type: 'number' },
    enrichmentTerms: { type: 'number' },
    sources: arraySchema({ type: 'string' }),
    warnings: arraySchema({ type: 'string' }),
  }, [
    'geneCount',
    'interactionCount',
    'sharedPathwayCount',
    'goTermCount',
    'enrichmentTerms',
    'sources',
    'warnings',
  ]),
}, ['outdir', 'genes', 'steps', 'summary']);

const variantDossierDataSchema = objectSchema({
  variant: { type: 'string' },
  gene: { type: 'string' },
  chromosome: { type: 'string' },
  position: { type: 'string' },
  vepConsequences: arraySchema(objectSchema({}, [], { additionalProperties: true })),
  clinicalVariants: arraySchema(clinicalVariantSchema),
  dbsnp: nullable(objectSchema({
    alleles: { type: 'string' },
    maf: { type: 'number' },
  })),
}, ['variant', 'gene', 'chromosome', 'position', 'vepConsequences', 'clinicalVariants', 'dbsnp']);

const variantInterpretDataSchema = objectSchema({
  variant: { type: 'string' },
  gene: { type: 'string' },
  chromosome: { type: 'string' },
  position: { type: 'string' },
  interpretation: objectSchema({
    clinicalSignificance: { type: 'string' },
    functionalImpact: { type: 'string' },
    consequence: { type: 'string' },
    affectedGene: { type: 'string' },
    proteinFunction: { type: 'string' },
    conditions: arraySchema({ type: 'string' }),
    evidenceSources: arraySchema({ type: 'string' }),
    recommendation: { type: 'string' },
  }, [
    'clinicalSignificance',
    'functionalImpact',
    'consequence',
    'affectedGene',
    'proteinFunction',
    'conditions',
    'evidenceSources',
    'recommendation',
  ]),
  vepConsequences: arraySchema(objectSchema({}, [], { additionalProperties: true })),
  clinicalVariants: arraySchema(clinicalVariantSchema),
  dbsnp: nullable(objectSchema({
    alleles: { type: 'string' },
  })),
}, ['variant', 'gene', 'chromosome', 'position', 'interpretation', 'vepConsequences', 'clinicalVariants', 'dbsnp']);

function aggregateRowArraySchema(commandName: string, columns?: string[]): JsonSchema {
  return biocliEnvelopeSchema(
    commandName,
    arraySchema(rowSchemaFromColumns(columns)),
    `JSON stdout returned by biocli ${commandName} -f json.`,
  );
}

const preciseCommandSchemas: Record<string, JsonSchema> = {
  'aggregate/gene-profile': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: commandSchemaTitle('aggregate/gene-profile'),
    description: 'JSON stdout returned by biocli aggregate gene-profile -f json. Single-gene mode returns one BiocliResult envelope; multi-gene mode returns an array of envelopes.',
    oneOf: [
      biocliEnvelopeSchema(
        'aggregate/gene-profile',
        geneProfileDataSchema,
        'Single-gene JSON stdout returned by biocli aggregate gene-profile -f json.',
      ),
      arraySchema(
        biocliEnvelopeSchema(
          'aggregate/gene-profile',
          geneProfileDataSchema,
          'Single-gene JSON stdout returned by biocli aggregate gene-profile -f json.',
        ),
      ),
    ],
  },
  'aggregate/gene-dossier': biocliEnvelopeSchema(
    'aggregate/gene-dossier',
    geneDossierDataSchema,
    'JSON stdout returned by biocli aggregate gene-dossier -f json.',
  ),
  'aggregate/tumor-gene-dossier': biocliEnvelopeSchema(
    'aggregate/tumor-gene-dossier',
    tumorGeneDossierDataSchema,
    'JSON stdout returned by biocli aggregate tumor-gene-dossier -f json.',
  ),
  'aggregate/drug-target': biocliEnvelopeSchema(
    'aggregate/drug-target',
    drugTargetDataSchema,
    'JSON stdout returned by biocli aggregate drug-target -f json.',
  ),
  'aggregate/workflow-scout': biocliEnvelopeSchema(
    'aggregate/workflow-scout',
    workflowScoutDataSchema,
    'JSON stdout returned by biocli aggregate workflow-scout -f json.',
  ),
  'aggregate/workflow-prepare': biocliEnvelopeSchema(
    'aggregate/workflow-prepare',
    workflowPrepareDataSchema,
    'JSON stdout returned by biocli aggregate workflow-prepare -f json.',
  ),
  'aggregate/workflow-annotate': biocliEnvelopeSchema(
    'aggregate/workflow-annotate',
    workflowAnnotateDataSchema,
    'JSON stdout returned by biocli aggregate workflow-annotate -f json.',
  ),
  'aggregate/workflow-profile': biocliEnvelopeSchema(
    'aggregate/workflow-profile',
    workflowProfileDataSchema,
    'JSON stdout returned by biocli aggregate workflow-profile -f json.',
  ),
  'aggregate/variant-dossier': biocliEnvelopeSchema(
    'aggregate/variant-dossier',
    variantDossierDataSchema,
    'JSON stdout returned by biocli aggregate variant-dossier -f json.',
  ),
  'aggregate/variant-interpret': biocliEnvelopeSchema(
    'aggregate/variant-interpret',
    variantInterpretDataSchema,
    'JSON stdout returned by biocli aggregate variant-interpret -f json.',
  ),
  'aggregate/enrichment': aggregateRowArraySchema('aggregate/enrichment', ['term', 'overlap', 'pValue', 'adjustedPValue', 'genes']),
  'aggregate/ptm-datasets': aggregateRowArraySchema('aggregate/ptm-datasets', ['accession', 'title', 'repository', 'modification', 'gene']),
  'px/files': biocliEnvelopeSchema(
    'px/files',
    arraySchema(rowSchemaFromColumns(['accession', 'fileName', 'category', 'sizeBytes', 'sizeHuman', 'checksum', 'ftpUrl', 'submissionDate'])),
    'JSON stdout returned by biocli px files -f json.',
  ),
  'px/dataset': genericBiocliSchema({
    site: 'px',
    name: 'dataset',
    description: '',
    args: [],
  } as CliCommand),
};

function resolveCommand(target: string): CliCommand | null {
  const registry = getRegistry();
  return registry.get(target) ?? null;
}

function inferCommandOutputSchema(cmd: CliCommand): JsonSchema {
  const commandName = fullName(cmd);
  const precise = preciseCommandSchemas[commandName];
  if (precise) return precise;

  if (cmd.site === 'aggregate' || commandName === 'px/dataset' || commandName === 'px/files') {
    return genericBiocliSchema(cmd);
  }

  return genericRowArraySchema(cmd);
}

export function getJsonSchemaForTarget(target?: string): JsonSchema | null {
  if (!target || target === 'result') return biocliResultSchema;
  if (target === 'meta') return resultWithMetaSchema;

  const cmd = resolveCommand(target);
  if (!cmd) return null;
  return inferCommandOutputSchema(cmd);
}
