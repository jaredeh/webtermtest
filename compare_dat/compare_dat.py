#!/usr/bin/env python3
"""Compare vtebench gnuplot .dat files with matplotlib/seaborn."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

PALETTE = {
    "ghostty-ubuntu": "#26a269",
    "ghostty-web": "#3584e7",
    "ghostty-wterm": "#986a44",
    "gnometerminal": "#613583",
    "xtermjs": "#e66100",
}

SIZE_SUFFIX = re.compile(r"_\d+x\d+$")
REPO_ROOT = Path(__file__).resolve().parent.parent

BENCHMARK_ORDER: list[str] | None = None


def resolve_repo_path(path: Path) -> Path:
    """Resolve paths from repo root when run via `uv run --directory scripts`."""
    if path.is_absolute():
        return path
    if path.exists():
        return path.resolve()
    from_repo_root = REPO_ROOT / path
    if from_repo_root.exists() or path == Path("compare-output"):
        return from_repo_root
    return (REPO_ROOT / path).resolve()


def terminal_label(stem: str) -> str:
    """Strip terminal size suffixes for cleaner chart labels."""
    return SIZE_SUFFIX.sub("", stem)


def parse_dat(path: Path) -> pd.DataFrame:
    """Load a .dat file into a long-format DataFrame."""
    lines = path.read_text().splitlines()
    if not lines:
        raise ValueError(f"{path}: empty file")

    benchmarks = lines[0].split()
    terminal = terminal_label(path.stem)
    rows: list[dict[str, object]] = []

    for line in lines[1:]:
        if not line.strip():
            continue
        values = line.split()
        for benchmark, value in zip(benchmarks, values, strict=False):
            if value == "_":
                continue
            rows.append(
                {
                    "terminal": terminal,
                    "benchmark": benchmark,
                    "ms": float(value),
                }
            )

    return pd.DataFrame(rows)


def vtebench_percentile(samples: np.ndarray, percentile: int) -> float:
    """Match vtebench's percentile calculation."""
    percentile = min(percentile, 100)
    sorted_samples = np.sort(samples)
    index = max(0, ((len(sorted_samples) * percentile + 99) // 100) - 1)
    return float(sorted_samples[index])


def vtebench_median(samples: np.ndarray) -> float:
    """Match vtebench's median calculation."""
    sorted_samples = np.sort(samples)
    length = len(sorted_samples)
    return float(
        (sorted_samples[(length - 1) // 2] + sorted_samples[length // 2]) / 2.0
    )


def vtebench_stddev(samples: np.ndarray) -> float:
    """Match vtebench's sample standard deviation."""
    if len(samples) < 2:
        return 0.0
    return float(np.std(samples, ddof=1))


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    """Compute per-terminal, per-benchmark statistics."""
    records: list[dict[str, object]] = []

    for (terminal, benchmark), group in df.groupby(["terminal", "benchmark"], sort=False):
        samples = group["ms"].to_numpy()
        records.append(
            {
                "terminal": terminal,
                "benchmark": benchmark,
                "samples": len(samples),
                "mean_ms": round(samples.mean(), 2),
                "median_ms": round(vtebench_median(samples), 2),
                "p90_ms": round(vtebench_percentile(samples, 90), 2),
                "stddev_ms": round(vtebench_stddev(samples), 2),
            }
        )

    summary = pd.DataFrame(records)
    if BENCHMARK_ORDER:
        summary["benchmark"] = pd.Categorical(
            summary["benchmark"], categories=BENCHMARK_ORDER, ordered=True
        )
        summary = summary.sort_values(["benchmark", "terminal"])
    return summary


def speedup_table(summary: pd.DataFrame, baseline: str) -> pd.DataFrame:
    """Ratio of each terminal's mean to the baseline mean (>1 means slower)."""
    means = summary.pivot(index="benchmark", columns="terminal", values="mean_ms")
    if baseline not in means.columns:
        raise ValueError(f"baseline '{baseline}' not found in results")

    ratios = means.div(means[baseline], axis=0)
    ratios = ratios.round(2)
    ratios.columns = [f"{col}×" for col in ratios.columns]
    return ratios


def configure_style() -> None:
    sns.set_theme(style="whitegrid", context="talk", font_scale=0.9)
    plt.rcParams.update(
        {
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "savefig.facecolor": "white",
            "savefig.dpi": 150,
            "font.family": "sans-serif",
        }
    )


def terminal_colors(terminals: list[str]) -> dict[str, str]:
    colors = {}
    fallback = sns.color_palette("colorblind", n_colors=len(terminals))
    for index, terminal in enumerate(terminals):
        colors[terminal] = PALETTE.get(terminal, fallback[index])
    return colors


def plot_boxplots(df: pd.DataFrame, output: Path) -> None:
    terminals = list(df["terminal"].unique())
    colors = terminal_colors(terminals)

    fig, ax = plt.subplots(figsize=(14, 7))
    sns.boxplot(
        data=df,
        x="benchmark",
        y="ms",
        hue="terminal",
        palette=colors,
        linewidth=1.2,
        fliersize=2,
        ax=ax,
    )
    ax.set_title("vtebench comparison — sample distribution", pad=16, fontweight="bold")
    ax.set_xlabel("")
    ax.set_ylabel("milliseconds (lower is better)")
    ax.tick_params(axis="x", rotation=35)
    plt.setp(ax.get_xticklabels(), ha="right")
    ax.legend(title="terminal", frameon=True, loc="upper right")
    fig.tight_layout()
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)


def plot_benchmark_boxplots(df: pd.DataFrame, output_dir: Path) -> list[Path]:
    """Write one boxplot PNG per benchmark."""
    benchmarks = BENCHMARK_ORDER or sorted(df["benchmark"].unique())
    terminals = list(df["terminal"].unique())
    colors = terminal_colors(terminals)
    output_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for benchmark in benchmarks:
        subset = df[df["benchmark"] == benchmark]
        if subset.empty:
            continue

        fig, ax = plt.subplots(figsize=(8, 6))
        sns.boxplot(
            data=subset,
            x="terminal",
            y="ms",
            hue="terminal",
            order=terminals,
            hue_order=terminals,
            palette=colors,
            legend=False,
            showfliers=False,
            linewidth=1.2,
            ax=ax,
        )
        ax.set_title(benchmark, pad=16, fontweight="bold")
        ax.set_xlabel("")
        ax.set_ylabel("milliseconds (lower is better)")
        ax.tick_params(axis="x", rotation=20)
        plt.setp(ax.get_xticklabels(), ha="right")
        fig.tight_layout()

        output = output_dir / f"{benchmark}.png"
        fig.savefig(output, bbox_inches="tight")
        plt.close(fig)
        written.append(output)

    return written


def plot_mean_bars(summary: pd.DataFrame, output: Path) -> None:
    terminals = list(summary["terminal"].unique())
    colors = terminal_colors(terminals)

    fig, ax = plt.subplots(figsize=(14, 7))
    sns.barplot(
        data=summary,
        x="benchmark",
        y="mean_ms",
        hue="terminal",
        palette=colors,
        errorbar=None,
        ax=ax,
    )

    for container, terminal in zip(ax.containers, terminals, strict=False):
        terminal_summary = summary[summary["terminal"] == terminal]
        stddevs = terminal_summary.set_index("benchmark").loc[
            [tick.get_text() for tick in ax.get_xticklabels()], "stddev_ms"
        ]
        ax.errorbar(
            x=[bar.get_x() + bar.get_width() / 2 for bar in container],
            y=[bar.get_height() for bar in container],
            yerr=stddevs.to_numpy(),
            fmt="none",
            ecolor="#333333",
            elinewidth=1.2,
            capsize=3,
        )

    ax.set_title("vtebench comparison — mean ± stddev", pad=16, fontweight="bold")
    ax.set_xlabel("")
    ax.set_ylabel("milliseconds (lower is better)")
    ax.tick_params(axis="x", rotation=35)
    plt.setp(ax.get_xticklabels(), ha="right")
    ax.legend(title="terminal", frameon=True, loc="upper right")
    fig.tight_layout()
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)


def plot_speedup_heatmap(ratios: pd.DataFrame, baseline: str, output: Path) -> None:
    heatmap_data = ratios.drop(columns=[f"{baseline}×"], errors="ignore")

    fig, ax = plt.subplots(figsize=(8, 9))
    sns.heatmap(
        heatmap_data,
        annot=True,
        fmt=".2f",
        cmap="RdYlGn_r",
        vmin=0.5,
        vmax=max(3.0, heatmap_data.to_numpy().max()),
        linewidths=0.5,
        linecolor="white",
        cbar_kws={"label": f"× slower than {baseline}"},
        ax=ax,
    )
    ax.set_title(
        f"Speedup vs {baseline} (mean ms ratio)",
        pad=16,
        fontweight="bold",
    )
    ax.set_xlabel("")
    ax.set_ylabel("")
    fig.tight_layout()
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)


def plot_summary_table(summary: pd.DataFrame, output: Path) -> None:
    display = summary.copy()
    display = display.rename(
        columns={
            "terminal": "Terminal",
            "benchmark": "Benchmark",
            "samples": "N",
            "mean_ms": "Mean",
            "median_ms": "Median",
            "p90_ms": "P90",
            "stddev_ms": "Stddev",
        }
    )

    fig_height = 0.35 * len(display) + 1.5
    fig, ax = plt.subplots(figsize=(14, fig_height))
    ax.axis("off")

    table = ax.table(
        cellText=display.values,
        colLabels=display.columns,
        loc="center",
        cellLoc="center",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1, 1.4)

    for (row, _col), cell in table.get_celld().items():
        if row == 0:
            cell.set_facecolor("#2e3436")
            cell.set_text_props(color="white", fontweight="bold")
        elif row % 2 == 0:
            cell.set_facecolor("#f6f5f4")

    ax.set_title("vtebench summary statistics", pad=20, fontweight="bold")
    fig.tight_layout()
    fig.savefig(output, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "dat_files",
        nargs="+",
        type=Path,
        help="vtebench .dat files to compare",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("compare-output"),
        help="output directory (default: compare-output)",
    )
    parser.add_argument(
        "--baseline",
        type=str,
        default=None,
        help="terminal name for speedup heatmap baseline (default: first file stem)",
    )
    args = parser.parse_args()

    configure_style()
    output_dir = resolve_repo_path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    dat_files = [resolve_repo_path(path) for path in args.dat_files]
    frames = [parse_dat(path) for path in dat_files]
    df = pd.concat(frames, ignore_index=True)

    global BENCHMARK_ORDER
    BENCHMARK_ORDER = list(dat_files[0].read_text().splitlines()[0].split())

    summary = summarize(df)
    baseline = terminal_label(args.baseline or dat_files[0].stem)
    ratios = speedup_table(summary, baseline)

    summary.to_csv(output_dir / "summary.csv", index=False)
    ratios.to_csv(output_dir / "speedup.csv")

    plot_boxplots(df, output_dir / "boxplot.png")
    benchmark_plots = plot_benchmark_boxplots(df, output_dir / "boxplots")
    plot_mean_bars(summary, output_dir / "mean_bars.png")
    plot_speedup_heatmap(ratios, baseline, output_dir / "speedup_heatmap.png")
    plot_summary_table(summary, output_dir / "summary_table.png")

    print(f"Wrote comparison outputs to {output_dir}/")
    for name in (
        "boxplot.png",
        "mean_bars.png",
        "speedup_heatmap.png",
        "summary_table.png",
        "summary.csv",
        "speedup.csv",
    ):
        print(f"  {name}")
    print(f"  boxplots/ ({len(benchmark_plots)} files)")
    for path in benchmark_plots:
        print(f"    {path.name}")


if __name__ == "__main__":
    main()