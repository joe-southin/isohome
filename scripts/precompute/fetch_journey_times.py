"""Fetch journey times from Transport API for UK rail stations to London termini."""

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

import requests


def parse_duration(duration_str: str) -> Optional[int]:
    """Parse a duration string into total minutes.

    Handles formats:
    - ISO 8601: "PT1H5M", "PT45M", "PT2H"
    - HH:MM:SS: "01:05:00", "00:45:00"

    Args:
        duration_str: Duration string in either format.

    Returns:
        Total minutes as an integer, or None if parsing fails.
    """
    if not duration_str:
        return None

    # Try ISO 8601 format: PT1H5M
    iso_match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", duration_str)
    if iso_match:
        hours = int(iso_match.group(1) or 0)
        minutes = int(iso_match.group(2) or 0)
        return hours * 60 + minutes

    # Try HH:MM:SS format
    hms_match = re.match(r"(\d+):(\d+):(\d+)$", duration_str)
    if hms_match:
        hours = int(hms_match.group(1))
        minutes = int(hms_match.group(2))
        return hours * 60 + minutes

    return None


def load_stations(path: str) -> list[dict[str, Any]]:
    """Load station data from a JSON file.

    Args:
        path: Path to the stations JSON file.

    Returns:
        List of station dictionaries with crs, name, lat, lon keys.
    """
    with open(path) as f:
        return json.load(f)


def fetch_journey_time(
    remote_crs: str,
    terminus_crs: str,
    app_id: str,
    app_key: str,
    session: Optional[requests.Session] = None,
) -> dict[str, Any]:
    """Fetch the fastest journey time between two stations from Transport API.

    Args:
        remote_crs: CRS code of the origin station.
        terminus_crs: CRS code of the destination London terminus.
        app_id: Transport API app ID.
        app_key: Transport API app key.
        session: Optional requests session for connection reuse.

    Returns:
        Dictionary with remote_crs, terminus_crs, journey_minutes (int or None),
        and changes (int).
    """
    url = (
        f"https://transportapi.com/v3/uk/public/journey"
        f"/from/station_code:{remote_crs}"
        f"/to/station_code:{terminus_crs}.json"
    )
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "date": "next_tuesday",
        "time": "08:30",
        "type": "fastest",
    }

    requester = session or requests
    try:
        response = requester.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
    except Exception:
        return {
            "remote_crs": remote_crs,
            "terminus_crs": terminus_crs,
            "journey_minutes": None,
            "changes": 0,
        }

    routes = data.get("routes", [])
    if not routes:
        return {
            "remote_crs": remote_crs,
            "terminus_crs": terminus_crs,
            "journey_minutes": None,
            "changes": 0,
        }

    route = routes[0]
    duration_str = route.get("duration", "")
    journey_minutes = parse_duration(duration_str)
    changes = len(route.get("route_parts", [])) - 1
    changes = max(changes, 0)

    return {
        "remote_crs": remote_crs,
        "terminus_crs": terminus_crs,
        "journey_minutes": journey_minutes,
        "changes": changes,
    }


def fetch_all_journey_times(
    terminus_crs: str,
    stations: list[dict[str, Any]],
    app_id: str,
    app_key: str,
    delay: float = 0.2,
) -> list[dict[str, Any]]:
    """Fetch journey times from all stations to a London terminus.

    Args:
        terminus_crs: CRS code of the London terminus.
        stations: List of station dictionaries.
        app_id: Transport API app ID.
        app_key: Transport API app key.
        delay: Delay in seconds between API calls for rate limiting.

    Returns:
        List of journey time result dictionaries.
    """
    results = []
    session = requests.Session()

    for i, station in enumerate(stations):
        result = fetch_journey_time(
            remote_crs=station["crs"],
            terminus_crs=terminus_crs,
            app_id=app_id,
            app_key=app_key,
            session=session,
        )
        result["remote_name"] = station["name"]
        result["remote_lat"] = station["lat"]
        result["remote_lon"] = station["lon"]
        results.append(result)

        if i < len(stations) - 1:
            time.sleep(delay)

    return results


def save_journey_times(journey_times: list[dict[str, Any]], output_path: str) -> None:
    """Save journey times to a JSON file.

    Args:
        journey_times: List of journey time dictionaries.
        output_path: Path to save the JSON file.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(journey_times, f, indent=2)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Fetch journey times from Transport API")
    parser.add_argument("--terminus", default="KGX", help="London terminus CRS code")
    parser.add_argument("--output", default="scripts/data/journey_times.json", help="Output path")
    args = parser.parse_args()

    app_id = os.environ["TRANSPORT_API_APP_ID"]
    app_key = os.environ["TRANSPORT_API_APP_KEY"]

    stations_path = str(Path(__file__).parent / "stations.json")
    stations = load_stations(stations_path)
    print(f"Loaded {len(stations)} stations")

    print(f"Fetching journey times to {args.terminus}...")
    results = fetch_all_journey_times(args.terminus, stations, app_id, app_key)

    save_journey_times(results, args.output)
    print(f"Saved {len(results)} journey times to {args.output}")
