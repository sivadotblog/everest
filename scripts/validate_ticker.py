#!/usr/bin/env python3
"""
Validate a ticker against Yahoo Finance and append it to config.yaml's
requested_stocks section.

Usage: uv run python scripts/validate_ticker.py TICKER [ISSUE_NUMBER]

Exits 0 on success, 1 on failure.
Sets GITHUB_OUTPUT variables: added, name, reason.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
import yaml

from validate_config import SECTION, TICKER_RE, append_requested_stock, check_text

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


def set_output(key: str, value: str) -> None:
    value = " ".join(value.splitlines())  # GITHUB_OUTPUT takes one key=value per line
    gho = os.environ.get("GITHUB_OUTPUT", "")
    if gho:
        with open(gho, "a") as f:
            f.write(f"{key}={value}\n")
    print(f"[output] {key}={value}")


def fail(reason: str) -> None:
    set_output("added", "false")
    set_output("reason", reason)
    print(f"FAIL: {reason}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        fail("No ticker provided")

    ticker = sys.argv[1].strip().upper()
    issue = int(sys.argv[2]) if len(sys.argv) > 2 else None

    # Basic format check — letters/digits, optional dot (BRK.B) or hyphen
    if not TICKER_RE.fullmatch(ticker):
        fail(f"`{ticker}` doesn't look like a valid ticker symbol")

    # Refuse to build on a config that is already broken
    config_text = CONFIG_PATH.read_text()
    if errors := check_text(config_text):
        fail(f"config.yaml is invalid, fix it before adding tickers: {'; '.join(errors)}")

    # Check not already in config
    config = yaml.safe_load(config_text)
    universe = config.get("universe", {})
    existing = {str(t).upper() for tickers in universe.values() for t in tickers}
    existing |= {r["ticker"] for r in config[SECTION] or []}
    if ticker in existing:
        fail(f"`{ticker}` is already in the screening universe")

    # Validate with Yahoo Finance — require real exchange listing and recent volume
    print(f"Validating {ticker} on Yahoo Finance …")
    try:
        t = yf.Ticker(ticker)
        info = t.info
    except Exception as e:
        fail(f"Yahoo Finance error for `{ticker}`: {e}")

    # Must be a real listed security with a live price
    quote_type = info.get("quoteType", "")
    price = info.get("regularMarketPrice") or info.get("currentPrice") or 0

    VALID_QUOTE_TYPES = {"EQUITY", "ETF", "MUTUALFUND"}
    if quote_type not in VALID_QUOTE_TYPES:
        fail(f"`{ticker}` is not a listed equity or ETF (quoteType={quote_type or 'unknown'})")

    if price == 0:
        fail(f"`{ticker}` has no current market price — may be delisted or invalid")

    # For equities only: require at least $50M market cap to filter OTC shells
    market_cap = info.get("marketCap") or 0
    if quote_type == "EQUITY" and market_cap < 50_000_000:
        fail(f"`{ticker}` market cap ${market_cap:,.0f} is too small — not suitable for this screener")

    name = info.get("longName") or info.get("shortName") or ticker

    # Append a record to requested_stocks (the file's last section). Refuses
    # any edit that would touch another section or leave the YAML invalid.
    record = {"ticker": ticker, "name": name}
    if issue is not None:
        record["issue"] = issue
    record["added"] = datetime.now(timezone.utc).date()
    try:
        new_text = append_requested_stock(config_text, record)
    except ValueError as e:
        fail(str(e))
    CONFIG_PATH.write_text(new_text)

    set_output("added", "true")
    set_output("name", name or ticker)
    print(f"✅ Added {ticker} ({name}) to {SECTION}")


if __name__ == "__main__":
    main()
