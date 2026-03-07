"""Orchestrated runner for full pre-computation pipeline.

Handles:
- Loading .env file for credentials
- Fetching journey times for all termini (with checkpointing)
- Computing isochrones for all termini × time buckets (with checkpointing)
- Resume capability: skips already-completed work

Usage:
  python scripts/precompute/run_all.py                    # run everything
  python scripts/precompute/run_all.py --step fetch       # fetch journey times only
  python scripts/precompute/run_all.py --step compute     # compute isochrones only
  python scripts/precompute/run_all.py --terminus KGX     # single terminus only
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Load .env file from project root
def load_dotenv():
    """Load environment variables from .env file in project root."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    if not env_path.exists():
        print(f"Warning: {env_path} not found")
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)


load_dotenv()

from scripts.precompute.fetch_journey_times import (
    fetch_all_journey_times,
    load_stations,
    save_journey_times,
)
from scripts.precompute.compute_isochrones import (
    LONDON_TERMINI,
    compute_isochrone,
    save_geojson,
)

TIME_BUCKETS = [30, 45, 60, 75, 90, 120]
STATIONS_PATH = str(Path(__file__).parent / "stations.json")
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "output"
CHECKPOINT_FILE = DATA_DIR / "checkpoint.json"


def load_checkpoint() -> dict:
    """Load checkpoint file to track completed work."""
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"fetched_termini": [], "computed": []}


def save_checkpoint(checkpoint: dict) -> None:
    """Save checkpoint to track progress."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(checkpoint, f, indent=2)


def step_fetch(termini: list[str]) -> None:
    """Fetch journey times for specified termini."""
    app_id = os.environ.get("TRANSPORT_API_APP_ID")
    app_key = os.environ.get("TRANSPORT_API_APP_KEY")

    if not app_id or not app_key:
        print("ERROR: TRANSPORT_API_APP_ID and TRANSPORT_API_APP_KEY must be set")
        print("       Add them to .env or export them in your shell")
        sys.exit(1)

    stations = load_stations(STATIONS_PATH)
    checkpoint = load_checkpoint()
    print(f"Loaded {len(stations)} stations")

    for terminus in termini:
        if terminus in checkpoint["fetched_termini"]:
            print(f"[SKIP] {terminus} already fetched")
            continue

        print(f"\n{'='*60}")
        print(f"Fetching journey times for {LONDON_TERMINI.get(terminus, terminus)} ({terminus})")
        print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Stations: {len(stations)}, estimated time: {len(stations) * 0.2 / 60:.1f} min")
        print(f"{'='*60}")

        results = fetch_all_journey_times(terminus, stations, app_id, app_key, delay=0.2)

        output_path = str(DATA_DIR / f"journey_times_{terminus}.json")
        save_journey_times(results, output_path)

        reachable = sum(1 for r in results if r["journey_minutes"] is not None)
        print(f"Done: {reachable}/{len(results)} stations reachable from {terminus}")

        checkpoint["fetched_termini"].append(terminus)
        save_checkpoint(checkpoint)
        print(f"Checkpoint saved. Safe to interrupt.")


def step_compute(termini: list[str]) -> None:
    """Compute isochrones for specified termini × all time buckets."""
    ors_api_key = os.environ.get("ORS_API_KEY", "")
    ors_base_url = os.environ.get("ORS_BASE_URL")  # e.g. http://localhost:8080/ors/v2

    if not ors_api_key and not ors_base_url:
        print("ERROR: Set ORS_API_KEY (public API) or ORS_BASE_URL (local instance)")
        print("       For local Docker: ORS_BASE_URL=http://localhost:8080/ors/v2")
        sys.exit(1)

    if ors_base_url:
        print(f"Using local ORS instance: {ors_base_url}")
        delay = 0.05  # local instance — no rate limit
    else:
        print("Using public ORS API (rate limited)")
        delay = 1.5

    checkpoint = load_checkpoint()

    for terminus in termini:
        # Load journey times for this terminus
        jt_path = DATA_DIR / f"journey_times_{terminus}.json"
        if not jt_path.exists():
            print(f"[SKIP] No journey times for {terminus}. Run --step fetch first.")
            continue

        with open(jt_path) as f:
            journey_times = json.load(f)

        terminus_name = LONDON_TERMINI.get(terminus, terminus)

        for budget in TIME_BUCKETS:
            combo_key = f"{terminus}/{budget}"
            if combo_key in checkpoint["computed"]:
                print(f"[SKIP] {combo_key} already computed")
                continue

            print(f"\n{'='*60}")
            print(f"Computing: {terminus_name} ({terminus}), {budget} min")
            print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

            result = compute_isochrone(
                terminus_crs=terminus,
                terminus_name=terminus_name,
                time_budget=budget,
                journey_times=journey_times,
                ors_api_key=ors_api_key,
                delay=delay,
                ors_base_url=ors_base_url,
            )

            output_path = str(OUTPUT_DIR / "isochrones" / terminus / f"{budget}.geojson")
            save_geojson(result, output_path)

            station_count = result["features"][0]["properties"]["station_count"]
            print(f"Done: {station_count} stations, saved to {output_path}")

            checkpoint["computed"].append(combo_key)
            save_checkpoint(checkpoint)
            print(f"Checkpoint saved. Safe to interrupt.")

            # Brief pause between combinations
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description="Run full IsoHome pre-computation pipeline")
    parser.add_argument(
        "--step",
        choices=["fetch", "compute", "all"],
        default="all",
        help="Which step to run (default: all)",
    )
    parser.add_argument(
        "--terminus",
        help="Single terminus CRS code (default: all 10)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Reset checkpoint and start fresh",
    )
    args = parser.parse_args()

    if args.reset and CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        print("Checkpoint reset.")

    termini = [args.terminus] if args.terminus else list(LONDON_TERMINI.keys())

    print(f"IsoHome Pre-computation Pipeline")
    print(f"Termini: {', '.join(termini)}")
    print(f"Step: {args.step}")
    print()

    if args.step in ("fetch", "all"):
        step_fetch(termini)

    if args.step in ("compute", "all"):
        step_compute(termini)

    print(f"\nPipeline complete!")
    checkpoint = load_checkpoint()
    print(f"Fetched: {len(checkpoint['fetched_termini'])}/10 termini")
    print(f"Computed: {len(checkpoint['computed'])}/60 isochrones")


if __name__ == "__main__":
    main()
