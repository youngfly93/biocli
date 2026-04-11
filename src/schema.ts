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
