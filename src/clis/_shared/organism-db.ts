/**
 * Unified organism database for cross-database ID resolution.
 *
 * Maps common organism names to identifiers used by each database:
 *   - NCBI taxonomy name and ID
 *   - KEGG organism code
 *   - Ensembl species name
 */

export interface OrganismEntry {
  name: string;         // "Homo sapiens"
  taxId: number;        // 9606
  keggOrg: string;      // "hsa"
  ensemblName: string;  // "homo_sapiens"
}

export const ORGANISM_DB: Record<string, OrganismEntry> = {
  human:     { name: 'Homo sapiens',                taxId: 9606,  keggOrg: 'hsa', ensemblName: 'homo_sapiens' },
  mouse:     { name: 'Mus musculus',                taxId: 10090, keggOrg: 'mmu', ensemblName: 'mus_musculus' },
  rat:       { name: 'Rattus norvegicus',           taxId: 10116, keggOrg: 'rno', ensemblName: 'rattus_norvegicus' },
  zebrafish: { name: 'Danio rerio',                 taxId: 7955,  keggOrg: 'dre', ensemblName: 'danio_rerio' },
  fly:       { name: 'Drosophila melanogaster',     taxId: 7227,  keggOrg: 'dme', ensemblName: 'drosophila_melanogaster' },
  worm:      { name: 'Caenorhabditis elegans',      taxId: 6239,  keggOrg: 'cel', ensemblName: 'caenorhabditis_elegans' },
  yeast:     { name: 'Saccharomyces cerevisiae',    taxId: 4932,  keggOrg: 'sce', ensemblName: 'saccharomyces_cerevisiae' },
  chicken:   { name: 'Gallus gallus',               taxId: 9031,  keggOrg: 'gga', ensemblName: 'gallus_gallus' },
  dog:       { name: 'Canis lupus familiaris',      taxId: 9615,  keggOrg: 'cfa', ensemblName: 'canis_lupus_familiaris' },
  pig:       { name: 'Sus scrofa',                  taxId: 9823,  keggOrg: 'ssc', ensemblName: 'sus_scrofa' },
  cow:       { name: 'Bos taurus',                  taxId: 9913,  keggOrg: 'bta', ensemblName: 'bos_taurus' },
  rabbit:    { name: 'Oryctolagus cuniculus',       taxId: 9986,  keggOrg: 'ocu', ensemblName: 'oryctolagus_cuniculus' },
  frog:      { name: 'Xenopus tropicalis',          taxId: 8364,  keggOrg: 'xtr', ensemblName: 'xenopus_tropicalis' },
};

/**
 * Resolve an organism identifier (common name, scientific name, or taxId)
 * to a full OrganismEntry. Defaults to human if not found.
 */
export function resolveOrganism(input: string): OrganismEntry {
  const lower = input.toLowerCase().trim();

  // Direct match by common name
  if (ORGANISM_DB[lower]) return ORGANISM_DB[lower];

  // Match by scientific name
  for (const entry of Object.values(ORGANISM_DB)) {
    if (entry.name.toLowerCase() === lower) return entry;
  }

  // Match by taxId
  const taxId = parseInt(lower, 10);
  if (!isNaN(taxId)) {
    for (const entry of Object.values(ORGANISM_DB)) {
      if (entry.taxId === taxId) return entry;
    }
  }

  // Match by KEGG org code
  for (const entry of Object.values(ORGANISM_DB)) {
    if (entry.keggOrg === lower) return entry;
  }

  // Default to human
  return ORGANISM_DB.human;
}
