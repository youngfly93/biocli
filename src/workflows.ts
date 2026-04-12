/**
 * Canonical workflow catalog for agent-facing task planning.
 *
 * This surfaces command relationships that were previously only implicit in
 * README prose or in the heads of maintainers.
 */

export interface WorkflowStep {
  command: string;
  purpose: string;
}

export interface WorkflowCatalogEntry {
  name: string;
  description: string;
  steps: WorkflowStep[];
  outputs: string[];
}

export const workflowCatalog: WorkflowCatalogEntry[] = [
  {
    name: 'dataset-to-annotated-directory',
    description: 'Scout a public dataset, prepare a local workspace, then add downstream gene annotations.',
    steps: [
      {
        command: 'aggregate/workflow-scout',
        purpose: 'Find candidate GEO or SRA datasets relevant to a gene or disease question.',
      },
      {
        command: 'aggregate/workflow-prepare',
        purpose: 'Create a workspace with downloaded data, annotations, and a manifest.json.',
      },
      {
        command: 'aggregate/workflow-annotate',
        purpose: 'Add gene-level annotations, pathways, enrichment, and a report directory.',
      },
    ],
    outputs: ['prepared workspace', 'annotations directory', 'manifest.json', 'report.md'],
  },
  {
    name: 'gene-set-functional-profile',
    description: 'Turn a gene set into a set-level functional profile with interactions, pathways, and enrichment.',
    steps: [
      {
        command: 'aggregate/workflow-profile',
        purpose: 'Build shared pathways, STRING interactions, GO summaries, and enrichment in one run.',
      },
    ],
    outputs: ['profiles.json', 'interactions.csv', 'shared_pathways.csv', 'go_summary.csv', 'enrichment.csv'],
  },
  {
    name: 'cancer-gene-drug-triage',
    description: 'Start from a tumor study, characterize the gene in that cohort, then rank targetable drugs.',
    steps: [
      {
        command: 'cbioportal/studies',
        purpose: 'Find a valid cBioPortal studyId for the cancer cohort of interest.',
      },
      {
        command: 'aggregate/tumor-gene-dossier',
        purpose: 'Measure prevalence, exemplar variants, and co-mutations for the gene in the study.',
      },
      {
        command: 'aggregate/drug-target',
        purpose: 'Rank tractability and candidate drugs, optionally with the same tumor-study overlay.',
      },
    ],
    outputs: ['study-aware tumor dossier', 'drug candidate ranking', 'cBioPortal tumor overlay'],
  },
  {
    name: 'gene-intelligence-briefing',
    description: 'Move from basic gene profiling to a literature and clinical briefing for one gene.',
    steps: [
      {
        command: 'aggregate/gene-profile',
        purpose: 'Collect baseline function, pathways, GO terms, and interactions.',
      },
      {
        command: 'aggregate/gene-dossier',
        purpose: 'Add recent literature and ClinVar evidence for an agent-ready dossier.',
      },
    ],
    outputs: ['gene profile', 'gene dossier', 'recent literature summary', 'clinical variants'],
  },
  {
    name: 'variant-triage',
    description: 'Assemble raw variant evidence first, then produce a clinical interpretation layer.',
    steps: [
      {
        command: 'aggregate/variant-dossier',
        purpose: 'Collect dbSNP, ClinVar, and Ensembl VEP evidence for the variant.',
      },
      {
        command: 'aggregate/variant-interpret',
        purpose: 'Add interpretation, impact summary, and recommendation text.',
      },
    ],
    outputs: ['variant evidence dossier', 'clinical interpretation summary'],
  },
  {
    name: 'proteomics-dataset-drilldown',
    description: 'Search proteomics datasets, inspect one accession, then enumerate downloadable files.',
    steps: [
      {
        command: 'px/search',
        purpose: 'Find candidate ProteomeXchange or PRIDE datasets by query and filters.',
      },
      {
        command: 'px/dataset',
        purpose: 'Inspect one accession with hub metadata and optional PRIDE detail upgrade.',
      },
      {
        command: 'px/files',
        purpose: 'List the public files for a PRIDE-hosted accession.',
      },
    ],
    outputs: ['dataset shortlist', 'dataset metadata', 'file inventory'],
  },
];

export function getWorkflowCatalog(): WorkflowCatalogEntry[] {
  return workflowCatalog;
}
