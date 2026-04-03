# biocli

Query biological databases from the terminal. Agent-first design.

```
biocli v0.2.0
NCBI · UniProt · KEGG · STRING · Ensembl · Enrichr
42 commands · 6 database backends · 8 workflow commands · 4 download commands
```

## Install

```bash
npm install -g @biocli/cli
```

Requires Node.js >= 20. No API keys needed (optional NCBI key increases rate limit).

## Why biocli

biocli is designed for **AI agents** (Claude, GPT, etc.) to query biology databases faster and more accurately than web browsing. It returns structured JSON that agents can parse directly.

**One command replaces 4 browser tabs:**

```bash
biocli aggregate gene-dossier TP53 -f json
```

Returns a unified JSON with gene summary, protein function, KEGG pathways, GO terms, protein interactions, recent literature, and clinical variants — sourced from NCBI, UniProt, KEGG, STRING, PubMed, and ClinVar in parallel.

## Quick start

```bash
# Gene intelligence (NCBI + UniProt + KEGG + STRING + PubMed + ClinVar)
biocli aggregate gene-dossier TP53

# Variant interpretation (dbSNP + ClinVar + Ensembl VEP)
biocli aggregate variant-dossier rs334

# Literature review with abstracts
biocli aggregate literature-brief "CRISPR cancer immunotherapy" --limit 10

# Pathway enrichment (Enrichr + STRING)
biocli aggregate enrichment TP53,BRCA1,EGFR,MYC,CDK2

# Gene profile (NCBI + UniProt + KEGG + STRING)
biocli aggregate gene-profile TP53
```

## All commands

### Workflow commands (agent-optimized)

| Command | Sources | Use case |
|---------|---------|----------|
| `aggregate gene-dossier <gene>` | NCBI+UniProt+KEGG+STRING+PubMed+ClinVar | Complete gene intelligence report |
| `aggregate variant-dossier <variant>` | dbSNP+ClinVar+Ensembl VEP | Variant interpretation |
| `aggregate variant-interpret <variant>` | dbSNP+ClinVar+VEP+UniProt | Variant interpretation with clinical context |
| `aggregate literature-brief <query>` | PubMed | Literature summary with abstracts |
| `aggregate enrichment <genes>` | Enrichr+STRING | Pathway/GO enrichment analysis |
| `aggregate gene-profile <gene>` | NCBI+UniProt+KEGG+STRING | Gene profile (no literature) |
| `aggregate workflow-scout <query>` | GEO+SRA | Scout datasets for a research question |
| `aggregate workflow-prepare <dataset>` | GEO+NCBI+UniProt+KEGG | Prepare research-ready directory with data + annotations |

### Database commands (atomic)

| Database | Commands |
|----------|----------|
| **PubMed** | `pubmed search`, `fetch`, `abstract`, `cited-by`, `related`, `info` |
| **Gene** | `gene search`, `info`, `fetch` (FASTA download) |
| **GEO** | `geo search`, `dataset`, `samples`, `download` |
| **SRA** | `sra search`, `run`, `download` (FASTQ via ENA/sra-tools) |
| **ClinVar** | `clinvar search`, `variant` |
| **SNP** | `snp lookup` |
| **Taxonomy** | `taxonomy lookup` |
| **UniProt** | `uniprot search`, `fetch`, `sequence` (FASTA download) |
| **KEGG** | `kegg pathway`, `link`, `disease`, `convert` |
| **STRING** | `string partners`, `network`, `enrichment` |
| **Ensembl** | `ensembl lookup`, `vep`, `xrefs` |
| **Enrichr** | `enrichr analyze` |

## Output formats

```bash
biocli gene info 7157 -f json    # JSON (default for workflow commands)
biocli gene info 7157 -f table   # Table (default for atomic commands)
biocli gene info 7157 -f yaml    # YAML
biocli gene info 7157 -f csv     # CSV
biocli gene info 7157 -f plain   # Plain text
```

## Agent-first result schema

All workflow commands (`aggregate *`) return a standard `BiocliResult` envelope:

```json
{
  "data": { ... },
  "ids": { "ncbiGeneId": "7157", "uniprotAccession": "P04637", ... },
  "sources": ["NCBI Gene", "UniProt", "KEGG", "STRING"],
  "warnings": [],
  "queriedAt": "2026-04-03T10:00:00.000Z",
  "organism": "Homo sapiens",
  "query": "TP53"
}
```

- `data` — the actual result payload
- `ids` — cross-database identifiers for the queried entity
- `sources` — which databases contributed data
- `warnings` — partial failures, ambiguous matches (never silently hidden)
- `queriedAt` — ISO timestamp for reproducibility
- `organism` — species context

## Configuration

```bash
biocli config set api_key YOUR_NCBI_KEY   # Optional: increases NCBI rate limit 3→10 req/s
biocli config set email you@example.com
biocli config show
```

Config stored at `~/.biocli/config.yaml`.

## Rate limits

| Database | Rate | Auth |
|----------|------|------|
| NCBI | 3/s (10/s with API key) | Optional API key |
| UniProt | 50/s | None |
| KEGG | 10/s | None |
| STRING | 1/s | None |
| Ensembl | 15/s | None |
| Enrichr | 5/s | None |

All rate limits are enforced automatically per-database.

## License

MIT
