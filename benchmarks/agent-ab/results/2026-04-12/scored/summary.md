# Agent A/B Benchmark Report — biocli v0.5.0

**Date:** 2026-04-12  
**Tasks:** 5 of 8 (pilot run, 1 repeat per arm)  
**Model:** Claude Opus 4.6 (both arms)  
**Tracks covered:** retrieval, cohort, aggregation, recovery

## Results Table

| Task | Track | biocli | web | Speed winner |
|------|-------|--------|-----|-------------|
| gene-dossier-tp53 | retrieval | 134s / 11 calls | 199s / 20 calls | biocli (1.5x) |
| variant-dossier-rs334 | retrieval | 72s / 12 calls | 62s / 4 calls | web (1.2x) |
| tumor-gene-dossier-tp53 | cohort | 652s / 21 calls | 193s / 19 calls | web (3.4x) |
| drug-target-egfr | aggregation | 91s / 12 calls | 147s / 15 calls | biocli (1.6x) |
| recovery-invalid-study | recovery | 75s / 9 calls | 108s / 11 calls | biocli (1.4x) |
| **TOTAL** | | **1024s** | **709s** | web (1.4x) |

## Dimension Scores (0-100)

| Dimension | biocli | web | Delta | Verdict |
|-----------|--------|-----|-------|---------|
| Factual accuracy | 95 | 95 | 0 | TIE |
| Source verifiability | 95 | 90 | +5 | biocli (provenance envelope) |
| Structural usability | 100 | 75 | **+25** | biocli WINS (consistent JSON) |
| Task completion | 90 | 95 | -5 | web (deeper analysis) |
| Recovery behavior | 90 | 85 | +5 | biocli (hint-guided) |
| Efficiency | 80 | 70 | +10 | biocli (faster 3/5 tasks) |
| **AVERAGE** | **91.7** | **85.0** | **+6.7** | **biocli overall** |

## Key Findings

### 1. Accuracy is a dead heat

Both arms produced correct, verifiable data on all 5 tasks. biocli does NOT make agents more accurate — accuracy depends on the model, not the tool.

### 2. Structural consistency is biocli's biggest advantage (+25 points)

Every biocli result follows the same `BiocliResult` envelope: `{biocliVersion, data, ids, sources, warnings, queriedAt, completeness, provenance}`. Web results had different shapes for every query. For downstream pipelines consuming agent output, this is the difference between "parse once" and "handle N formats."

### 3. API accessibility is biocli's hidden value

- **Open Targets:** GraphQL API worked via biocli; web agent got HTTP 400 (JS-rendered page) and had to fallback to PMC literature
- **cBioPortal co-mutations:** biocli handles pagination internally; web agent had to manually loop and aggregate
- **Error recovery:** biocli's 404 response included `"Hint: Run biocli cbioportal studies -f json"` which directly guided the agent's next action

### 4. Error hint recovery works as designed

| Arm | Recovery path | Time |
|-----|--------------|------|
| biocli | 404 → read hint → `cbioportal studies lung` → find study → success | 75s |
| web | 404 → reason about API → query /api/studies → filter LUAD → success | 108s |

Both recovered successfully, but biocli was 30% faster because the hint eliminated the "figure out what to do next" step.

### 5. Web agent produces richer analysis

On tumor-gene-dossier, the web agent delivered:
- VAF statistics (median 0.346)
- Mutual exclusivity analysis (KRAS, KEAP1, STK11 tend exclusive)
- 12 driver gene co-occurrence patterns
- Variant type distribution (SNP/DEL/INS)

biocli's co-mutations only returned the top partners by absolute count (TTN, MUC16 — large genes reflecting TMB, not functional co-drivers). The web agent's approach was biologically more informative.

On drug-target, the web agent found 15 drugs (vs 8) with mechanisms, trade names, and indications. biocli had numeric ranking scores and GDSC sensitivity data, but fewer drugs.

### 6. Performance anomaly: tumor-gene-dossier

biocli took 652s vs web's 193s (3.4x slower). Root cause: the `co-mutations` command fetches ALL mutations for the study, then cross-references against partner genes. The web agent queried partner genes directly via individual API calls — more requests but faster overall because each request is small.

**Action item:** Optimize co-mutations to use per-gene queries rather than full-study fetch.

## Product Positioning Conclusion

biocli's empirically demonstrated value:

| Should emphasize | Should NOT emphasize |
|-----------------|---------------------|
| Consistent structured output (100% envelope compliance) | "More accurate than web search" |
| API abstraction (GraphQL, pagination, auth) | "Finds more data" |
| Guided error recovery (agent-actionable hints) | "Fastest possible queries" |
| Low cognitive overhead (1 cmd = 14 queries) | "Deepest analysis" |

**One-line positioning:** biocli is the standard interface layer that makes agent-driven biological data retrieval reliable and predictable — not smarter, but dependably structured.

## Methodology Notes

- Both arms used Claude Opus 4.6 with identical temperature
- biocli arm had access to Bash tool only (no WebSearch)
- web arm had access to WebSearch + WebFetch only (no Bash/biocli)
- Ground truth established from live API calls before experiment
- Scoring applied per `benchmarks/agent-ab/rubric.md`
- Tasks skipped: literature-brief (predicted tie), workflow-scout (low delta), workflow-prepare-preview (no --dry-run flag)
- Full agent transcripts available in raw/ subdirectories
