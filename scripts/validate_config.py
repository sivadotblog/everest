#!/usr/bin/env python3
"""
Validate config.yaml, and append issue-requested tickers to it safely.

Usage: uv run python scripts/validate_config.py [PATH]

Exits 0 when the config is valid, 1 (listing every problem) otherwise. The
add-ticker workflow runs it before pushing to main; validate-config.yml runs
it on every PR and push that touches config.yaml.
"""
from __future__ import annotations

import re
import sys
import textwrap
from datetime import date
from pathlib import Path

import yaml

CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"
# Issue-requested tickers live in this top-level section, which must stay the
# last one in the file so the bot can append at EOF. (It used to splice into
# the middle of the file before a comment anchor; the anchor also matched a
# comment inside `analyzer:`, and issue #9's RKLB broke the YAML on main.)
SECTION = "requested_stocks"
REQUIRED_SECTIONS = ("site", "analyzer", "universe")
TICKER_RE = re.compile(r"[A-Z0-9][A-Z0-9.\-]{0,5}")
# Record field -> type. `ticker` is required; the rest are optional.
RECORD_FIELDS = {"ticker": str, "name": str, "issue": int, "added": date}


def validate(cfg) -> list[str]:
    """Every schema problem in a parsed config; empty when it's valid."""
    if not isinstance(cfg, dict) or not cfg:
        return ["top level must be a non-empty mapping"]
    errors = [f"`{key}` must be a mapping" for key in REQUIRED_SECTIONS
              if not isinstance(cfg.get(key), dict)]
    if list(cfg)[-1] != SECTION:
        errors.append(f"`{SECTION}` must be the last top-level section")

    seen: dict[str, str] = {}

    def check_ticker(ticker, where: str) -> None:
        if not isinstance(ticker, str) or not TICKER_RE.fullmatch(ticker):
            errors.append(f"{where}: {ticker!r} is not a ticker symbol")
        elif ticker in seen:
            errors.append(f"{where}: {ticker} is already listed in {seen[ticker]}")
        else:
            seen[ticker] = where

    universe = cfg.get("universe")
    for category, tickers in (universe.items() if isinstance(universe, dict) else []):
        if not isinstance(tickers, list):
            errors.append(f"universe.{category} must be a list of tickers")
            continue
        for ticker in tickers:
            check_ticker(ticker, f"universe.{category}")

    records = cfg.get(SECTION)
    if records is None:
        records = []
    elif not isinstance(records, list):
        errors.append(f"`{SECTION}` must be a list of records")
        records = []
    for i, record in enumerate(records):
        where = f"{SECTION}[{i}]"
        if not isinstance(record, dict) or "ticker" not in record:
            errors.append(f"{where} must be a mapping with a `ticker` key")
            continue
        for field in record:
            if field not in RECORD_FIELDS:
                errors.append(f"{where}: unknown field `{field}`")
        for field, typ in RECORD_FIELDS.items():
            if field != "ticker" and field in record and not isinstance(record[field], typ):
                errors.append(f"{where}.{field} must be a {typ.__name__}")
        check_ticker(record["ticker"], where)
    return errors


def check_text(text: str) -> list[str]:
    """validate() for raw YAML; a parse error is reported, not raised."""
    try:
        cfg = yaml.safe_load(text)
    except yaml.YAMLError as e:
        return [f"not valid YAML: {' '.join(str(e).split())}"]
    return validate(cfg)


def append_requested_stock(text: str, record: dict) -> str:
    """Return `text` with `record` appended to the trailing requested_stocks
    list. The record is emitted by the YAML dumper (so e.g. `ON` is quoted
    rather than loading as a boolean) and the result is re-parsed. Raises
    ValueError unless that one record is the only change and the config is
    still valid."""
    if errors := check_text(text):
        raise ValueError("config.yaml is invalid before the edit: " + "; ".join(errors))
    before = yaml.safe_load(text)
    block = yaml.safe_dump([record], sort_keys=False, allow_unicode=True, width=1000)
    new_text = text.rstrip() + "\n" + textwrap.indent(block, "  ")
    if errors := check_text(new_text):
        raise ValueError("config.yaml would be invalid after the edit: " + "; ".join(errors))
    if yaml.safe_load(new_text) != {**before, SECTION: [*(before[SECTION] or []), record]}:
        raise ValueError(f"the edit would change config.yaml outside `{SECTION}`")
    return new_text


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else CONFIG_PATH
    errors = check_text(path.read_text())
    for error in errors:
        print(f"{path.name}: {error}", file=sys.stderr)
    if errors:
        sys.exit(1)
    print(f"{path.name}: OK")


if __name__ == "__main__":
    main()
