# Hero Pipeline Benchmark Block

Use this as the short public-facing benchmark block for README, release notes, and package-facing docs.

It is intentionally small. The goal is to prove the product claim without turning public docs into a benchmarking appendix.

## Product claim

biocli does not make agents smarter. It makes repeated biological workflows faster to rerun, cheaper to recover, and easier to hand off to downstream agents.

## Reusable benchmark table

Current reference run: `2026-04-13`

| Workflow | Cold run | Warm run | Effect | Cache hits |
|---|---:|---:|---:|---:|
| `aggregate gene-profile` | 15.35 s | 0.204 s | 75.3x faster | 10/10 |
| `aggregate drug-target` | 26.12 s | 0.185 s | 141.2x faster | 8/8 |
| `aggregate tumor-gene-dossier` | 22.22 s | 0.106 s | 209.6x faster | 6/6 |

## Resume proof

- interruption captured after `3` completed items
- resumed to `10/10` completed items
- resume duration: `23.09 s`

## Source artifacts

- [Pipeline report](../../benchmarks/pipeline/results/2026-04-13/report.md)
- [Cold summary](../../benchmarks/pipeline/results/2026-04-13/cold/summary.json)
- [Warm summary](../../benchmarks/pipeline/results/2026-04-13/warm/summary.json)
- [Resume summary](../../benchmarks/pipeline/results/2026-04-13/resume/gene-profile-interruption/summary.json)

## Usage rules

- Lead with the product claim, not the table.
- Keep the table to the three hero workflows only.
- Do not mix this block with unrelated benchmark suites in the same paragraph.
- Update the numbers only when the underlying benchmark artifacts have been rerun and checked in.
