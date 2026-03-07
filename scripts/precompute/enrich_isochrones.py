"""Enrich isochrone GeoJSON files with per-station metadata.

Adds reachable station Point features to each isochrone file so the
frontend can show route info on hover without a separate data source.

Usage:
  python -m scripts.precompute.enrich_isochrones
  python -m scripts.precompute.enrich_isochrones --terminus KGX
"""

import json
import os
from pathlib import Path

from scripts.precompute.compute_isochrones import LONDON_TERMINI, filter_reachable_stations

TIME_BUCKETS = [30, 45, 60, 75, 90, 120]
DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "output"

# Terminus station coordinates (approximate, for drawing train lines)
TERMINUS_COORDS = {
    "KGX": (-0.124, 51.530),
    "PAD": (-0.176, 51.516),
    "WAT": (-0.113, 51.503),
    "VIC": (-0.144, 51.495),
    "LST": (-0.083, 51.518),
    "BFR": (-0.104, 51.512),
    "CST": (-0.091, 51.511),
    "CHX": (-0.125, 51.508),
    "EUS": (-0.134, 51.528),
    "MYB": (-0.163, 51.522),
    "STP": (-0.126, 51.532),
}


def enrich_isochrone(terminus: str, budget: int) -> bool:
    iso_path = OUTPUT_DIR / "isochrones" / terminus / f"{budget}.geojson"
    jt_path = DATA_DIR / f"journey_times_{terminus}.json"

    if not iso_path.exists() or not jt_path.exists():
        return False

    with open(iso_path) as f:
        geojson = json.load(f)

    with open(jt_path) as f:
        journey_times = json.load(f)

    # Remove any previously added station features (keep only the isochrone polygon)
    geojson["features"] = [
        feat for feat in geojson["features"]
        if feat.get("properties", {}).get("feature_type") != "station"
    ]

    reachable = filter_reachable_stations(journey_times, terminus, budget)
    terminus_lon, terminus_lat = TERMINUS_COORDS.get(terminus, (0, 0))

    for station in reachable:
        station_feature = {
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
                "drive_budget": station["drive_budget"],
                "terminus_crs": terminus,
                "terminus_name": LONDON_TERMINI.get(terminus, terminus),
                "terminus_lon": terminus_lon,
                "terminus_lat": terminus_lat,
                "time_budget": budget,
            },
        }
        geojson["features"].append(station_feature)

    with open(iso_path, "w") as f:
        json.dump(geojson, f)

    return True


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Enrich isochrones with station metadata")
    parser.add_argument("--terminus", help="Single terminus to enrich")
    args = parser.parse_args()

    termini = [args.terminus] if args.terminus else list(LONDON_TERMINI.keys())
    enriched = 0

    for terminus in termini:
        for budget in TIME_BUCKETS:
            if enrich_isochrone(terminus, budget):
                enriched += 1
                print(f"  {terminus}/{budget}")

    print(f"\nEnriched {enriched} isochrone files")


if __name__ == "__main__":
    main()
