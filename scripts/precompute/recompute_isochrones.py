"""Resilient isochrone recomputation — handles ORS crashes with auto-restart.

Processes one terminus at a time with health checks and Docker restart logic
to work around ORS OOM issues with the full GB road graph.

Usage:
  python scripts/precompute/recompute_isochrones.py
  python scripts/precompute/recompute_isochrones.py --terminus PAD
  python scripts/precompute/recompute_isochrones.py --skip KGX  # skip already-good ones
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Load .env
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

import requests
from scripts.precompute.compute_isochrones import (
    LONDON_TERMINI,
    compute_isochrone,
    save_geojson,
)

TIME_BUCKETS = [30, 45, 60, 75, 90, 120]
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "output"
ORS_BASE_URL = os.environ.get("ORS_BASE_URL", "http://localhost:8080/ors/v2")
ORS_API_KEY = os.environ.get("ORS_API_KEY", "")
CONTAINER_NAME = "ors-app"


def ors_is_healthy() -> bool:
    try:
        r = requests.get(f"{ORS_BASE_URL}/status", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def restart_ors(wait_ready: int = 120) -> bool:
    print(f"  Restarting ORS container '{CONTAINER_NAME}'...")
    subprocess.run(["docker", "restart", CONTAINER_NAME], capture_output=True)
    for i in range(wait_ready):
        time.sleep(1)
        if ors_is_healthy():
            print(f"  ORS healthy after {i+1}s")
            return True
        if (i + 1) % 15 == 0:
            print(f"  Waiting for ORS... {i+1}s")
    print("  ERROR: ORS did not become healthy")
    return False


def ensure_ors_healthy() -> bool:
    if ors_is_healthy():
        return True
    return restart_ors()


def has_real_data(terminus: str, budget: int) -> bool:
    path = OUTPUT_DIR / "isochrones" / terminus / f"{budget}.geojson"
    if not path.exists():
        return False
    try:
        with open(path) as f:
            d = json.load(f)
        coords = d["features"][0]["geometry"].get("coordinates", [])
        return len(coords) > 0
    except Exception:
        return False


def compute_one_terminus(terminus: str, journey_times: list, force: bool = False) -> tuple[int, int]:
    terminus_name = LONDON_TERMINI.get(terminus, terminus)
    success = 0
    failed = 0

    for budget in TIME_BUCKETS:
        if not force and has_real_data(terminus, budget):
            print(f"  [SKIP] {terminus}/{budget} — already has data")
            success += 1
            continue

        if not ensure_ors_healthy():
            print(f"  [FAIL] {terminus}/{budget} — ORS unavailable")
            failed += len(TIME_BUCKETS) - TIME_BUCKETS.index(budget)
            break

        print(f"  Computing {terminus}/{budget}min...", end=" ", flush=True)
        result = compute_isochrone(
            terminus_crs=terminus,
            terminus_name=terminus_name,
            time_budget=budget,
            journey_times=journey_times,
            ors_api_key=ORS_API_KEY,
            delay=0.5,  # slower to reduce memory pressure
            ors_base_url=ORS_BASE_URL,
        )

        coords = result["features"][0]["geometry"].get("coordinates", [])
        station_count = result["features"][0]["properties"]["station_count"]

        if len(coords) > 0:
            output_path = str(OUTPUT_DIR / "isochrones" / terminus / f"{budget}.geojson")
            save_geojson(result, output_path)
            size_kb = os.path.getsize(output_path) / 1024
            print(f"OK ({station_count} stations, {len(coords)} polys, {size_kb:.0f}KB)")
            success += 1
        else:
            if station_count == 0:
                # No reachable stations at this budget — empty is correct
                output_path = str(OUTPUT_DIR / "isochrones" / terminus / f"{budget}.geojson")
                save_geojson(result, output_path)
                print(f"OK (0 reachable stations)")
                success += 1
            else:
                print(f"EMPTY ({station_count} stations but no polygons — ORS may have failed)")
                failed += 1

        # Pause between requests to let ORS GC
        time.sleep(2)

    return success, failed


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Resilient isochrone recomputation")
    parser.add_argument("--terminus", help="Single terminus to compute")
    parser.add_argument("--skip", nargs="*", default=[], help="Termini to skip")
    parser.add_argument("--force", action="store_true", help="Recompute even if data exists")
    args = parser.parse_args()

    if args.terminus:
        termini = [args.terminus]
    else:
        termini = [t for t in LONDON_TERMINI if t not in args.skip]

    print(f"Recomputing isochrones for: {', '.join(termini)}")
    print(f"ORS: {ORS_BASE_URL}")
    print()

    if not ensure_ors_healthy():
        print("Cannot start — ORS is not available")
        sys.exit(1)

    total_success = 0
    total_failed = 0

    for terminus in termini:
        jt_path = DATA_DIR / f"journey_times_{terminus}.json"
        if not jt_path.exists():
            print(f"\n[SKIP] {terminus} — no journey times file")
            continue

        with open(jt_path) as f:
            journey_times = json.load(f)

        print(f"\n{'='*50}")
        print(f"{LONDON_TERMINI.get(terminus, terminus)} ({terminus})")
        print(f"{'='*50}")

        s, f_ = compute_one_terminus(terminus, journey_times, force=args.force)
        total_success += s
        total_failed += f_

        # Let ORS breathe between termini
        time.sleep(5)

    print(f"\n{'='*50}")
    print(f"Done: {total_success} succeeded, {total_failed} failed out of {len(termini) * len(TIME_BUCKETS)}")


if __name__ == "__main__":
    main()
