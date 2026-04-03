/**
 * JSON Schema definitions for biocli result types.
 *
 * Used by the `biocli schema` command to help AI agents validate outputs.
 */

export const biocliResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'BiocliResult',
  description: 'Structured result envelope returned by biocli aggregation commands (gene-profile, gene-dossier, etc.)',
  type: 'object',
  properties: {
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
  },
  required: ['data', 'ids', 'sources', 'warnings', 'queriedAt', 'query'],
};

export const resultWithMetaSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ResultWithMeta',
  description: 'Result envelope returned by atomic biocli commands (search, fetch, etc.)',
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
