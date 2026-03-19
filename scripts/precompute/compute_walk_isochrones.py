"""Compute walk-time isochrone polygons using the ORS foot-walking profile.

Works identically to compute_isochrones.py (driving-car) but uses the
foot-walking ORS profile and caps the per-station walk budget.

Usage:
  python -m scripts.precompute.compute_walk_isochrones          # all termini
  python -m scripts.precompute.compute_walk_isochrones --terminus KGX
  python -m scripts.precompute.compute_walk_isochrones --skip KGX PAD
  python -m scripts.precompute.compute_walk_isochrones --force   # recompute existing
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

# Load .env from project root
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

from scripts.precompute.compute_isochrones import (
    LONDON_TERMINI,
    filter_reachable_stations,
    save_geojson,
)
from scripts.precompute.enrich_isochrones import TERMINUS_COORDS
from scripts.precompute.compute_rail_routes import build_rail_graph, compute_rail_route

TIME_BUCKETS = [30, 45, 60, 75, 90, 120]
WALK_CAP_MINUTES = 15       # max walk budget per station (minutes)
MIN_WALK_BUFFER = 5         # stations need at least this many minutes remaining
ORS_BASE_URL = os.environ.get("ORS_BASE_URL", "http://localhost:8080/ors/v2")
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "output"
RAIL_LINES_PATH = OUTPUT_DIR / "static" / "rail-lines.geojson"
CONTAINER_NAME = "ors-app"


def ors_walk_is_healthy() -> bool:
    try:
        r = requests.get(f"{ORS_BASE_URL}/health", timeout=5)
        if r.status_code != 200:
            return False
        # Check foot-walking profile is ready
        status_r = requests.get(f"{ORS_BASE_URL}/status", timeout=5)
        if status_r.status_code != 200:
            return False
        data = status_r.json()
        profiles = data.get("profiles", {})
        return any("foot-walking" in str(p) for p in profiles)
    except Exception:
        return False


def wait_for_ors(max_wait: int = 600) -> bool:
    print(f"Waiting for ORS foot-walking profile to be ready (up to {max_wait}s)...")
    for i in range(max_wait):
        if ors_walk_is_healthy():
            print(f"  ORS foot-walking ready after {i}s")
            return True
        if i % 30 == 0 and i > 0:
            print(f"  Still waiting... {i}s elapsed")
        time.sleep(1)
    print("  ERROR: foot-walking profile not ready in time")
    return False


def fetch_ors_walk_isochrone(
    lon: float,
    lat: float,
    minutes: int,
    session: Optional[requests.Session] = None,
    base_url: str = ORS_BASE_URL,
) -> Optional[dict[str, Any]]:
    """Fetch a walk-time isochrone polygon from ORS foot-walking profile."""
    url = f"{base_url.rstrip('/')}/isochrones/foot-walking"
    headers = {"Content-Type": "application/json"}
    body = {
        "locations": [[lon, lat]],
        "range": [minutes * 60],
        "range_type": "time",
    }
    requester = session or requests
    try:
        response = requester.post(url, json=body, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f"    ORS walk error for ({lon:.3f},{lat:.3f}) {minutes}min: {e}")
        return None

    features = data.get("features", [])
    if not features:
        return None
    return features[0].get("geometry")


def compute_walk_isochrone(
    terminus_crs: str,
    terminus_name: str,
    time_budget: int,
    journey_times: list[dict[str, Any]],
    adjacency: Optional[dict] = None,
    session: Optional[requests.Session] = None,
    delay: float = 0.1,
    base_url: str = ORS_BASE_URL,
    walk_cap: int = WALK_CAP_MINUTES,
) -> dict[str, Any]:
    """Compute a walk isochrone for a terminus and time budget.

    Uses ORS foot-walking profile.  Per-station budget = min(drive_budget, walk_cap).
    Embeds reachable station Point features (with rail_route) for route-hover.
    """
    reachable = filter_reachable_stations(
        journey_times, terminus_crs, time_budget, min_drive_buffer=MIN_WALK_BUFFER
    )

    terminus_lon, terminus_lat = TERMINUS_COORDS.get(terminus_crs, (0.0, 0.0))
    polygons: list = []
    station_features: list[dict] = []
    sess = session or requests.Session()

    for i, station in enumerate(reachable):
        walk_budget = min(station["drive_budget"], walk_cap)
        if walk_budget < MIN_WALK_BUFFER:
            continue

        geom = fetch_ors_walk_isochrone(
            lon=station["remote_lon"],
            lat=station["remote_lat"],
            minutes=walk_budget,
            session=sess,
            base_url=base_url,
        )
        if geom:
            try:
                poly = shape(geom)
                if poly.is_valid:
                    polygons.append(poly)
            except Exception:
                pass

        # Build station Point feature with walk metadata
        rail_route = None
        if adjacency:
            rail_route = compute_rail_route(
                adjacency,
                station["remote_lon"], station["remote_lat"],
                terminus_lon, terminus_lat,
            )

        station_features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [station["remote_lon"], station["remote_lat"]],
            },
            "properties": {
                "feature_type": "station",
                "crs": station["remote_crs"],
                "name": station.get("remote_name", station["remote_crs"]),
                "journey_minutes": station["journey_minutes"],
                "walk_budget": walk_budget,
                # Keep drive_budget alias so route-hover reuses existing StationInfo type
                "drive_budget": walk_budget,
                "terminus_crs": terminus_crs,
                "terminus_name": terminus_name,
                "terminus_lon": terminus_lon,
                "terminus_lat": terminus_lat,
                "time_budget": time_budget,
                "rail_route": rail_route,
            },
        })

        if i < len(reachable) - 1:
            time.sleep(delay)

    if polygons:
        merged = unary_union(polygons)
        if isinstance(merged, Polygon):
            merged = MultiPolygon([merged])
    else:
        merged = MultiPolygon()

    polygon_feature = {
        "type": "Feature",
        "geometry": mapping(merged),
        "properties": {
            "terminus_crs": terminus_crs,
            "terminus_name": terminus_name,
            "time_budget_minutes": time_budget,
            "walk_cap_minutes": walk_cap,
            "station_count": len(station_features),
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "profile": "foot-walking",
        },
    }

    return {
        "type": "FeatureCollection",
        "features": [polygon_feature] + station_features,
    }


def has_walk_data(terminus: str, budget: int) -> bool:
    path = OUTPUT_DIR / "isochrones" / "walk" / terminus / f"{budget}.geojson"
    if not path.exists():
        return False
    try:
        with open(path) as f:
            d = json.load(f)
        return len(d.get("features", [])) > 0
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Compute walk isochrone polygons (foot-walking)")
    parser.add_argument("--terminus", help="Single terminus CRS code")
    parser.add_argument("--skip", nargs="*", default=[], help="Termini to skip")
    parser.add_argument("--force", action="store_true", help="Recompute even if data exists")
    parser.add_argument("--walk-cap", type=int, default=WALK_CAP_MINUTES,
                        help=f"Max walk minutes per station (default: {WALK_CAP_MINUTES})")
    parser.add_argument("--delay", type=float, default=0.1,
                        help="Delay between ORS calls in seconds (default: 0.1)")
    args = parser.parse_args()

    if not wait_for_ors(max_wait=600):
        print("Cannot proceed — ORS foot-walking profile not available")
        print("Check that 'foot-walking' is enabled in ors-config.yml and ORS has rebuilt its graphs")
        sys.exit(1)

    print("Building rail network graph for route metadata...")
    adjacency = build_rail_graph(str(RAIL_LINES_PATH))
    print(f"Rail graph: {len(adjacency)} nodes")

    termini = [args.terminus] if args.terminus else [t for t in LONDON_TERMINI if t not in args.skip]
    print(f"\nComputing walk isochrones for: {', '.join(termini)}")
    print(f"Walk cap: {args.walk_cap} min | Time buckets: {TIME_BUCKETS}\n")

    total_success = 0
    total_failed = 0

    for terminus in termini:
        jt_path = DATA_DIR / f"journey_times_{terminus}.json"
        if not jt_path.exists():
            print(f"[SKIP] {terminus} — no journey times. Run --step fetch first.")
            continue

        with open(jt_path) as f:
            journey_times = json.load(f)

        terminus_name = LONDON_TERMINI.get(terminus, terminus)
        print(f"\n{'='*55}")
        print(f"{terminus_name} ({terminus})")
        print(f"{'='*55}")

        sess = requests.Session()

        for budget in TIME_BUCKETS:
            if not args.force and has_walk_data(terminus, budget):
                print(f"  [SKIP] {terminus}/{budget} — already computed")
                total_success += 1
                continue

            print(f"  {budget}min...", end=" ", flush=True)
            result = compute_walk_isochrone(
                terminus_crs=terminus,
                terminus_name=terminus_name,
                time_budget=budget,
                journey_times=journey_times,
                adjacency=adjacency,
                session=sess,
                delay=args.delay,
                walk_cap=args.walk_cap,
            )

            n_stations = result["features"][0]["properties"]["station_count"]
            output_path = str(OUTPUT_DIR / "isochrones" / "walk" / terminus / f"{budget}.geojson")
            save_geojson(result, output_path)
            size_kb = os.path.getsize(output_path) / 1024
            print(f"OK ({n_stations} stations, {size_kb:.0f}KB)")
            total_success += 1

            time.sleep(1)

        time.sleep(3)  # let ORS breathe between termini

    print(f"\n{'='*55}")
    print(f"Done: {total_success} succeeded, {total_failed} failed")
    print(f"\nNext steps:")
    print(f"  python -m scripts.precompute.upload_walk_to_r2")


if __name__ == "__main__":
    main()
