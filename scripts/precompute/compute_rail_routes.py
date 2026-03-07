"""Compute rail routes between stations and termini along actual rail geometry.

Builds a graph from rail-lines.geojson and finds shortest paths from each
reachable station to its terminus. Stores route geometry in enriched isochrone files.

Usage:
  python -m scripts.precompute.compute_rail_routes
  python -m scripts.precompute.compute_rail_routes --terminus KGX
"""

import heapq
import json
import math
import os
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

from scripts.precompute.compute_isochrones import LONDON_TERMINI

TIME_BUCKETS = [30, 45, 60, 75, 90, 120]
OUTPUT_DIR = Path(__file__).parent.parent.parent / "output"
RAIL_LINES_PATH = OUTPUT_DIR / "static" / "rail-lines.geojson"

# Snap tolerance: points within this distance (degrees) are treated as the same node.
# 0.002 degrees ≈ 200m — generous enough to handle simplified geometry misalignment.
SNAP_TOLERANCE = 0.002


def _round_coord(lon: float, lat: float) -> tuple[float, float]:
    """Round coordinates to snap tolerance grid for graph node matching."""
    precision = int(-math.log10(SNAP_TOLERANCE))
    return (round(lon, precision), round(lat, precision))


def _haversine_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Approximate distance in degrees (fast, for graph weights)."""
    dx = lon1 - lon2
    dy = lat1 - lat2
    return math.sqrt(dx * dx + dy * dy)


def build_rail_graph(rail_geojson_path: str) -> dict:
    """Build an adjacency list graph from rail line features.

    Each node is a snapped (lon, lat) tuple. Edges store the original
    coordinate sequence for reconstructing geometry.
    """
    with open(rail_geojson_path) as f:
        data = json.load(f)

    # adjacency: node -> [(neighbor_node, weight, [coords_between])]
    adjacency: dict[tuple, list] = defaultdict(list)

    for feat in data["features"]:
        coords = feat["geometry"]["coordinates"]
        if len(coords) < 2:
            continue

        # Add edges between consecutive coordinate pairs along the line
        # But also add the full segment as a single edge for pathfinding efficiency
        snapped_coords = [_round_coord(c[0], c[1]) for c in coords]

        # Add edge from start to end of this line segment
        start = snapped_coords[0]
        end = snapped_coords[-1]

        # Weight = total length of the line
        weight = sum(
            _haversine_deg(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
            for i in range(len(coords) - 1)
        )

        # Store full coordinate list for geometry reconstruction
        adjacency[start].append((end, weight, coords))
        adjacency[end].append((start, weight, list(reversed(coords))))

        # Also add intermediate nodes for better connectivity
        # Split long lines at intermediate points
        if len(snapped_coords) > 2:
            for i in range(len(snapped_coords) - 1):
                n1 = snapped_coords[i]
                n2 = snapped_coords[i + 1]
                seg_weight = _haversine_deg(
                    coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]
                )
                seg_coords = [coords[i], coords[i + 1]]
                adjacency[n1].append((n2, seg_weight, seg_coords))
                adjacency[n2].append((n1, seg_weight, list(reversed(seg_coords))))

    adj = dict(adjacency)
    adj["_main_component"] = _find_main_component(adj)
    return adj


def _find_main_component(adjacency: dict) -> set:
    """Find the largest connected component in the graph."""
    all_nodes = set(adjacency.keys())
    best_component: set = set()
    visited_all: set = set()

    for node in all_nodes:
        if node in visited_all:
            continue
        component: set = {node}
        queue = deque([node])
        while queue:
            n = queue.popleft()
            for nb, _, _ in adjacency.get(n, []):
                if nb not in component:
                    component.add(nb)
                    queue.append(nb)
        visited_all |= component
        if len(component) > len(best_component):
            best_component = component

    return best_component


def find_nearest_node(
    adjacency: dict, lon: float, lat: float
) -> Optional[tuple[float, float]]:
    """Find the nearest graph node to a given point, preferring the main component."""
    main_component = adjacency.get("_main_component", set())

    target = _round_coord(lon, lat)
    if target in adjacency and target in main_component:
        return target

    best = None
    best_dist = float("inf")
    for node in (main_component if main_component else adjacency):
        d = _haversine_deg(lon, lat, node[0], node[1])
        if d < best_dist:
            best_dist = d
            best = node

    # Only match if within reasonable distance (0.1 degrees ≈ 10km)
    if best_dist > 0.1:
        return None
    return best


def dijkstra(
    adjacency: dict,
    start: tuple[float, float],
    end: tuple[float, float],
) -> Optional[list[list[float]]]:
    """Find shortest path and return the coordinate sequence."""
    if start == end:
        return [[start[0], start[1]]]

    dist: dict[tuple, float] = {start: 0}
    prev: dict[tuple, tuple[tuple, list]] = {}  # node -> (prev_node, coords_segment)
    visited: set[tuple] = set()
    heap = [(0.0, start)]

    while heap:
        d, node = heapq.heappop(heap)
        if node in visited:
            continue
        visited.add(node)

        if node == end:
            break

        for neighbor, weight, coords in adjacency.get(node, []):
            if neighbor in visited:
                continue
            new_dist = d + weight
            if new_dist < dist.get(neighbor, float("inf")):
                dist[neighbor] = new_dist
                prev[neighbor] = (node, coords)
                heapq.heappush(heap, (new_dist, neighbor))

    if end not in prev and start != end:
        return None

    # Reconstruct path
    path_coords: list[list[float]] = []
    current = end
    segments: list[list[list[float]]] = []
    while current in prev:
        prev_node, coords = prev[current]
        segments.append(coords)
        current = prev_node

    # Reverse and concatenate (segments are in reverse order)
    segments.reverse()
    for seg in segments:
        if not path_coords:
            path_coords.extend(seg)
        else:
            # Skip first coord if it duplicates the last one
            path_coords.extend(seg[1:])

    return path_coords if path_coords else None


def compute_rail_route(
    adjacency: dict,
    station_lon: float,
    station_lat: float,
    terminus_lon: float,
    terminus_lat: float,
) -> Optional[list[list[float]]]:
    """Compute a rail route from station to terminus along the network."""
    start = find_nearest_node(adjacency, station_lon, station_lat)
    end = find_nearest_node(adjacency, terminus_lon, terminus_lat)

    if start is None or end is None:
        return None

    route = dijkstra(adjacency, start, end)
    if route is None:
        return None

    # Prepend/append exact station/terminus coordinates if they differ from graph nodes
    if route:
        first = route[0]
        if _haversine_deg(first[0], first[1], station_lon, station_lat) > 0.0001:
            route.insert(0, [station_lon, station_lat])
        last = route[-1]
        if _haversine_deg(last[0], last[1], terminus_lon, terminus_lat) > 0.0001:
            route.append([terminus_lon, terminus_lat])

    return route


def enrich_with_rail_routes(adjacency: dict, terminus: str, budget: int) -> bool:
    """Add rail route geometry to station features in an isochrone file."""
    from scripts.precompute.enrich_isochrones import TERMINUS_COORDS

    iso_path = OUTPUT_DIR / "isochrones" / terminus / f"{budget}.geojson"
    if not iso_path.exists():
        return False

    with open(iso_path) as f:
        geojson = json.load(f)

    terminus_lon, terminus_lat = TERMINUS_COORDS.get(terminus, (0, 0))
    modified = False

    for feat in geojson["features"]:
        props = feat.get("properties", {})
        if props.get("feature_type") != "station":
            continue

        coords = feat["geometry"]["coordinates"]
        station_lon, station_lat = coords[0], coords[1]

        route = compute_rail_route(
            adjacency, station_lon, station_lat, terminus_lon, terminus_lat
        )

        if route and len(route) >= 2:
            props["rail_route"] = route
            modified = True

    if modified:
        with open(iso_path, "w") as f:
            json.dump(geojson, f)

    return modified


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Compute rail routes for isochrone stations")
    parser.add_argument("--terminus", help="Single terminus to process")
    args = parser.parse_args()

    print("Building rail network graph...")
    adjacency = build_rail_graph(str(RAIL_LINES_PATH))
    print(f"Graph: {len(adjacency)} nodes")

    termini = [args.terminus] if args.terminus else list(LONDON_TERMINI.keys())
    enriched = 0
    failed = 0

    for terminus in termini:
        for budget in TIME_BUCKETS:
            result = enrich_with_rail_routes(adjacency, terminus, budget)
            if result:
                enriched += 1
                print(f"  {terminus}/{budget}")
            else:
                failed += 1

    print(f"\nEnriched {enriched} files with rail routes ({failed} skipped/no routes)")


if __name__ == "__main__":
    main()
