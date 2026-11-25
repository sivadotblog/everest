#!/usr/bin/env python3
"""
Generate per-ticker JSON files consumed by the SMA static site.

Reads the top N tickers from public/data/bullish_screen.json (produced by
`main.py leaderboard`) and reads their price history from the on-disk price
cache that step just filled (fetching from Yahoo only on a cache miss).

Run order: main.py leaderboard → generate_data.py

For each ticker:
  - Writes sma/data/{TICKER}.json:
        { "ticker": "TQQQ",
          "name": "ProShares UltraPro QQQ",
          "fetched_at": "2026-06-11T...",
          "start": "2021-06-11",
          "end":   "2026-06-10",
          "prices": [{"d": "2021-06-11", "c": 27.31}, ...]
        }

The threshold (+/-N%) is intentionally NOT precomputed — the browser recomputes
events whenever the user moves the threshold slider, so we only ship raw closes.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yaml

from name_cache import load_cached_names
from price_cache import load_cached_prices

_ROOT = Path(__file__).parent
_CONFIG = yaml.safe_load((_ROOT / "config.yaml").read_text())
_SITE = _CONFIG["site"]
LOOKBACK_YEARS: int = _SITE["lookback_years"]
TOP_N: int = _SITE["top_n"]
OUTPUT_DIR = _ROOT / "public" / "data"
SCREEN_PATH = OUTPUT_DIR / "bullish_screen.json"
MANIFEST_PATH = OUTPUT_DIR / "screen_manifest.json"


def _tickers_from_screen() -> list[str]:
    if not SCREEN_PATH.exists():
        raise SystemExit(
            f"'{SCREEN_PATH}' not found — run `main.py leaderboard` first."
        )
    data = json.loads(SCREEN_PATH.read_text())
    keep = _non_loser_tickers()
    if keep is None:
        results = data["results"]
    else:
        results = [r for r in data["results"] if r["ticker"] in keep]
        print(f"Skipping {len(data['results']) - len(results)} loser(s) "
              f"(loser at every threshold) — no chart data for them")
    tickers = [r["ticker"] for r in results[:TOP_N]]
    print(f"Top {TOP_N} tickers from bullish screen: {', '.join(tickers)}")
    return tickers


def _non_loser_tickers() -> set[str] | None:
    """Tickers that are not a loser at one or more thresholds — the leaderboard
    can link to their chart at some slider position. None when the screen
    manifest is missing (keep every ticker, as before)."""
    if not MANIFEST_PATH.exists():
        return None
    thresholds = json.loads(MANIFEST_PATH.read_text())["thresholds"]
    keep: set[str] = set()
    for n in thresholds:
        payload = json.loads((OUTPUT_DIR / f"bullish_screen_{n:g}pct.json").read_text())
        keep.update(r["ticker"] for r in payload["results"] if not r.get("loser"))
    return keep


def fetch_one(ticker: str, name: str) -> dict | None:
    """Build one chart payload from the price cache that `main.py leaderboard`
    filled minutes earlier, so this step makes no new Yahoo calls in CI.
    Returns None (and the ticker is skipped) when no price data is available,
    instead of aborting the whole build over one ticker."""
    df = load_cached_prices(ticker, years=LOOKBACK_YEARS)
    if df is None or df.empty:
        print(f"  !! no price data for {ticker}, skipping its chart")
        return None
    prices = [
        {"d": d.strftime("%Y-%m-%d"), "c": round(float(c), 4)}
        for d, c in zip(pd.to_datetime(df["date"]), df["close"])
    ]
    return {
        "ticker": ticker,
        "name": name,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "start": prices[0]["d"],
        "end": prices[-1]["d"],
        "prices": prices,
    }


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tickers = _tickers_from_screen()

    names = load_cached_names(tickers)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lookback_years": LOOKBACK_YEARS,
        "tickers": [],
    }

    print(f"Refreshing {len(tickers)} ticker(s) into {OUTPUT_DIR}")
    for ticker in tickers:
        payload = fetch_one(ticker, names[ticker])
        if payload is None:
            continue
        out = OUTPUT_DIR / f"{ticker}.json"
        # allow_nan=False: fail loudly here rather than shipping invalid JSON
        out.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
        print(f"     wrote {out} ({len(payload['prices']):,} rows)")
        manifest["tickers"].append({
            "ticker": ticker,
            "name": payload["name"],
            "start": payload["start"],
            "end": payload["end"],
            "rows": len(payload["prices"]),
        })

    if not manifest["tickers"]:
        raise SystemExit("No chart data could be built for any ticker.")
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote manifest -> {OUTPUT_DIR / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
