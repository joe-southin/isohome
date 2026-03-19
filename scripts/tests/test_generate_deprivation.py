"""Tests for scripts/data/generate_deprivation.py.

Uses small in-memory data — no network calls.
"""

import json
import os
import tempfile

import pytest

# Allow imports from scripts/data
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))

from generate_deprivation import (
    build_geojson,
    compute_stats,
    generate_features,
    imd_score,
    write_output,
)


class TestImdScore:
    """Test the IMD score estimation function."""

    def test_returns_float(self):
        score = imd_score(51.5, -0.1)
        assert isinstance(score, float)

    def test_score_within_range(self):
        """Scores must be clamped to 1–85."""
        for lat in [50.0, 52.0, 54.0]:
            for lon in [-3.0, -1.0, 1.0]:
                score = imd_score(lat, lon)
                assert 1.0 <= score <= 85.0

    def test_precision_two_decimals(self):
        score = imd_score(51.5, -0.1)
        # round(x, 2) produces at most 2 decimal places
        assert score == round(score, 2)


class TestComputeStats:
    """Test compute_stats helper."""

    def test_known_values(self):
        values = [10.0, 20.0, 30.0, 40.0, 50.0]
        mean, stddev = compute_stats(values)
        assert mean == 30.0
        assert round(stddev, 2) == 15.81

    def test_single_value(self):
        """Single-element list should raise (stdev needs n>=2)."""
        with pytest.raises(Exception):
            compute_stats([5.0])

    def test_returns_rounded(self):
        mean, stddev = compute_stats([1.111, 2.222, 3.333])
        assert mean == round(mean, 2)
        assert stddev == round(stddev, 2)


class TestBuildGeojson:
    """Test FeatureCollection wrapper."""

    def test_structure(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-0.1, 51.5]},
                "properties": {"value": 22.5},
            }
        ]
        fc = build_geojson(features)
        assert fc["type"] == "FeatureCollection"
        assert fc["features"] is features
        assert len(fc["features"]) == 1

    def test_empty_features(self):
        fc = build_geojson([])
        assert fc["type"] == "FeatureCollection"
        assert fc["features"] == []


class TestGenerateFeatures:
    """Test the feature generation pipeline."""

    def test_returns_required_columns(self):
        features = generate_features()
        for f in features[:10]:
            assert f["type"] == "Feature"
            assert "geometry" in f
            assert f["geometry"]["type"] == "Point"
            coords = f["geometry"]["coordinates"]
            assert len(coords) == 2
            assert "value" in f["properties"]

    def test_coordinate_precision(self):
        """Coordinates should have at most 4 decimal places."""
        features = generate_features()
        for f in features[:50]:
            lon, lat = f["geometry"]["coordinates"]
            assert lon == round(lon, 4)
            assert lat == round(lat, 4)

    def test_value_precision(self):
        """Values should have at most 2 decimal places."""
        features = generate_features()
        for f in features[:50]:
            v = f["properties"]["value"]
            assert v == round(v, 2)

    def test_count(self):
        features = generate_features()
        assert len(features) == 3000


class TestInnerJoinBehaviour:
    """In real data pipeline, inner join drops unmatched LSOAs.

    For synthetic generation, we verify that all generated features have
    both coordinates and a value (simulating a successful join).
    """

    def test_all_features_have_coords_and_value(self):
        features = generate_features()
        for f in features:
            coords = f["geometry"]["coordinates"]
            assert coords[0] is not None  # lon
            assert coords[1] is not None  # lat
            assert f["properties"]["value"] is not None


class TestWriteOutput:
    """Test file writing."""

    def test_creates_file(self):
        geojson = {"type": "FeatureCollection", "features": []}
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "subdir", "test.json")
            write_output(geojson, path)
            assert os.path.exists(path)

    def test_compact_json(self):
        geojson = {"type": "FeatureCollection", "features": []}
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "test.json")
            write_output(geojson, path)
            content = open(path).read()
            # Compact JSON: no spaces after separators
            assert '" :' not in content
            assert '", ' not in content
            parsed = json.loads(content)
            assert parsed == geojson

    def test_creates_nested_dirs(self):
        geojson = {"type": "FeatureCollection", "features": []}
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "a", "b", "c", "test.json")
            write_output(geojson, path)
            assert os.path.exists(path)
