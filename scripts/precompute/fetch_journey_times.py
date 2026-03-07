"""Fetch journey times from Transport API for UK rail stations to London termini.

Uses the timetable + service_timetable endpoints to compute actual journey times,
since the journey planner endpoint is unreliable.

Strategy per (station, terminus) pair:
  1. GET /train/station/{station}/timetable.json?calling_at={terminus} — morning departures
  2. For the first London-bound departure, GET its service_timetable to find arrival at terminus
  3. Journey time = arrival_at_terminus - departure_from_station
"""

import json
import os
import re
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

import requests


def _next_tuesday() -> str:
    """Return the next Tuesday as YYYY-MM-DD string."""
    today = date.today()
    days_ahead = (1 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return (today + timedelta(days=days_ahead)).isoformat()


def _time_to_minutes(t: str) -> Optional[int]:
    """Convert HH:MM time string to minutes since midnight."""
    m = re.match(r"(\d{2}):(\d{2})", t)
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


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
    ref_date: Optional[str] = None,
) -> dict[str, Any]:
    """Fetch the fastest journey time between a station and a terminus.

    Uses timetable + service_timetable endpoints. Looks for the earliest
    morning departure (08:00-09:30 window) that calls at the terminus.

    Args:
        remote_crs: CRS code of the origin station.
        terminus_crs: CRS code of the destination London terminus.
        app_id: Transport API app ID.
        app_key: Transport API app key.
        session: Optional requests session for connection reuse.
        ref_date: Reference date (YYYY-MM-DD). Defaults to next Tuesday.

    Returns:
        Dictionary with remote_crs, terminus_crs, journey_minutes (int or None),
        and changes (int).
    """
    null_result = {
        "remote_crs": remote_crs,
        "terminus_crs": terminus_crs,
        "journey_minutes": None,
        "changes": 0,
    }

    requester = session or requests
    ref_date = ref_date or _next_tuesday()

    # Step 1: Get departures from remote station that call at terminus
    timetable_url = (
        f"https://transportapi.com/v3/uk/train/station/{remote_crs}/timetable.json"
    )
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "date": ref_date,
        "time": "08:00",
        "train_status": "passenger",
        "calling_at": terminus_crs,
    }

    try:
        resp = requester.get(timetable_url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return null_result

    departures = data.get("departures", {}).get("all", [])
    if not departures:
        return null_result

    # Pick the first departure (earliest in the morning window)
    dep = departures[0]
    dep_time_str = dep.get("aimed_departure_time")
    svc_url = dep.get("service_timetable", {}).get("id")

    if not dep_time_str or not svc_url:
        return null_result

    dep_minutes = _time_to_minutes(dep_time_str)
    if dep_minutes is None:
        return null_result

    # Step 2: Fetch service timetable to find arrival at terminus
    try:
        resp2 = requester.get(svc_url, timeout=30)
        resp2.raise_for_status()
        svc_data = resp2.json()
    except Exception:
        return null_result

    stops = svc_data.get("stops", [])
    arr_minutes = None
    for stop in stops:
        if stop.get("station_code") == terminus_crs:
            arr_time_str = stop.get("aimed_arrival_time") or stop.get("aimed_departure_time")
            if arr_time_str:
                arr_minutes = _time_to_minutes(arr_time_str)
            break

    if arr_minutes is None:
        return null_result

    # Handle overnight (shouldn't happen for morning commutes, but be safe)
    journey_minutes = arr_minutes - dep_minutes
    if journey_minutes < 0:
        journey_minutes += 24 * 60

    # Count changes (single direct train = 0 changes)
    changes = 0

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
