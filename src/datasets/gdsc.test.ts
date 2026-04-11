import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import xlsx from 'xlsx';
import {
  _resetGdscSingleton,
  findGdscDrugEntriesByName,
  gdscPaths,
  loadGdscSensitivityIndex,
} from './gdsc.js';
import type { HttpContext } from '../types.js';

const DUMMY_CTX: HttpContext = {
  databaseId: 'gdsc',
  fetch: async () => { throw new Error('unexpected fetch'); },
  fetchJson: async () => { throw new Error('unexpected fetchJson'); },
  fetchText: async () => { throw new Error('unexpected fetchText'); },
  fetchXml: async () => { throw new Error('unexpected fetchXml'); },
};

describe('gdsc dataset index', () => {
  let tempRoot = '';
  let previousDatasetsDir: string | undefined;

  beforeEach(() => {
    _resetGdscSingleton();
    previousDatasetsDir = process.env.BIOCLI_DATASETS_DIR;
    tempRoot = mkdtempSync(join(tmpdir(), 'biocli-gdsc-test-'));
    process.env.BIOCLI_DATASETS_DIR = tempRoot;

    const paths = gdscPaths();
    mkdirSync(paths.dir, { recursive: true });

    writeFileSync(paths.compoundsCsv, [
      '"DRUG_ID","SCREENING_SITE","DRUG_NAME","SYNONYMS","TARGET","TARGET_PATHWAY"',
      '1032,"SANGER","Afatinib","BIBW2992, Gilotrif","EGFR, ERBB2","EGFR signaling"',
      '1919,"SANGER","Osimertinib","AZD9291, Tagrisso","EGFR","EGFR signaling"',
      '',
    ].join('\n'));

    const gdsc1Rows = [
      {
        DATASET: 'GDSC1',
        NLME_RESULT_ID: '1',
        NLME_CURVE_ID: '11',
        COSMIC_ID: '1001',
        CELL_LINE_NAME: 'HCC827',
        SANGER_MODEL_ID: 'SIDM00001',
        TCGA_DESC: 'LUNG_ADENOCARCINOMA',
        DRUG_ID: '1032',
        DRUG_NAME: 'Afatinib',
        PUTATIVE_TARGET: 'EGFR, ERBB2',
        PATHWAY_NAME: 'EGFR signaling',
        COMPANY_ID: '100',
        WEBRELEASE: 'Y',
        MIN_CONC: '0.01',
        MAX_CONC: '10',
        LN_IC50: '-1.2',
        AUC: '0.21',
        RMSE: '0.01',
        Z_SCORE: '-2.31',
      },
      {
        DATASET: 'GDSC1',
        NLME_RESULT_ID: '2',
        NLME_CURVE_ID: '12',
        COSMIC_ID: '1002',
        CELL_LINE_NAME: 'PC9',
        SANGER_MODEL_ID: 'SIDM00002',
        TCGA_DESC: 'LUNG_ADENOCARCINOMA',
        DRUG_ID: '1032',
        DRUG_NAME: 'Afatinib',
        PUTATIVE_TARGET: 'EGFR, ERBB2',
        PATHWAY_NAME: 'EGFR signaling',
        COMPANY_ID: '100',
        WEBRELEASE: 'Y',
        MIN_CONC: '0.01',
        MAX_CONC: '10',
        LN_IC50: '-0.8',
        AUC: '0.29',
        RMSE: '0.02',
        Z_SCORE: '-1.88',
      },
    ];

    const gdsc2Rows = [
      {
        DATASET: 'GDSC2',
        NLME_RESULT_ID: '3',
        NLME_CURVE_ID: '13',
        COSMIC_ID: '2001',
        CELL_LINE_NAME: 'H1975',
        SANGER_MODEL_ID: 'SIDM00003',
        TCGA_DESC: 'NON_SMALL_CELL_LUNG_CARCINOMA',
        DRUG_ID: '1919',
        DRUG_NAME: 'Osimertinib',
        PUTATIVE_TARGET: 'EGFR',
        PATHWAY_NAME: 'EGFR signaling',
        COMPANY_ID: '101',
        WEBRELEASE: 'Y',
        MIN_CONC: '0.01',
        MAX_CONC: '10',
        LN_IC50: '-0.4',
        AUC: '0.41',
        RMSE: '0.03',
        Z_SCORE: '-1.11',
      },
    ];

    const gdsc1Workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(gdsc1Workbook, xlsx.utils.json_to_sheet(gdsc1Rows), 'Sheet 1');
    xlsx.writeFile(gdsc1Workbook, paths.gdsc1Xlsx);

    const gdsc2Workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(gdsc2Workbook, xlsx.utils.json_to_sheet(gdsc2Rows), 'Sheet 1');
    xlsx.writeFile(gdsc2Workbook, paths.gdsc2Xlsx);

    writeFileSync(paths.meta, JSON.stringify({
      source: 'GDSC bulk downloads',
      release: '8.5',
      fetchedAt: new Date().toISOString(),
      staleAfterDays: 90,
      indexVersion: 1,
      files: [
        { key: 'compoundsCsv', filename: 'screened_compounds_rel_8.5.csv', url: 'mock://compounds', sizeBytes: statSync(paths.compoundsCsv).size, sha256: 'mock-1' },
        { key: 'gdsc1Xlsx', filename: 'GDSC1_fitted_dose_response_27Oct23.xlsx', url: 'mock://gdsc1', sizeBytes: statSync(paths.gdsc1Xlsx).size, sha256: 'mock-2' },
        { key: 'gdsc2Xlsx', filename: 'GDSC2_fitted_dose_response_27Oct23.xlsx', url: 'mock://gdsc2', sizeBytes: statSync(paths.gdsc2Xlsx).size, sha256: 'mock-3' },
      ],
    }, null, 2));
  });

  afterEach(() => {
    _resetGdscSingleton();
    if (previousDatasetsDir === undefined) delete process.env.BIOCLI_DATASETS_DIR;
    else process.env.BIOCLI_DATASETS_DIR = previousDatasetsDir;
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });

  it('builds a local index and resolves drug names', async () => {
    const index = await loadGdscSensitivityIndex(DUMMY_CTX);

    const afatinib = findGdscDrugEntriesByName(index, 'AFATINIB');
    expect(afatinib).toHaveLength(1);
    expect(afatinib[0]?.compound).toMatchObject({
      drugId: '1032',
      drugName: 'Afatinib',
    });
    expect(afatinib[0]?.datasets[0]).toMatchObject({
      dataset: 'GDSC1',
      rowCount: 2,
      bestZScore: -2.31,
    });
    expect(afatinib[0]?.datasets[0]?.tissues[0]).toMatchObject({
      tissue: 'LUNG ADENOCARCINOMA',
      rowCount: 2,
    });
  });

  it('resolves synonyms from the derived alias index', async () => {
    const index = await loadGdscSensitivityIndex(DUMMY_CTX);

    const osimertinib = findGdscDrugEntriesByName(index, 'Tagrisso');
    expect(osimertinib).toHaveLength(1);
    expect(osimertinib[0]?.compound.drugName).toBe('Osimertinib');
    expect(osimertinib[0]?.datasets[0]?.topHits[0]).toMatchObject({
      cellLineName: 'H1975',
      tissue: 'NON SMALL CELL LUNG CARCINOMA',
      zScore: -1.11,
    });
  });
});

