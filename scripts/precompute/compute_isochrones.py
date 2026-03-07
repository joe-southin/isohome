"""Compute isochrone polygons by combining train journey times with ORS drive-time polygons."""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union


LONDON_TERMINI = {
    "KGX": "King's Cross",
    "PAD": "Paddington",
    "WAT": "Waterloo",
    "VIC": "Victoria",
    "LST": "Liverpool Street",
    "BFR": "Blackfriars",
    "CST": "Cannon Street",
    "CHX": "Charing Cross",
    "EUS": "Euston",
    "MYB": "Marylebone",
    "STP": "St Pancras International",
}


def fetch_ors_isochrone(
    lon: float,
    lat: float,
    minutes: int,
    api_key: str,
    session: Optional[requests.Session] = None,
    base_url: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Fetch a drive-time isochrone polygon from OpenRouteService.

    Args:
        lon: Longitude of the station.
        lat: Latitude of the station.
        minutes: Drive time budget in minutes.
        api_key: ORS API key (ignored for local instances).
        session: Optional requests session for connection reuse.
        base_url: ORS base URL. Defaults to public API. Set to
                  e.g. "http://localhost:8080/ors/v2" for local instances.

    Returns:
        GeoJSON geometry dict (Polygon), or None on failure.
    """
    if base_url:
        url = f"{base_url.rstrip('/')}/isochrones/driving-car"
    else:
        url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if not base_url:
        headers["Authorization"] = f"Bearer {api_key}"
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
        print(f"    ORS error for ({lon},{lat}) {minutes}min: {e}")
        return None

    features = data.get("features", [])
    if not features:
        return None

    return features[0].get("geometry")


def filter_reachable_stations(
    journey_times: list[dict[str, Any]],
    terminus_crs: str,
    time_budget: int,
    min_drive_buffer: int = 5,
) -> list[dict[str, Any]]:
    """Filter stations that are reachable within the time budget.

    A station is reachable if the train journey time leaves at least
    min_drive_buffer minutes for driving.

    Args:
        journey_times: List of journey time entries.
        terminus_crs: CRS code of the target terminus.
        time_budget: Total time budget in minutes.
        min_drive_buffer: Minimum drive time to include a station.

    Returns:
        List of reachable station entries with drive_budget added.
    """
    reachable = []
    for entry in journey_times:
        if entry.get("terminus_crs") != terminus_crs:
            continue
        jm = entry.get("journey_minutes")
        if jm is None:
            continue
        if jm >= time_budget - min_drive_buffer:
            continue
        drive_budget = time_budget - jm
        reachable.append({**entry, "drive_budget": drive_budget})
    return reachable


def compute_isochrone(
    terminus_crs: str,
    terminus_name: str,
    time_budget: int,
    journey_times: list[dict[str, Any]],
    ors_api_key: str,
    session: Optional[requests.Session] = None,
    delay: float = 0.2,
    ors_base_url: Optional[str] = None,
) -> dict[str, Any]:
    """Compute a unified isochrone polygon for a terminus and time budget.

    Args:
        terminus_crs: CRS code of the London terminus.
        terminus_name: Human-readable name of the terminus.
        time_budget: Total commute time budget in minutes.
        journey_times: List of journey time entries for all stations.
        ors_api_key: OpenRouteService API key.
        session: Optional requests session for connection reuse.
        delay: Delay between ORS API calls in seconds.

    Returns:
        GeoJSON FeatureCollection with one MultiPolygon/Polygon feature.
    """
    reachable = filter_reachable_stations(journey_times, terminus_crs, time_budget)

    polygons = []
    sess = session or requests.Session()

    for i, station in enumerate(reachable):
        geom = fetch_ors_isochrone(
            lon=station["remote_lon"],
            lat=station["remote_lat"],
            minutes=station["drive_budget"],
            api_key=ors_api_key,
            session=sess,
            base_url=ors_base_url,
        )
        if geom:
            try:
                poly = shape(geom)
                if poly.is_valid:
                    polygons.append(poly)
            except Exception:
                continue

        if i < len(reachable) - 1:
            time.sleep(delay)

    if polygons:
        merged = unary_union(polygons)
        if isinstance(merged, Polygon):
            merged = MultiPolygon([merged])
    else:
        merged = MultiPolygon()

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": mapping(merged),
                "properties": {
                    "terminus_crs": terminus_crs,
                    "terminus_name": terminus_name,
                    "time_budget_minutes": time_budget,
                    "station_count": len(reachable),
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                },
            }
        ],
    }


def save_geojson(geojson: dict[str, Any], output_path: str) -> None:
    """Save a GeoJSON dictionary to a file.

    Args:
        geojson: GeoJSON dictionary to save.
        output_path: File path to write to.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(geojson, f, indent=2)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Compute isochrone polygons")
    parser.add_argument("--terminus", default="KGX", help="London terminus CRS code")
    parser.add_argument("--minutes", type=int, default=60, help="Time budget in minutes")
    parser.add_argument("--journey-times", default="scripts/data/journey_times.json",
                        help="Path to journey times JSON")
    parser.add_argument("--output-dir", default="output/isochrones", help="Output directory")
    args = parser.parse_args()

    ors_api_key = os.environ.get("ORS_API_KEY", "")
    ors_base_url = os.environ.get("ORS_BASE_URL")  # e.g. http://localhost:8080/ors/v2

    with open(args.journey_times) as f:
        journey_times = json.load(f)

    terminus_name = LONDON_TERMINI.get(args.terminus, args.terminus)
    print(f"Computing isochrone: {terminus_name} ({args.terminus}), {args.minutes} min")

    result = compute_isochrone(
        terminus_crs=args.terminus,
        terminus_name=terminus_name,
        time_budget=args.minutes,
        journey_times=journey_times,
        ors_api_key=ors_api_key,
        ors_base_url=ors_base_url,
    )

    output_path = f"{args.output_dir}/{args.terminus}/{args.minutes}.geojson"
    save_geojson(result, output_path)
    print(f"Saved isochrone to {output_path}")
    station_count = result["features"][0]["properties"]["station_count"]
    print(f"Reachable stations: {station_count}")
