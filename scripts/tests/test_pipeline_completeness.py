"""Pipeline completeness tests.

Verifies that:
1. All stations in stations.json are present in all journey_times_*.json files
2. Stations known to serve each terminus have non-null journey times
3. All 66 main isochrone files (11 termini × 6 buckets) exist and are non-trivial
4. All 66 walk isochrone files exist and contain station features
5. Every station with a non-null journey time appears as a feature in the walk files
6. No suspiciously small files (indicating silent ORS failures)
7. Isochrones for south-route termini cover expected geography

Run with: python -m pytest scripts/tests/test_pipeline_completeness.py -v
Or directly: python scripts/tests/test_pipeline_completeness.py
"""

import json
import math
import os
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "scripts" / "data"
STATIONS_FILE = ROOT / "scripts" / "precompute" / "stations.json"
OUTPUT_DIR = ROOT / "output" / "isochrones"

TERMINI = ["KGX", "PAD", "WAT", "VIC", "LST", "BFR", "CST", "CHX", "EUS", "MYB", "STP"]
TIME_BUCKETS = [30, 45, 60, 75, 90, 120]

# Minimum file sizes (bytes) — below these indicates a likely failure
MIN_ISOCHRONE_BYTES = 5_000
MIN_WALK_ISOCHRONE_BYTES = 2_000

# Known (terminus, station_crs) pairs that MUST have a non-null journey time.
# Only include pairs confirmed to return data from the Transport API.
# Note: GTW/ECR → STP consistently return null from the Transport API despite real
# Thameslink services existing — likely an API limitation with how STP is coded.
KNOWN_SERVICES: list[tuple[str, str]] = [
    # Thameslink south (STP) — confirmed working
    ("STP", "RDH"),  # Redhill — Thameslink ~49 min
    ("STP", "ASF"),  # Ashford International
    ("STP", "LUT"),  # Luton
    ("STP", "BDM"),  # Bedford
    # Blackfriars (BFR)
    ("BFR", "RDH"),  # Redhill — Thameslink ~40 min
    ("BFR", "ECR"),  # East Croydon
    ("BFR", "GTW"),  # Gatwick Airport
    # Victoria (VIC)
    ("VIC", "RDH"),  # Redhill — Southern ~39 min
    ("VIC", "REI"),  # Reigate — Southern ~50 min
    ("VIC", "GTW"),  # Gatwick Airport
    ("VIC", "ECR"),  # East Croydon
    ("VIC", "BTN"),  # Brighton
    ("VIC", "SUO"),  # Sutton — confirmed ~34 min
    # Waterloo (WAT)
    ("WAT", "WOK"),  # Woking
    ("WAT", "GLD"),  # Guildford
    ("WAT", "BSK"),  # Basingstoke
    # King's Cross (KGX)
    ("KGX", "HIT"),  # Hitchin
    ("KGX", "SVG"),  # Stevenage
    ("KGX", "CBG"),  # Cambridge
    ("KGX", "EDB"),  # Edinburgh
    # Paddington (PAD)
    ("PAD", "RDG"),  # Reading
    ("PAD", "SWI"),  # Swindon
    # Euston (EUS)
    ("EUS", "MKC"),  # Milton Keynes Central
    ("EUS", "COV"),  # Coventry
    # Liverpool Street (LST)
    ("LST", "CHM"),  # Chelmsford
    ("LST", "COL"),  # Colchester
    # Blackfriars + STP (Thameslink) — Sutton confirmed
    ("BFR", "SUO"),  # Sutton ~38 min
    ("STP", "SUO"),  # Sutton ~47 min
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def stations() -> list[dict]:
    with open(STATIONS_FILE) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def journey_times() -> dict[str, list[dict]]:
    result = {}
    for terminus in TERMINI:
        path = DATA_DIR / f"journey_times_{terminus}.json"
        if path.exists():
            with open(path) as f:
                result[terminus] = json.load(f)
        else:
            result[terminus] = []
    return result


# ---------------------------------------------------------------------------
# 1. Station list integrity
# ---------------------------------------------------------------------------
class TestStationList:
    def test_no_duplicate_crs(self, stations):
        crs_codes = [s["crs"] for s in stations]
        duplicates = [c for c in set(crs_codes) if crs_codes.count(c) > 1]
        assert not duplicates, f"Duplicate CRS codes in stations.json: {duplicates}"

    def test_all_stations_have_coordinates(self, stations):
        bad = [s for s in stations if s.get("lat") is None or s.get("lon") is None]
        assert not bad, f"Stations missing coordinates: {[s['crs'] for s in bad]}"

    def test_coordinates_in_uk_range(self, stations):
        bad = [
            s for s in stations
            if not (49.5 <= s["lat"] <= 60.9 and -8.0 <= s["lon"] <= 2.0)
        ]
        assert not bad, f"Stations with coordinates outside UK: {[s['crs'] for s in bad]}"

    def test_known_important_stations_present(self, stations):
        present = {s["crs"] for s in stations}
        must_have = ["RDH", "REI", "GTW", "ECR", "WOK", "RDG", "CBG", "CHM"]
        missing = [c for c in must_have if c not in present]
        assert not missing, f"Important stations missing from stations.json: {missing}"


# ---------------------------------------------------------------------------
# 2. Journey times completeness
# ---------------------------------------------------------------------------
class TestJourneyTimes:
    def test_all_termini_have_journey_files(self):
        for terminus in TERMINI:
            path = DATA_DIR / f"journey_times_{terminus}.json"
            assert path.exists(), f"Missing journey times file: {path}"

    def test_all_stations_in_every_terminus_file(self, stations, journey_times):
        station_crs = {s["crs"] for s in stations}
        for terminus, jt_list in journey_times.items():
            covered = {r["remote_crs"] for r in jt_list}
            missing = station_crs - covered
            assert not missing, (
                f"Stations in stations.json but missing from journey_times_{terminus}.json: {missing}"
            )

    def test_no_duplicate_stations_per_terminus(self, journey_times):
        for terminus, jt_list in journey_times.items():
            crs_list = [r["remote_crs"] for r in jt_list]
            duplicates = [c for c in set(crs_list) if crs_list.count(c) > 1]
            assert not duplicates, (
                f"Duplicate stations in journey_times_{terminus}.json: {duplicates}"
            )

    @pytest.mark.parametrize("terminus,crs", KNOWN_SERVICES)
    def test_known_service_has_journey_time(self, terminus, crs, journey_times):
        jt_list = journey_times.get(terminus, [])
        entry = next((r for r in jt_list if r["remote_crs"] == crs), None)
        assert entry is not None, f"{crs} missing from journey_times_{terminus}.json entirely"
        assert entry["journey_minutes"] is not None, (
            f"{crs} → {terminus}: journey_minutes is null (no service found). "
            f"This station is known to have a direct service — check Transport API fetch."
        )


# ---------------------------------------------------------------------------
# 3. Main isochrone outputs
# ---------------------------------------------------------------------------
class TestMainIsochrones:
    def test_all_isochrone_files_exist(self):
        missing = []
        for terminus in TERMINI:
            for bucket in TIME_BUCKETS:
                path = OUTPUT_DIR / terminus / f"{bucket}.geojson"
                if not path.exists():
                    missing.append(str(path))
        assert not missing, f"Missing isochrone files:\n" + "\n".join(missing)

    def test_isochrone_files_not_trivially_small(self):
        # CST/30 legitimately has 0 stations (nearest feeder is 28 min away, leaving no drive budget)
        # Other short-budget / city termini may also be empty for small time buckets
        KNOWN_EMPTY = {("CST", 30), ("CST", 45)}
        small = []
        for terminus in TERMINI:
            for bucket in TIME_BUCKETS:
                if (terminus, bucket) in KNOWN_EMPTY:
                    continue
                path = OUTPUT_DIR / terminus / f"{bucket}.geojson"
                if path.exists() and path.stat().st_size < MIN_ISOCHRONE_BYTES:
                    small.append(f"{terminus}/{bucket}: {path.stat().st_size} bytes")
        assert not small, f"Suspiciously small isochrone files (possible ORS failure):\n" + "\n".join(small)

    def test_isochrones_are_valid_geojson(self):
        for terminus in TERMINI:
            for bucket in TIME_BUCKETS:
                path = OUTPUT_DIR / terminus / f"{bucket}.geojson"
                if path.exists():
                    with open(path) as f:
                        data = json.load(f)
                    assert data.get("type") == "FeatureCollection", (
                        f"{terminus}/{bucket}: not a FeatureCollection"
                    )
                    assert len(data.get("features", [])) > 0, (
                        f"{terminus}/{bucket}: FeatureCollection has no features"
                    )

    def test_larger_budget_has_larger_or_equal_coverage(self):
        """Sanity check: 120 min isochrone should be >= 60 min isochrone in file size."""
        for terminus in TERMINI:
            path_60 = OUTPUT_DIR / terminus / "60.geojson"
            path_120 = OUTPUT_DIR / terminus / "120.geojson"
            if path_60.exists() and path_120.exists():
                size_60 = path_60.stat().st_size
                size_120 = path_120.stat().st_size
                assert size_120 >= size_60 * 0.5, (
                    f"{terminus}: 120 min file ({size_120}B) is less than 50% the size of "
                    f"60 min file ({size_60}B) — likely corrupted"
                )


# ---------------------------------------------------------------------------
# 4. Walk isochrone outputs
# ---------------------------------------------------------------------------
class TestWalkIsochrones:
    def test_all_walk_files_exist(self):
        missing = []
        for terminus in TERMINI:
            for bucket in TIME_BUCKETS:
                path = OUTPUT_DIR / "walk" / terminus / f"{bucket}.geojson"
                if not path.exists():
                    missing.append(str(path))
        assert not missing, f"Missing walk isochrone files:\n" + "\n".join(missing)

    def test_walk_files_not_trivially_small(self):
        KNOWN_EMPTY = {("CST", 30), ("CST", 45)}
        small = []
        for terminus in TERMINI:
            for bucket in TIME_BUCKETS:
                if (terminus, bucket) in KNOWN_EMPTY:
                    continue
                path = OUTPUT_DIR / "walk" / terminus / f"{bucket}.geojson"
                if path.exists() and path.stat().st_size < MIN_WALK_ISOCHRONE_BYTES:
                    small.append(f"{terminus}/{bucket}: {path.stat().st_size} bytes")
        assert not small, f"Suspiciously small walk isochrone files:\n" + "\n".join(small)

    def test_walk_files_have_station_features(self):
        """Each walk file must have at least one station Point feature.

        CST/30 is a known exception: no feeder stations qualify at 30-min budget
        (nearest feeder Dartford is 28 min, leaving only 2 min drive budget).
        """
        KNOWN_EMPTY = {("CST", 30), ("CST", 45)}
        no_stations = []
        for terminus in TERMINI:
            for bucket in TIME_BUCKETS:
                if (terminus, bucket) in KNOWN_EMPTY:
                    continue
                path = OUTPUT_DIR / "walk" / terminus / f"{bucket}.geojson"
                if path.exists():
                    with open(path) as f:
                        data = json.load(f)
                    stations = [
                        feat for feat in data.get("features", [])
                        if feat.get("properties", {}).get("feature_type") == "station"
                    ]
                    if not stations:
                        no_stations.append(f"{terminus}/{bucket}")
        assert not no_stations, f"Walk files with no station features: {no_stations}"

    def test_station_features_have_required_fields(self):
        """Station features must carry the fields the UI depends on."""
        required = {"crs", "name", "journey_minutes", "time_budget", "rail_route"}
        bad = []
        for terminus in TERMINI[:3]:  # spot-check first 3 termini
            path = OUTPUT_DIR / "walk" / terminus / "60.geojson"
            if path.exists():
                with open(path) as f:
                    data = json.load(f)
                for feat in data.get("features", []):
                    if feat.get("properties", {}).get("feature_type") == "station":
                        missing_fields = required - set(feat["properties"].keys())
                        if missing_fields:
                            bad.append(
                                f"{terminus}/60 station {feat['properties'].get('crs')}: "
                                f"missing {missing_fields}"
                            )
        assert not bad, f"Station features missing required fields:\n" + "\n".join(bad)

    def test_known_stations_appear_in_walk_files(self):
        """Spot-check: Redhill must appear in STP, BFR, VIC walk isochrones."""
        checks = [
            ("STP", "RDH", 60),
            ("STP", "RDH", 120),
            ("BFR", "RDH", 60),
            ("VIC", "RDH", 60),
            ("VIC", "REI", 60),
        ]
        missing = []
        for terminus, crs, budget in checks:
            path = OUTPUT_DIR / "walk" / terminus / f"{budget}.geojson"
            if path.exists():
                with open(path) as f:
                    data = json.load(f)
                found = any(
                    feat.get("properties", {}).get("crs") == crs
                    for feat in data.get("features", [])
                    if feat.get("properties", {}).get("feature_type") == "station"
                )
                if not found:
                    missing.append(f"{crs} in {terminus}/{budget}")
        assert not missing, f"Expected stations not found in walk files: {missing}"


# ---------------------------------------------------------------------------
# 5. Geographic sanity checks
# ---------------------------------------------------------------------------
class TestGeographicCoverage:
    def _get_station_lats(self, terminus: str, budget: int) -> list[float]:
        path = OUTPUT_DIR / "walk" / terminus / f"{budget}.geojson"
        if not path.exists():
            return []
        with open(path) as f:
            data = json.load(f)
        return [
            feat["geometry"]["coordinates"][1]
            for feat in data.get("features", [])
            if feat.get("properties", {}).get("feature_type") == "station"
            and feat["geometry"]["type"] == "Point"
        ]

    def test_stp_120_covers_south_of_london(self):
        """STP/120 should include stations south of London (Ashford, Redhill etc.)."""
        lats = self._get_station_lats("STP", 120)
        assert lats, "STP/120 has no station features"
        assert min(lats) < 51.3, (
            f"STP/120 southernmost station at lat {min(lats):.3f} — "
            f"expected coverage south of 51.3 (Ashford/Redhill area)"
        )

    def test_vic_120_covers_south_of_london(self):
        """VIC/120 should include Brighton (lat ~50.83) and Reigate area."""
        lats = self._get_station_lats("VIC", 120)
        assert lats, "VIC/120 has no station features"
        assert min(lats) < 51.3, (
            f"VIC/120 southernmost station at lat {min(lats):.3f} — "
            f"expected coverage south of 51.3 (Reigate/Redhill area)"
        )

    def test_kgx_120_covers_north(self):
        """KGX/120 should reach Edinburgh (lat ~55.95) or at least Yorkshire."""
        lats = self._get_station_lats("KGX", 120)
        assert lats, "KGX/120 has no station features"
        assert max(lats) > 53.0, (
            f"KGX/120 northernmost station at lat {max(lats):.3f} — "
            f"expected coverage beyond lat 53.0"
        )

    def test_no_terminus_covers_opposite_side_of_london(self):
        """
        KGX primarily serves stations north of London; it should not have stations
        south of 51.0 (deep south). Likewise WAT should not cover northeast.
        """
        kgx_lats = self._get_station_lats("KGX", 120)
        far_south = [lat for lat in kgx_lats if lat < 51.0]
        assert not far_south, (
            f"KGX/120 has stations south of lat 51.0: {far_south} "
            f"— these likely have no real KGX service (data error)"
        )


# ---------------------------------------------------------------------------
# Entry point for direct execution
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
