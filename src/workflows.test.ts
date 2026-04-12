import { describe, expect, it } from 'vitest';
import { getWorkflowCatalog } from './workflows.js';

describe('workflow catalog', () => {
  it('exposes canonical workflows with non-empty step lists', () => {
    const catalog = getWorkflowCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(5);
    for (const workflow of catalog) {
      expect(workflow.name).toBeTruthy();
      expect(workflow.description).toBeTruthy();
      expect(workflow.steps.length).toBeGreaterThan(0);
      expect(workflow.outputs.length).toBeGreaterThan(0);
      for (const step of workflow.steps) {
        expect(step.command).toContain('/');
        expect(step.purpose).toBeTruthy();
      }
    }
  });

  it('includes the hero dataset, cancer, and proteomics flows', () => {
    const names = new Set(getWorkflowCatalog().map(item => item.name));
    expect(names.has('dataset-to-annotated-directory')).toBe(true);
    expect(names.has('cancer-gene-drug-triage')).toBe(true);
    expect(names.has('proteomics-dataset-drilldown')).toBe(true);
  });
});
