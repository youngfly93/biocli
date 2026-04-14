import { beforeAll, describe, expect, it } from 'vitest';
import { initializeBiocli } from './bootstrap.js';
import { getJsonSchemaForTarget } from './schema.js';

describe('command JSON schemas', () => {
  beforeAll(async () => {
    await initializeBiocli({ discoverUserPlugins: false, emitStartupHook: false });
  });

  it('keeps the legacy result schema available', () => {
    const schema = getJsonSchemaForTarget();
    expect(schema).toMatchObject({
      title: 'BiocliResult',
      type: 'object',
    });
  });

  it('returns a precise gene-dossier envelope schema with nested literature and clinical payloads', () => {
    const schema = getJsonSchemaForTarget('aggregate/gene-dossier') as Record<string, any>;
    expect(schema.title).toContain('aggregate/gene-dossier');
    expect(schema.properties.data.properties.recentLiterature.items.properties.pmid.type).toBe('string');
    expect(schema.properties.data.properties.clinicalVariants.items.properties.significance.type).toBe('string');
  });

  it('returns a precise tumor-gene-dossier schema with nested tumor co-mutations', () => {
    const schema = getJsonSchemaForTarget('aggregate/tumor-gene-dossier') as Record<string, any>;
    const data = schema.properties.data.properties;
    const tumor = data.tumor;
    expect(tumor.properties.studyId.type).toBe('string');
    expect(tumor.properties.coMutations.items.properties.partnerGene.type).toBe('string');
    expect(tumor.properties.exemplarVariants.items.properties.sampleCount.type).toBe('number');
    expect(data.agentSummary.properties.topFinding.type).toBe('string');
    expect(data.agentSummary.properties.prevalence.properties.mutationFrequencyPct.type).toBe('number');
    expect(data.agentSummary.properties.topCoMutations.items.properties.partnerGene.type).toBe('string');
    expect(data.agentSummary.properties.recommendedNextStep.properties.rationale.type).toBe('string');
  });

  it('returns a precise drug-target schema with agentSummary and enriched candidate fields', () => {
    const schema = getJsonSchemaForTarget('aggregate/drug-target') as Record<string, any>;
    const data = schema.properties.data.properties;
    expect(data.agentSummary.properties.topFinding.type).toBe('string');
    expect(data.agentSummary.properties.topCandidates.items.properties.drugName.type).toBe('string');
    expect(data.agentSummary.properties.recommendedNextStep.properties.rationale.type).toBe('string');
    expect(data.candidates.items.properties.description.type).toBe('string');
    expect(data.candidates.items.properties.approvedIndications.items.type).toBe('string');
  });

  it('describes both single and batch outputs for aggregate/gene-profile', () => {
    const schema = getJsonSchemaForTarget('aggregate/gene-profile') as Record<string, any>;
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(schema.oneOf).toHaveLength(2);
    expect(schema.oneOf[0].properties.data.properties.symbol.type).toBe('string');
    expect(schema.oneOf[0].properties.data.properties.agentSummary.properties.topFinding.type).toBe('string');
    expect(schema.oneOf[0].properties.data.properties.agentSummary.properties.topPathways.items.properties.name.type).toBe('string');
    expect(schema.oneOf[0].properties.data.properties.agentSummary.properties.recommendedNextStep.properties.rationale.type).toBe('string');
    expect(schema.oneOf[1].type).toBe('array');
  });

  it('describes atomic command JSON output as a row array', () => {
    const schema = getJsonSchemaForTarget('gene/search') as Record<string, any>;
    expect(schema.type).toBe('array');
    expect(schema.items.type).toBe('object');
    expect(schema.title).toContain('gene/search');
  });

  it('describes workflow-prepare as a BiocliResult envelope with steps', () => {
    const schema = getJsonSchemaForTarget('aggregate/workflow-prepare') as Record<string, any>;
    expect(schema.properties.data.properties.outdir.type).toBe('string');
    expect(schema.properties.data.properties.steps.items.properties.step.type).toBe('string');
  });

  it('returns null for an unknown schema target', () => {
    expect(getJsonSchemaForTarget('does/not-exist')).toBeNull();
  });
});
