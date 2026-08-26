# Agent A/B Interim Summary

Scoring contract: `agent-ab-v1` (`0-2` across completion, structure, parseability, recovery, and efficiency). These are operational scores, not biological-accuracy grades.

Independent factual-accuracy, source-verifiability, and safety review is `not_completed` in `scoring-manifest.json`. Therefore this interim summary supports execution/workflow claims only; it does not support an accuracy or source-backed-rate comparison.

## Headline

- Planned runs: `24` (`repeat 001` and `repeat 002`, all `6` tasks across `2` arms)
- Completed runs: `23`
- Partial runs: `1`
- Failed runs: `0`
- Core contract failures: `2` raw artifacts, both from `repeat 001` in the non-`biocli` arm
- Strict contract warnings: `16` raw artifacts with source-shape drift

Model and environment:

- Model: `gpt-5.4-mini`
- Environment: real terminal with outbound network access
- Important repeat `001` noise source: one `cBioPortal` upstream `503` affected `agent_with_biocli / tumor-gene-dossier-tp53-luad`
- Important repeat `002` noise source: runtime metadata is less trustworthy on several runs because some artifacts recorded `wall_clock_ms: 0` or inflated cap-like values (`180000` / `210000`)

## What Changed In Repeat 002

- `repeat 002` added `12` more runs and introduced no new core contract failures.
- The benchmark gate is now doing the right job:
  - old malformed artifacts remain visible as `repeat 001` evidence
  - new runs are being stopped from drifting into the same class of failure
- The tightened `sources` prompt fixed the schema for `repeat 002 / Block B` and `repeat 002 / Block C`.
- The remaining strict warnings are mostly historical:
  - `repeat 001`
  - `repeat 002 / Block A`, which was run before the stricter source-shape prompt landed

## Product Signal

- `agent_with_biocli` is still strongest where the task is fundamentally an execution problem:
  - multi-database aggregation
  - batch work
  - artifact generation
  - tool-directed recovery
- `agent_without_biocli` remains competitive on one-off research tasks when the task can be solved with public APIs and careful synthesis:
  - `gene-dossier-tp53`
  - `drug-target-egfr`
  - `tumor-gene-dossier-tp53-luad`
- The clearest product win is still batch execution, not “smarter answers”.

## Task-Level Read

- `gene-dossier-tp53`
  - Both repeats support the same conclusion: both arms can answer the task, but the `biocli` path is more direct and more naturally structured.
- `drug-target-egfr`
  - `repeat 001` strongly favored `biocli`.
  - `repeat 002` shows a more nuanced picture: the non-`biocli` arm produced a clean, usable manual synthesis, while the `biocli` arm lost efficiency because it started on a deprecated `ncbicli` path before recovering to `biocli`.
  - This is not a product failure. It is a benchmark-operator prompt/path issue.
- `tumor-gene-dossier-tp53-luad`
  - `repeat 001` was contaminated by an upstream `503`.
  - `repeat 002` confirms that when the upstream is stable, both arms can complete the LUAD TP53 cohort task.
  - The `biocli` arm remains stronger on product-native structure.
- `recovery-invalid-study-cbioportal`
  - Both repeats show that both arms can recover.
  - The `biocli` arm still demonstrates the more product-native repair path.
- `batch-drug-target-lung-panel`
  - This remains the strongest product proof point.
  - `repeat 001` strongly favored `biocli` on both speed and artifact surface.
  - `repeat 002` preserved the artifact advantage but exposed an efficiency risk in the current operator pattern: the `biocli` arm burned time on a failed stdin batch attempt before rerunning with `--input-file`.
- `batch-gene-profile-panel`
  - This remains the cleanest and most stable `biocli` win.
  - In both repeats, `biocli` produced the most downstream-ready output surface with the lowest execution burden.

## Contract / Harness Read

- The benchmark harness is now materially better than it was before `repeat 002`.
- The two remaining core failures should not be patched in place:
  - [run-001.json](../../../../../benchmarks/agent-ab/results/2026-04-15/raw/agent_without_biocli/drug-target-egfr/run-001.json)
  - [run-001.json](../../../../../benchmarks/agent-ab/results/2026-04-15/raw/agent_without_biocli/batch-drug-target-lung-panel/run-001.json)
- They are still useful because they document a real early benchmark failure mode.
- The remaining warnings are now mostly normalization debt, not blocking failures.

## Current Conclusion

- The evidence is now stronger than after `repeat 001` alone.
- `biocli` does not mainly win by making the agent smarter.
- It wins by making the agent:
  - more batch-capable
  - more artifact-oriented
  - more recoverable through tool-native repair paths
  - more consistent when the task is inherently execution-heavy

The main caveat is now benchmark quality, not product viability:

- runtime metadata is still noisy in `repeat 002`
- source-shape normalization is not yet clean across the whole result set
- the operator prompt should explicitly force `biocli`, not `ncbicli`, in future `with_biocli` runs

## Recommended Next Step

- Do not rerun `repeat 002`.
- Before `repeat 003`, make two small harness corrections:
  - force the `with_biocli` arm to use `biocli` directly, not `ncbicli`
  - carry the stricter `sources = [{label,url,record_ids}]` rule into every task prompt, not just the later runs
- After that, run `repeat 003`.
- Treat `npm run bench:agent-ab:validate` as a hard gate after each block.

If you need one external headline now, use this:

- `biocli` improves agent performance mainly by adding structured execution and batch workflow capability, not by replacing general reasoning.
