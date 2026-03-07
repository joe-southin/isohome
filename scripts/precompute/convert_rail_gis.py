"""Convert rail line data to simplified GeoJSON for map display.

Sources (in order of preference):
1. Overpass API extract (OpenStreetMap mainline rail)
2. Network Rail GIS GeoPackage (requires registration)

Outputs:
- output/static/rail-lines.geojson — LineString features for UK mainline rail
"""

import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    from shapely.geometry import LineString, mapping
    from shapely.ops import linemerge
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


def load_overpass_json(path: str) -> list[dict[str, Any]]:
    """Load Overpass API JSON export.

    Args:
        path: Path to the Overpass JSON file.

    Returns:
        List of way elements with geometry.
    """
    with open(path) as f:
        data = json.load(f)
    return [e for e in data.get("elements", []) if e.get("type") == "way" and e.get("geometry")]


def overpass_to_geojson(elements: list[dict[str, Any]], simplify_tolerance: float = 0.001) -> dict[str, Any]:
    """Convert Overpass way elements to a GeoJSON FeatureCollection.

    Merges connected line segments and simplifies geometry to reduce file size.

    Args:
        elements: List of Overpass way elements with geometry.
        simplify_tolerance: Shapely simplification tolerance in degrees.
            ~0.001 ≈ 100m, good for map display at zoom 5-10.

    Returns:
        GeoJSON FeatureCollection with LineString/MultiLineString features.
    """
    if not HAS_SHAPELY:
        # Fallback: raw conversion without merging/simplification
        features = []
        for elem in elements:
            coords = [(pt["lon"], pt["lat"]) for pt in elem["geometry"]]
            if len(coords) < 2:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {"name": elem.get("tags", {}).get("name", "")},
            })
        return {"type": "FeatureCollection", "features": features}

    # Build Shapely lines
    lines = []
    for elem in elements:
        coords = [(pt["lon"], pt["lat"]) for pt in elem["geometry"]]
        if len(coords) < 2:
            continue
        lines.append(LineString(coords))

    # Merge connected lines to reduce feature count
    merged = linemerge(lines)

    # Handle single line or multi-line result
    if merged.geom_type == "LineString":
        geom_list = [merged]
    elif merged.geom_type == "MultiLineString":
        geom_list = list(merged.geoms)
    else:
        geom_list = lines  # fallback

    # Simplify and convert to features
    features = []
    for geom in geom_list:
        simplified = geom.simplify(simplify_tolerance, preserve_topology=True)
        if simplified.is_empty:
            continue
        features.append({
            "type": "Feature",
            "geometry": mapping(simplified),
            "properties": {},
        })

    return {"type": "FeatureCollection", "features": features}


def fetch_from_overpass(output_path: str, timeout: int = 180) -> str:
    """Fetch UK mainline rail from Overpass API and save raw JSON.

    Args:
        output_path: Where to save the raw Overpass JSON.
        timeout: Overpass API timeout in seconds.

    Returns:
        Path to the saved file.
    """
    import requests

    query = (
        f'[out:json][timeout:{timeout}];'
        'way["railway"="rail"]["usage"="main"](49.5,-8.2,61.0,2.0);'
        'out geom;'
    )
    print("Fetching mainline rail from Overpass API...")
    resp = requests.post(
        "https://overpass-api.de/api/interpreter",
        data={"data": query},
        timeout=timeout + 30,
    )
    resp.raise_for_status()

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        f.write(resp.text)

    data = resp.json()
    print(f"Downloaded {len(data.get('elements', []))} rail segments")
    return output_path


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Convert rail line data to GeoJSON")
    parser.add_argument("--input", help="Path to Overpass JSON (skip download if provided)")
    parser.add_argument("--output", default="output/static/rail-lines.geojson", help="Output GeoJSON path")
    parser.add_argument("--tolerance", type=float, default=0.001, help="Simplification tolerance in degrees")
    args = parser.parse_args()

    # Step 1: Get raw data
    if args.input:
        raw_path = args.input
    else:
        raw_path = "scripts/data/uk_rail_overpass.json"
        if not Path(raw_path).exists():
            fetch_from_overpass(raw_path)
        else:
            print(f"Using cached Overpass data: {raw_path}")

    # Step 2: Load and convert
    elements = load_overpass_json(raw_path)
    print(f"Loaded {len(elements)} rail way segments")

    # Step 3: Convert to GeoJSON with simplification
    geojson = overpass_to_geojson(elements, simplify_tolerance=args.tolerance)
    print(f"Produced {len(geojson['features'])} merged line features")

    # Step 4: Save
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(geojson, f)

    size_mb = os.path.getsize(args.output) / 1024 / 1024
    print(f"Saved to {args.output} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
