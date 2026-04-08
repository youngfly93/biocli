#!/usr/bin/env python3
"""
Regenerate benchmarks/v2/runs/report-public-stable/task_breakdown.png with:
  1. Shared colorbar pinned to the right side of the figure (no longer
     floating in the middle of the subplots as matplotlib's auto-layout did).
  2. N/A cells as light-gray background + em-dash marker, not "N/A" text.
"""
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import gridspec

SUMMARY_PATH = 'benchmarks/v2/runs/report-public-stable/public_summary.json'
OUT_PATH = 'benchmarks/v2/runs/report-public-stable/task_breakdown.png'

TOOL_DISPLAY = {'biocli': 'biocli', 'biomcp': 'BioMCP', 'gget': 'gget', 'edirect': 'EDirect'}
TOOL_ORDER = ['biocli', 'biomcp', 'gget', 'edirect']

with open(SUMMARY_PATH) as f:
    data = json.load(f)


def build_matrix(track_data):
    """Build (tools, task_display_names, matrix) for one track.
    matrix[i, j] = median score of tools[i] on tasks[j], NaN if unsupported."""
    tools = [ts['tool'] for ts in track_data['tool_summaries']]
    task_ids = sorted({
        tb['task_id']
        for ts in track_data['tool_summaries']
        for tb in ts['task_breakdown']
    })
    task_display = [tid.split('-', 1)[1] for tid in task_ids]
    matrix = np.full((len(tools), len(task_ids)), np.nan)
    for i, ts in enumerate(track_data['tool_summaries']):
        tb_by_id = {tb['task_id']: tb['score_p50'] for tb in ts['task_breakdown']}
        for j, tid in enumerate(task_ids):
            if tid in tb_by_id:
                matrix[i, j] = tb_by_id[tid]
    # Reorder by canonical tool order
    idx = [tools.index(t) for t in TOOL_ORDER if t in tools]
    return (
        [TOOL_DISPLAY[tools[i]] for i in idx],
        task_display,
        matrix[idx],
    )


core_tools, core_tasks, core_matrix = build_matrix(data['core'])
wf_tools, wf_tasks, wf_matrix = build_matrix(data['workflow'])

# --- Figure layout ---
# 3-column gridspec: main heatmaps on the left, narrow colorbar on the right
fig = plt.figure(figsize=(16, 7.5), facecolor='white')
gs = gridspec.GridSpec(
    2, 2,
    width_ratios=[60, 1.2],
    height_ratios=[len(core_tools), len(wf_tools)],
    hspace=0.55,
    wspace=0.025,
    left=0.06, right=0.93, top=0.94, bottom=0.13,
)
ax_core = fig.add_subplot(gs[0, 0])
ax_wf = fig.add_subplot(gs[1, 0])
cax = fig.add_subplot(gs[:, 1])  # colorbar spans both rows

# Colormap with dedicated "bad" color for NaN cells
cmap = plt.colormaps.get_cmap('Greens').copy()
cmap.set_bad(color='#ececec')  # soft gray for unsupported tasks


def draw_heatmap(ax, matrix, row_labels, col_labels, title):
    masked = np.ma.masked_invalid(matrix)
    im = ax.imshow(masked, cmap=cmap, vmin=0, vmax=100, aspect='auto')

    # Axes
    ax.set_xticks(range(len(col_labels)))
    ax.set_xticklabels(col_labels, rotation=35, ha='right', fontsize=10)
    ax.set_yticks(range(len(row_labels)))
    ax.set_yticklabels(row_labels, fontsize=11)
    ax.set_title(title, fontsize=13, pad=10, fontweight='bold')

    # Cell text
    for i in range(matrix.shape[0]):
        for j in range(matrix.shape[1]):
            v = matrix[i, j]
            if np.isnan(v):
                ax.text(j, i, '—', ha='center', va='center',
                        color='#9a9a9a', fontsize=11)
            else:
                text_color = 'white' if v >= 55 else '#1a1a1a'
                ax.text(j, i, f'{v:.1f}', ha='center', va='center',
                        color=text_color, fontsize=9.5, fontweight='medium')

    # Subtle grid via minor ticks (separates cells)
    ax.set_xticks(np.arange(-0.5, len(col_labels), 1), minor=True)
    ax.set_yticks(np.arange(-0.5, len(row_labels), 1), minor=True)
    ax.grid(which='minor', color='white', linewidth=1.5)
    ax.tick_params(which='both', length=0)
    for s in ax.spines.values():
        s.set_visible(False)

    return im


im_core = draw_heatmap(ax_core, core_matrix, core_tools, core_tasks, 'Core Task Breakdown')
im_wf = draw_heatmap(ax_wf, wf_matrix, wf_tools, wf_tasks, 'Workflow Task Breakdown')

# Shared vertical colorbar pinned to the right-hand cax
cbar = fig.colorbar(im_core, cax=cax, orientation='vertical')
cbar.set_label('Task Score', rotation=270, labelpad=18, fontsize=11)
cbar.outline.set_visible(False)
cbar.ax.tick_params(length=0, labelsize=9)

# Footnote
fig.text(
    0.5, 0.03,
    '— = unsupported by that tool; deliberately excluded from quality scoring rather than counted as zero.',
    ha='center', va='bottom', fontsize=9, color='#555555', style='italic',
)

fig.savefig(OUT_PATH, dpi=200, bbox_inches='tight', facecolor='white')
print(f'saved {OUT_PATH}')
