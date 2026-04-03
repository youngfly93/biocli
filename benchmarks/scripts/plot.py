#!/usr/bin/env python3
"""
Generate SCI-quality benchmark figures for biocli README.

Style: white background, no gridlines, comfortable colors, clean typography.
Outputs: benchmarks/results/<date>/plots/
"""

import json
import sys
import os
import numpy as np

# Use Agg backend for headless rendering
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import matplotlib.patheffects as pe

# ── Configuration ─────────────────────────────────────────────────────────────

# SCI color palette (muted, professional)
COLORS = {
    'biocli': '#2E86AB',   # Steel blue
    'BioMCP': '#A23B72',   # Muted rose
    'gget': '#F18F01',     # Warm amber
}

TOOL_ORDER = ['biocli', 'BioMCP', 'gget']
TOOL_MAP = {'biocli': 'biocli', 'gget': 'gget', 'biomcp': 'BioMCP'}

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

def setup_style():
    """Set global matplotlib style for SCI figures."""
    plt.rcParams.update({
        'font.family': 'sans-serif',
        'font.sans-serif': ['Helvetica', 'Arial', 'DejaVu Sans'],
        'font.size': 11,
        'axes.linewidth': 0.8,
        'axes.edgecolor': '#333333',
        'axes.labelcolor': '#333333',
        'text.color': '#333333',
        'xtick.color': '#333333',
        'ytick.color': '#333333',
        'xtick.major.width': 0.6,
        'ytick.major.width': 0.6,
        'figure.facecolor': 'white',
        'axes.facecolor': 'white',
        'savefig.facecolor': 'white',
        'savefig.dpi': 300,
        'savefig.bbox': 'tight',
        'savefig.pad_inches': 0.15,
    })

# ── Figure 1: Total Score Bar Chart ──────────────────────────────────────────

def plot_total_scores(data, outdir):
    fig, ax = plt.subplots(figsize=(6, 3.5))

    tools = TOOL_ORDER
    scores = [data[t]['totalWeighted'] for t in tools]
    colors = [COLORS[t] for t in tools]

    bars = ax.bar(tools, scores, color=colors, width=0.55, edgecolor='white', linewidth=1.5)

    # Add score labels on top of bars
    for bar, score in zip(bars, scores):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5,
                f'{score}', ha='center', va='bottom', fontsize=14, fontweight='bold',
                color='#333333')

    ax.set_ylabel('Weighted Score (out of 100)', fontsize=11)
    ax.set_ylim(0, 110)
    ax.set_title('biocli Benchmark: Overall Score', fontsize=13, fontweight='bold', pad=12)

    # Clean style: remove gridlines, top/right spines
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(False)
    ax.tick_params(axis='x', length=0)

    # Add version labels well below tool names (avoid overlap)
    versions = {'biocli': 'v0.2.0', 'BioMCP': 'v0.8.19', 'gget': 'v0.30.3'}
    ax.set_xticklabels([f'{t}\n{versions[t]}' for t in tools], fontsize=10)

    plt.tight_layout()
    path = os.path.join(outdir, 'total_scores.png')
    fig.savefig(path)
    plt.close(fig)
    print(f'  Saved: {path}')

# ── Figure 2: Dimension Radar/Bar Comparison ─────────────────────────────────

def plot_dimensions(data, outdir):
    fig, ax = plt.subplots(figsize=(8, 4))

    dim_keys = [d[0] for d in DIMENSIONS]
    dim_labels = [d[1] for d in DIMENSIONS]

    x = np.arange(len(dim_keys))
    width = 0.25

    for i, tool in enumerate(TOOL_ORDER):
        cc = data[tool]['crossCutting']
        values = [cc.get(k, 0) for k in dim_keys]
        offset = (i - 1) * width
        bars = ax.bar(x + offset, values, width, label=tool, color=COLORS[tool],
                      edgecolor='white', linewidth=0.8)

        # Add value labels on top
        for bar, val in zip(bars, values):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.15,
                        str(val), ha='center', va='bottom', fontsize=8, color='#555555')

    ax.set_ylabel('Score (out of 10)', fontsize=11)
    ax.set_ylim(0, 12)
    ax.set_xticks(x)
    ax.set_xticklabels(dim_labels, fontsize=9)
    ax.set_title('Cross-Cutting Quality Dimensions', fontsize=13, fontweight='bold', pad=12)
    ax.legend(frameon=False, fontsize=10, loc='upper right')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(False)
    ax.tick_params(axis='x', length=0)

    plt.tight_layout()
    path = os.path.join(outdir, 'dimensions.png')
    fig.savefig(path)
    plt.close(fig)
    print(f'  Saved: {path}')

# ── Figure 3: Task Success by Category ───────────────────────────────────────

def plot_task_categories(data, outdir):
    categories = ['gene', 'variant', 'literature', 'data_preparation']
    cat_labels = ['Gene', 'Variant', 'Literature', 'Data\nPreparation']

    fig, ax = plt.subplots(figsize=(7, 3.8))

    x = np.arange(len(categories))
    width = 0.25

    for i, tool in enumerate(TOOL_ORDER):
        tasks = data[tool]['tasks']
        cat_scores = []
        cat_maxes = []
        for cat in categories:
            cat_tasks = [t for t in tasks if t['category'] == cat]
            score = sum(t['score'] for t in cat_tasks)
            maxs = sum(t['maxScore'] for t in cat_tasks)
            cat_scores.append(score)
            cat_maxes.append(maxs)

        # Normalize to percentage
        pcts = [s / m * 100 if m > 0 else 0 for s, m in zip(cat_scores, cat_maxes)]
        offset = (i - 1) * width
        bars = ax.bar(x + offset, pcts, width, label=tool, color=COLORS[tool],
                      edgecolor='white', linewidth=0.8)

        for bar, pct in zip(bars, pcts):
            if pct > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1.5,
                        f'{pct:.0f}%', ha='center', va='bottom', fontsize=7.5, color='#555555')

    ax.set_ylabel('Task Success Rate (%)', fontsize=11)
    ax.set_ylim(0, 115)
    ax.set_xticks(x)
    ax.set_xticklabels(cat_labels, fontsize=10)
    ax.set_title('Task Success by Category', fontsize=13, fontweight='bold', pad=12)
    ax.legend(frameon=False, fontsize=10, loc='upper right')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(False)
    ax.tick_params(axis='x', length=0)

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

    setup_style()
    data = load_data(date)

    print(f'Generating benchmark figures for {date}...')
    plot_total_scores(data, outdir)
    plot_dimensions(data, outdir)
    plot_task_categories(data, outdir)
    print('Done.')
