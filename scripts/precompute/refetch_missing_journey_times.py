"""Fetch journey times for stations that currently have null values.

Quota-aware: rotates between API keys, respects daily caps, and saves progress
so it can be run on subsequent days to fill remaining gaps.

Usage:
  python -m scripts.precompute.refetch_missing_journey_times
  python -m scripts.precompute.refetch_missing_journey_times --dry-run   # show what would be fetched
  python -m scripts.precompute.refetch_missing_journey_times --limit 50  # fetch at most N calls

After running, re-run the completeness tests to verify:
  python -m pytest scripts/tests/test_pipeline_completeness.py -v
"""

import argparse
import json
import os
import time
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DATA_DIR = Path(__file__).parent.parent / "data"
TERMINI = ["KGX", "PAD", "WAT", "VIC", "LST", "BFR", "CST", "CHX", "EUS", "MYB", "STP"]
# Rough daily free-tier cap per key. Reduce if you keep hitting limits.
DAILY_CAP_PER_KEY = 100
# Delay between calls (seconds). Increase if hitting rate limits mid-run.
CALL_DELAY = 0.5


def load_env() -> None:
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def get_api_keys() -> list[tuple[str, str]]:
    keys = []
    primary_id = os.environ.get("TRANSPORT_API_APP_ID")
    primary_key = os.environ.get("TRANSPORT_API_APP_KEY")
    alt_id = os.environ.get("TRANSPORT_API_ALT_APP_ID")
    alt_key = os.environ.get("TRANSPORT_API_ALT_APP_KEY")
    if primary_id and primary_key:
        keys.append((primary_id, primary_key))
    if alt_id and alt_key:
        keys.append((alt_id, alt_key))
    return keys


def find_missing_pairs() -> list[tuple[str, str]]:
    """Return (remote_crs, terminus_crs) pairs where journey_minutes is null."""
    missing = []
    for terminus in TERMINI:
        path = DATA_DIR / f"journey_times_{terminus}.json"
        if not path.exists():
            continue
        with open(path) as f:
            data = json.load(f)
        for entry in data:
            if entry.get("journey_minutes") is None:
                missing.append((entry["remote_crs"], terminus))
    return missing


def update_journey_time(remote_crs: str, terminus_crs: str, minutes: int) -> None:
    path = DATA_DIR / f"journey_times_{terminus_crs}.json"
    with open(path) as f:
        data = json.load(f)
    for entry in data:
        if entry["remote_crs"] == remote_crs:
            entry["journey_minutes"] = minutes
            break
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def fetch_one(
    remote_crs: str, terminus_crs: str, app_id: str, app_key: str, session: requests.Session
) -> int | None:
    """Call Transport API timetable endpoint. Returns journey minutes or None."""
    from scripts.precompute.fetch_journey_times import fetch_journey_time
    result = fetch_journey_time(remote_crs, terminus_crs, app_id, app_key, session=session)
    return result.get("journey_minutes")


def main() -> None:
    load_env()

    parser = argparse.ArgumentParser(description="Fetch missing journey times")
    parser.add_argument("--dry-run", action="store_true", help="Print gaps without fetching")
    parser.add_argument("--limit", type=int, default=None, help="Max API calls to make")
    args = parser.parse_args()

    missing = find_missing_pairs()
    print(f"Found {len(missing)} (station, terminus) pairs with null journey times")

    if args.dry_run:
        # Show which stations have the most gaps
        from collections import Counter
        station_gaps = Counter(crs for crs, _ in missing)
        terminus_gaps = Counter(t for _, t in missing)
        print("\nTop stations with most nulls:")
        for crs, count in station_gaps.most_common(20):
            print(f"  {crs}: {count} null termini")
        print("\nTermini with most nulls:")
        for t, count in terminus_gaps.most_common():
            print(f"  {t}: {count} null stations")
        return

    api_keys = get_api_keys()
    if not api_keys:
        print("ERROR: No Transport API keys found in .env")
        return

    session = requests.Session()
    calls_made = 0
    updated = 0
    key_idx = 0
    cap_per_key = [0] * len(api_keys)

    limit = args.limit or (DAILY_CAP_PER_KEY * len(api_keys))
    print(f"Will make up to {limit} API calls using {len(api_keys)} key(s)")
    print(f"Delay: {CALL_DELAY}s between calls\n")

    for remote_crs, terminus_crs in missing:
        if calls_made >= limit:
            print(f"\nReached call limit ({limit}). Re-run tomorrow for remaining gaps.")
            break

        # Rotate key if current one is over its cap
        if cap_per_key[key_idx] >= DAILY_CAP_PER_KEY:
            key_idx = (key_idx + 1) % len(api_keys)
            if cap_per_key[key_idx] >= DAILY_CAP_PER_KEY:
                print("\nAll API key daily caps reached. Re-run tomorrow.")
                break

        app_id, app_key = api_keys[key_idx]
        result = fetch_one(remote_crs, terminus_crs, app_id, app_key, session)
        calls_made += 1
        cap_per_key[key_idx] += 1

        if result is not None:
            update_journey_time(remote_crs, terminus_crs, result)
            updated += 1
            print(f"  ✓ {remote_crs} → {terminus_crs}: {result} min")
        else:
            print(f"  - {remote_crs} → {terminus_crs}: no service found")

        time.sleep(CALL_DELAY)

    remaining = len(missing) - calls_made
    print(f"\nDone. Calls made: {calls_made} | Updated: {updated} | Still null: {len(missing) - updated}")
    if remaining > 0:
        print(f"Remaining pairs to check: {remaining} — run again tomorrow")


if __name__ == "__main__":
    main()
