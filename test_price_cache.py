"""Offline tests for price_cache.append_missing_session_close."""

from __future__ import annotations

import pandas as pd

from price_cache import append_missing_session_close

TZ = "America/New_York"
# Fri 2026-10-16 regular session: 09:30 -> 16:00 ET
FRI_OPEN = int(pd.Timestamp("2026-10-16 09:30", tz=TZ).timestamp())
FRI_CLOSE = int(pd.Timestamp("2026-10-16 16:00", tz=TZ).timestamp())
FRI_EVENING = int(pd.Timestamp("2026-10-16 20:19", tz=TZ).timestamp())


def _hist(*rows: tuple[str, float]) -> pd.DataFrame:
    idx = pd.DatetimeIndex([pd.Timestamp(d, tz=TZ) for d, _ in rows], name="Date")
    return pd.DataFrame({"Close": [c for _, c in rows]}, index=idx)


def _meta(price: float, market_time: int) -> dict:
    return {
        "regularMarketPrice": price,
        "regularMarketTime": market_time,
        "exchangeTimezoneName": TZ,
        "currentTradingPeriod": {"regular": {"start": FRI_OPEN, "end": FRI_CLOSE}},
    }


def test_evening_fetch_missing_todays_bar_gets_the_close():
    # The CEG case: an evening run got bars through Thu while the quote
    # already said Fri closed at 271.37.
    hist = _hist(("2026-10-14", 279.54), ("2026-10-15", 275.0))
    out = append_missing_session_close(hist, _meta(271.37, FRI_CLOSE + 1), now=FRI_EVENING)
    assert out.index[-1] == pd.Timestamp("2026-10-16", tz=TZ)
    assert out["Close"].iloc[-1] == 271.37
    assert len(out) == 3


def test_last_trade_before_the_bell_still_counts():
    # Thin tickers can print their last trade at 15:59:59.
    hist = _hist(("2026-10-15", 10.0))
    out = append_missing_session_close(hist, _meta(10.5, FRI_CLOSE - 1), now=FRI_EVENING)
    assert out.index[-1] == pd.Timestamp("2026-10-16", tz=TZ)


def test_no_op_when_bar_already_present():
    hist = _hist(("2026-10-15", 275.0), ("2026-10-16", 271.37))
    out = append_missing_session_close(hist, _meta(271.37, FRI_CLOSE + 1), now=FRI_EVENING)
    assert out.equals(hist)


def test_no_op_while_session_is_open():
    # An intraday price is not a close.
    hist = _hist(("2026-10-15", 275.0))
    midday = int(pd.Timestamp("2026-10-16 12:00", tz=TZ).timestamp())
    out = append_missing_session_close(hist, _meta(273.0, midday), now=midday)
    assert out.equals(hist)


def test_no_op_on_missing_metadata():
    hist = _hist(("2026-10-15", 275.0))
    assert append_missing_session_close(hist, {}, now=FRI_EVENING).equals(hist)
    assert append_missing_session_close(hist, None, now=FRI_EVENING).equals(hist)
