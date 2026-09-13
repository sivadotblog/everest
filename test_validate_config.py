"""
Guards for config.yaml: schema validation and the add-ticker bot's append
into the trailing `requested_stocks` section. Issue #9: the bot spliced RKLB
before a text anchor that also matched a comment inside `analyzer:`, and the
malformed YAML landed on main.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import yaml

from scripts.validate_config import SECTION, append_requested_stock, check_text, validate

ROOT = Path(__file__).parent

# Mirrors config.yaml's layout, including the "# Leveraged ETFs" comment inside
# `analyzer:` that the old anchor matched first.
BASE = """\
site:
  top_n: 600
analyzer:
  min_events: 10
  # context columns, not the rank key.

  # Leveraged ETFs (TQQQ, SOXL, ...) are part of the universe.
  include_leveraged: true
universe:
  sp500:
    - AAPL
  # Leveraged ETFs — broad market (2x bull)
  leveraged_2x_broad:
    - SSO

# Requested via GitHub issues — keep this section last.
requested_stocks:
"""

RKLB = {"ticker": "RKLB", "name": "Rocket Lab Corporation", "issue": 9,
        "added": date(2026, 9, 13)}


def request(ticker: str, issue: int) -> dict:
    return {"ticker": ticker, "name": f"{ticker} Inc.", "issue": issue,
            "added": date(2026, 9, 14)}


def without_section(cfg: dict) -> dict:
    return {k: v for k, v in cfg.items() if k != SECTION}


def test_repo_config_is_valid():
    assert check_text((ROOT / "config.yaml").read_text()) == []


def test_old_anchor_splice_is_rejected():
    broken = BASE.replace("\n  # Leveraged ETFs", "\n    - RKLB\n  # Leveraged ETFs", 1)
    errors = check_text(broken)
    assert errors and "YAML" in errors[0]


def test_append_lands_in_trailing_section_only():
    text = append_requested_stock(BASE, RKLB)
    after = yaml.safe_load(text)
    assert after[SECTION] == [RKLB]
    assert without_section(after) == without_section(yaml.safe_load(BASE))
    assert text.startswith(BASE)  # existing bytes (comments included) untouched


def test_append_keeps_request_order():
    text = append_requested_stock(append_requested_stock(BASE, RKLB), request("CRWD", 10))
    assert [r["ticker"] for r in yaml.safe_load(text)[SECTION]] == ["RKLB", "CRWD"]


def test_append_quotes_yaml_keywords():
    # unquoted `ticker: ON` would load as True (a YAML 1.1 boolean)
    after = yaml.safe_load(append_requested_stock(BASE, request("ON", 11)))
    assert after[SECTION][0]["ticker"] == "ON"


def test_append_refuses_duplicate_ticker():
    with pytest.raises(ValueError, match="AAPL"):
        append_requested_stock(BASE, request("AAPL", 12))


def test_append_refuses_when_section_is_not_last():
    with pytest.raises(ValueError, match="last"):
        append_requested_stock(BASE + "extra: 1\n", RKLB)


def test_append_refuses_broken_config():
    broken = BASE.replace("  sp500:", "  sp500: [", 1)
    with pytest.raises(ValueError, match="invalid"):
        append_requested_stock(broken, RKLB)


@pytest.mark.parametrize("records", [
    ["RKLB"],                  # a bare ticker, not a record
    [{"tikcer": "RKLB"}],      # missing `ticker`
    [{**RKLB, "isue": 9}],     # unknown field
    [{**RKLB, "issue": "9"}],  # wrong type
])
def test_validate_rejects_malformed_records(records):
    cfg = {**yaml.safe_load(BASE), SECTION: records}
    assert validate(cfg)


def test_validate_rejects_yaml_boolean_ticker():
    # an unquoted `- ON` in a universe list loads as True
    assert check_text(BASE.replace("    - SSO", "    - ON"))


def test_universe_includes_requested_stocks():
    from main import _universe
    cfg = yaml.safe_load(append_requested_stock(BASE, RKLB))
    assert _universe(cfg, None) == ["AAPL", "RKLB", "SSO"]


def test_site_and_analyzer_lookback_years_match():
    # The chart explorer fits its trend line over site.lookback_years of
    # data while the leaderboard computes it over analyzer.lookback_years —
    # if they diverge, the leaderboard's "Trend growth" / "vs trend" columns
    # won't agree with what the chart shows for the same ticker.
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    assert cfg["site"]["lookback_years"] == cfg["analyzer"]["lookback_years"]
