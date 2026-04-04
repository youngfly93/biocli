#!/usr/bin/env python3
"""
Generate benchmark figures for biocli README.
Style: dark background, orange gradient bars, leaderboard aesthetic.
"""

import json
import sys
import os
import numpy as np

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
import matplotlib.patheffects as pe

# ── Configuration ─────────────────────────────────────────────────────────────

BG_COLOR = '#1a1a2e'
TEXT_COLOR = '#cccccc'
ACCENT_COLOR = '#ff6b1a'
ACCENT_LIGHT = '#ff8c42'
SECONDARY_COLOR = '#2d2d44'
BORDER_COLOR = '#3d3d5c'
HIGHLIGHT_TEXT = '#ffffff'

TOOL_ORDER = ['biocli', 'BioMCP', 'gget']
TOOL_MAP = {'biocli': 'biocli', 'gget': 'gget', 'biomcp': 'BioMCP'}

TOOL_COLORS = {
    'biocli': ACCENT_COLOR,
    'BioMCP': SECONDARY_COLOR,
    'gget': SECONDARY_COLOR,
}

TOOL_EDGE = {
    'biocli': ACCENT_LIGHT,
    'BioMCP': BORDER_COLOR,
    'gget': BORDER_COLOR,
}

VERSIONS = {'biocli': 'v0.2.0', 'BioMCP': 'v0.8.19', 'gget': 'v0.30.3'}

DIMENSIONS = [
    ('agentReadiness', 'Agent\nReadiness'),
    ('workflowDepth', 'Workflow\nDepth'),
    ('operationalSafety', 'Operational\nSafety'),
    ('reproducibility', 'Reproducibility'),
    ('outputUsability', 'Output\nUsability'),
    ('efficiency', 'Efficiency'),
]

def load_data(date):
    with open(f'benchmarks/results/{date}/scored/summary.json') as f:
        raw = json.load(f)
    data = {}
    for entry in raw:
        name = TOOL_MAP.get(entry['tool'], entry['tool'])
        data[name] = entry
    return data

def setup_dark_style():
    plt.rcParams.update({
        'font.family': 'monospace',
        'font.size': 12,
        'axes.linewidth': 0,
        'axes.edgecolor': BORDER_COLOR,
        'axes.labelcolor': TEXT_COLOR,
        'text.color': TEXT_COLOR,
        'xtick.color': TEXT_COLOR,
        'ytick.color': TEXT_COLOR,
        'xtick.major.width': 0,
        'ytick.major.width': 0.4,
        'ytick.major.size': 0,
        'figure.facecolor': BG_COLOR,
        'axes.facecolor': BG_COLOR,
        'savefig.facecolor': BG_COLOR,
        'savefig.dpi': 300,
        'savefig.bbox': 'tight',
        'savefig.pad_inches': 0.3,
    })

# ── Figure 1: Overall Score Leaderboard ───────────────────────────────────────

def plot_total_scores(data, outdir):
    fig, ax = plt.subplots(figsize=(8, 5))

    tools = TOOL_ORDER
    scores = [data[t]['totalWeighted'] for t in tools]

    bars = []
    for i, (tool, score) in enumerate(zip(tools, scores)):
        color = TOOL_COLORS[tool]
        edge = TOOL_EDGE[tool]
        bar = ax.bar(i, score, color=color, width=0.6,
                     edgecolor=edge, linewidth=1.5, zorder=3)
        bars.append(bar[0])

    # Score labels on top
    for i, (tool, score) in enumerate(zip(tools, scores)):
        color = HIGHLIGHT_TEXT if tool == 'biocli' else TEXT_COLOR
        ax.text(i, score + 2, f'{score}',
                ha='center', va='bottom', fontsize=18, fontweight='bold',
                color=color, fontfamily='monospace')

    # X-axis: tool name + version, rotated
    ax.set_xticks(range(len(tools)))
    labels = []
    for tool in tools:
        labels.append(f'{tool}\n{VERSIONS[tool]}')
    ax.set_xticklabels(labels, fontsize=11, fontweight='bold',
                       fontfamily='monospace', rotation=0, ha='center')

    ax.set_ylabel('Weighted Score', fontsize=13, fontfamily='monospace',
                  color=TEXT_COLOR, labelpad=10)
    ax.set_ylim(0, 115)

    # Horizontal reference lines (subtle)
    for y in [25, 50, 75, 100]:
        ax.axhline(y=y, color=BORDER_COLOR, linewidth=0.3, zorder=1)

    # Title
    ax.set_title('biocli Benchmark Leaderboard',
                 fontsize=16, fontweight='bold', fontfamily='monospace',
                 color=HIGHLIGHT_TEXT, pad=20)

    # Subtitle
    ax.text(0.5, 1.02, 'Agent-First Biological Workflow Tasks · 2026-04-04',
            transform=ax.transAxes, ha='center', va='bottom',
            fontsize=9, color=TEXT_COLOR, fontfamily='monospace')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.tick_params(axis='x', length=0)
    ax.tick_params(axis='y', length=0)

    # Y-axis tick labels
    ax.set_yticks([0, 25, 50, 75, 100])

    plt.tight_layout()
    path = os.path.join(outdir, 'total_scores.png')
    fig.savefig(path)
    plt.close(fig)
    print(f'  Saved: {path}')

# ── Figure 2: Dimension Comparison ────────────────────────────────────────────

def plot_dimensions(data, outdir):
    fig, ax = plt.subplots(figsize=(10, 5))

    dim_keys = [d[0] for d in DIMENSIONS]
    dim_labels = [d[1] for d in DIMENSIONS]

    x = np.arange(len(dim_keys))
    width = 0.25

    dim_colors = {
        'biocli': ACCENT_COLOR,
        'BioMCP': '#6c5ce7',
        'gget': '#fdcb6e',
    }

    for i, tool in enumerate(TOOL_ORDER):
        cc = data[tool]['crossCutting']
        values = [cc.get(k, 0) for k in dim_keys]
        offset = (i - 1) * width
        color = dim_colors[tool]
        edge = '#ffffff22'
        bars = ax.bar(x + offset, values, width, label=f'{tool} {VERSIONS[tool]}',
                      color=color, edgecolor=edge, linewidth=0.8, zorder=3)

        for bar, val in zip(bars, values):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.2,
                        str(val), ha='center', va='bottom', fontsize=8,
                        color=HIGHLIGHT_TEXT if tool == 'biocli' else TEXT_COLOR,
                        fontfamily='monospace')

    ax.set_ylabel('Score (out of 10)', fontsize=12, fontfamily='monospace',
                  color=TEXT_COLOR, labelpad=10)
    ax.set_ylim(0, 12.5)
    ax.set_xticks(x)
    ax.set_xticklabels(dim_labels, fontsize=9, fontfamily='monospace')

    ax.set_title('Cross-Cutting Quality Dimensions',
                 fontsize=14, fontweight='bold', fontfamily='monospace',
                 color=HIGHLIGHT_TEXT, pad=15)

    ax.text(0.5, 1.01, 'Manual audit with published justifications',
            transform=ax.transAxes, ha='center', va='bottom',
            fontsize=8, color=TEXT_COLOR, fontfamily='monospace', style='italic')

    # Reference lines
    for y in [5, 10]:
        ax.axhline(y=y, color=BORDER_COLOR, linewidth=0.3, zorder=1)

    ax.legend(frameon=False, fontsize=9, loc='upper right',
              labelcolor=TEXT_COLOR)

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.tick_params(axis='x', length=0)
    ax.tick_params(axis='y', length=0)
    ax.set_yticks([0, 5, 10])

    plt.tight_layout()
    path = os.path.join(outdir, 'dimensions.png')
    fig.savefig(path)
    plt.close(fig)
    print(f'  Saved: {path}')

# ── Figure 3: Task Success by Category ───────────────────────────────────────

def plot_task_categories(data, outdir):
    categories = ['gene', 'variant', 'literature', 'data_preparation']
    cat_labels = ['Gene', 'Variant', 'Literature', 'Data\nPreparation']

    fig, ax = plt.subplots(figsize=(9, 5))

    x = np.arange(len(categories))
    width = 0.25

    cat_colors = {
        'biocli': ACCENT_COLOR,
        'BioMCP': '#6c5ce7',
        'gget': '#fdcb6e',
    }

    for i, tool in enumerate(TOOL_ORDER):
        tasks = data[tool]['tasks']
        pcts = []
        for cat in categories:
            cat_tasks = [t for t in tasks if t['category'] == cat]
            score = sum(t['score'] for t in cat_tasks)
            maxs = sum(t['maxScore'] for t in cat_tasks)
            pcts.append(score / maxs * 100 if maxs > 0 else 0)

        offset = (i - 1) * width
        color = cat_colors[tool]
        bars = ax.bar(x + offset, pcts, width, label=f'{tool} {VERSIONS[tool]}',
                      color=color, edgecolor='#ffffff22', linewidth=0.8, zorder=3)

        for bar, pct in zip(bars, pcts):
            if pct > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5,
                        f'{pct:.0f}%', ha='center', va='bottom', fontsize=8,
                        color=HIGHLIGHT_TEXT if tool == 'biocli' else TEXT_COLOR,
                        fontfamily='monospace', fontweight='bold')

    ax.set_ylabel('Task Success Rate (%)', fontsize=12, fontfamily='monospace',
                  color=TEXT_COLOR, labelpad=10)
    ax.set_ylim(0, 118)
    ax.set_xticks(x)
    ax.set_xticklabels(cat_labels, fontsize=10, fontfamily='monospace')

    ax.set_title('Task Success by Category',
                 fontsize=14, fontweight='bold', fontfamily='monospace',
                 color=HIGHLIGHT_TEXT, pad=15)

    ax.text(0.5, 1.01, 'Automated scoring from real command output',
            transform=ax.transAxes, ha='center', va='bottom',
            fontsize=8, color=TEXT_COLOR, fontfamily='monospace', style='italic')

    for y in [25, 50, 75, 100]:
        ax.axhline(y=y, color=BORDER_COLOR, linewidth=0.3, zorder=1)

    ax.legend(frameon=False, fontsize=9, loc='upper right',
              labelcolor=TEXT_COLOR)

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.tick_params(axis='x', length=0)
    ax.tick_params(axis='y', length=0)
    ax.set_yticks([0, 25, 50, 75, 100])

    plt.tight_layout()
    path = os.path.join(outdir, 'task_categories.png')
    fig.savefig(path)
    plt.close(fig)
    print(f'  Saved: {path}')

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    date = sys.argv[1] if len(sys.argv) > 1 else '2026-04-04'
    outdir = f'benchmarks/results/{date}/plots'
    os.makedirs(outdir, exist_ok=True)

    setup_dark_style()
    data = load_data(date)

    print(f'Generating benchmark figures for {date}...')
    plot_total_scores(data, outdir)
    plot_dimensions(data, outdir)
    plot_task_categories(data, outdir)
    print('Done.')
