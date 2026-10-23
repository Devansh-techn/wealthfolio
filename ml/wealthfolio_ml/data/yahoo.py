"""Downloader for daily history from the SAME unofficial Yahoo chart endpoint the app's Edge Functions use
(supabase/functions/_shared/yahoo.ts). Unofficial, may be rate-limited or change without notice.
Adjusted close (splits + dividends) is used for returns; if unavailable, close is used and flagged.
"""
from __future__ import annotations

import time

import pandas as pd
import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


class DataUnavailable(Exception):
    pass


def fetch_history(symbol: str, range_: str = "10y", retries: int = 3, session: requests.Session | None = None, sleep=time.sleep) -> tuple[pd.DataFrame, dict]:
    s = session or requests
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol, safe='')}"
    last = ""
    for attempt in range(retries):
        try:
            res = s.get(url, params={"range": range_, "interval": "1d", "includePrePost": "false", "events": "div,splits"}, headers={"User-Agent": UA}, timeout=20)
            if res.status_code == 404:
                raise DataUnavailable(f"{symbol}: symbol not found")
            if res.status_code != 200:
                last = f"HTTP {res.status_code}"
                sleep(1.5 * (attempt + 1))
                continue
            body = res.json()
            r = (body.get("chart", {}).get("result") or [None])[0]
            if not r:
                raise DataUnavailable(f"{symbol}: {body.get('chart', {}).get('error')}")
            ts = r.get("timestamp") or []
            q = (r.get("indicators", {}).get("quote") or [{}])[0]
            adj = ((r.get("indicators", {}).get("adjclose") or [{}])[0]).get("adjclose")
            offset = int((r.get("meta") or {}).get("gmtoffset") or 0)
            df = pd.DataFrame({
                "date": pd.to_datetime(pd.Series(ts) + offset, unit="s").dt.normalize(),
                "close": q.get("close"),
                "adj_close": adj if adj is not None else q.get("close"),
                "volume": q.get("volume"),
            })
            meta = {"symbol": symbol, "source": "yahoo-chart-v8 (unofficial)", "fetched_at": pd.Timestamp.now(tz="UTC").isoformat(),
                    "price_basis": "adjclose" if adj is not None else "close", "currency": (r.get("meta") or {}).get("currency")}
            return df.dropna(subset=["adj_close"]), meta
        except DataUnavailable:
            raise
        except Exception as e:  # network / parsing
            last = str(e)[:120]
            sleep(1.5 * (attempt + 1))
    raise DataUnavailable(f"{symbol}: provider unavailable ({last})")
