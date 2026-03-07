"""Tests for compute_isochrones module."""

import json
from unittest.mock import MagicMock, patch

import pytest
from shapely.geometry import MultiPolygon, Polygon, shape

from scripts.precompute.compute_isochrones import (
    compute_isochrone,
    fetch_ors_isochrone,
    filter_reachable_stations,
    save_geojson,
)


# Sample polygon geometry for mocking ORS responses
SAMPLE_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-0.5, 52.0],
            [-0.4, 52.0],
            [-0.4, 52.1],
            [-0.5, 52.1],
            [-0.5, 52.0],
        ]
    ],
}

SAMPLE_ORS_RESPONSE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": SAMPLE_POLYGON,
            "properties": {"value": 900},
        }
    ],
}


class TestFetchOrsIsochrone:
    """Tests for the fetch_ors_isochrone function."""

    def test_successful_fetch(self):
        mock_response = MagicMock()
        mock_response.json.return_value = SAMPLE_ORS_RESPONSE
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.post.return_value = mock_response

        result = fetch_ors_isochrone(-0.480, 52.136, 15, "test-key", session=mock_session)
        assert result is not None
        assert result["type"] == "Polygon"

    def test_correct_api_call(self):
        mock_response = MagicMock()
        mock_response.json.return_value = SAMPLE_ORS_RESPONSE
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.post.return_value = mock_response

        fetch_ors_isochrone(-0.480, 52.136, 15, "test-key", session=mock_session)

        call_args = mock_session.post.call_args
        url = call_args[0][0]
        assert "isochrones/driving-car" in url
        body = call_args[1]["json"]
        assert body["locations"] == [[-0.480, 52.136]]
        assert body["range"] == [900]  # 15 * 60
        assert body["range_type"] == "time"
        headers = call_args[1]["headers"]
        assert "Bearer test-key" in headers["Authorization"]

    def test_request_failure_returns_none(self):
        mock_session = MagicMock()
        mock_session.post.side_effect = Exception("Connection error")

        result = fetch_ors_isochrone(-0.480, 52.136, 15, "test-key", session=mock_session)
        assert result is None

    def test_empty_features_returns_none(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"features": []}
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.post.return_value = mock_response

        result = fetch_ors_isochrone(-0.480, 52.136, 15, "test-key", session=mock_session)
        assert result is None


class TestFilterReachableStations:
    """Tests for filter_reachable_stations function."""

    def setup_method(self):
        self.journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
            {"terminus_crs": "KGX", "remote_crs": "PBO", "journey_minutes": 50,
             "remote_lat": 52.575, "remote_lon": -0.250},
            {"terminus_crs": "KGX", "remote_crs": "CBG", "journey_minutes": 48,
             "remote_lat": 52.194, "remote_lon": 0.137},
            {"terminus_crs": "KGX", "remote_crs": "NRW", "journey_minutes": None,
             "remote_lat": 52.627, "remote_lon": 1.307},
            {"terminus_crs": "PAD", "remote_crs": "RDG", "journey_minutes": 25,
             "remote_lat": 51.459, "remote_lon": -0.972},
        ]

    def test_filters_by_terminus(self):
        result = filter_reachable_stations(self.journey_times, "KGX", 60)
        crs_codes = [s["remote_crs"] for s in result]
        assert "RDG" not in crs_codes

    def test_excludes_none_journey_minutes(self):
        result = filter_reachable_stations(self.journey_times, "KGX", 60)
        crs_codes = [s["remote_crs"] for s in result]
        assert "NRW" not in crs_codes

    def test_excludes_stations_exceeding_budget(self):
        result = filter_reachable_stations(self.journey_times, "KGX", 60)
        crs_codes = [s["remote_crs"] for s in result]
        # PBO at 50 min: 60 - 50 = 10 >= 5, so included
        assert "PBO" in crs_codes

    def test_excludes_stations_at_budget_minus_buffer(self):
        # Budget 55, station at 50 min: 55 - 50 = 5, but filter is < budget - min_drive_buffer
        # 50 >= 55 - 5 = 50, so excluded
        result = filter_reachable_stations(self.journey_times, "KGX", 55)
        crs_codes = [s["remote_crs"] for s in result]
        assert "PBO" not in crs_codes

    def test_drive_budget_calculated(self):
        result = filter_reachable_stations(self.journey_times, "KGX", 60)
        bdm = [s for s in result if s["remote_crs"] == "BDM"][0]
        assert bdm["drive_budget"] == 16  # 60 - 44

    def test_custom_min_drive_buffer(self):
        result = filter_reachable_stations(
            self.journey_times, "KGX", 60, min_drive_buffer=15
        )
        crs_codes = [s["remote_crs"] for s in result]
        # BDM: 44 >= 60 - 15 = 45? No, 44 < 45, included
        assert "BDM" in crs_codes
        # PBO: 50 >= 60 - 15 = 45? Yes, excluded
        assert "PBO" not in crs_codes


class TestComputeIsochrone:
    """Tests for compute_isochrone function."""

    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_produces_valid_geojson(self, mock_sleep, mock_ors):
        mock_ors.return_value = SAMPLE_POLYGON

        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 1
        feature = result["features"][0]
        assert feature["type"] == "Feature"
        assert feature["geometry"]["type"] == "MultiPolygon"

    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_correct_properties(self, mock_sleep, mock_ors):
        mock_ors.return_value = SAMPLE_POLYGON

        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        props = result["features"][0]["properties"]
        assert props["terminus_crs"] == "KGX"
        assert props["terminus_name"] == "King's Cross"
        assert props["time_budget_minutes"] == 60
        assert props["station_count"] == 1
        assert "computed_at" in props

    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_unions_multiple_polygons(self, mock_sleep, mock_ors):
        poly1 = {
            "type": "Polygon",
            "coordinates": [[[-0.5, 52.0], [-0.4, 52.0], [-0.4, 52.1], [-0.5, 52.1], [-0.5, 52.0]]],
        }
        poly2 = {
            "type": "Polygon",
            "coordinates": [[[0.1, 52.1], [0.2, 52.1], [0.2, 52.2], [0.1, 52.2], [0.1, 52.1]]],
        }
        mock_ors.side_effect = [poly1, poly2]

        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
            {"terminus_crs": "KGX", "remote_crs": "CBG", "journey_minutes": 48,
             "remote_lat": 52.194, "remote_lon": 0.137},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        geom = shape(result["features"][0]["geometry"])
        assert geom.is_valid
        assert isinstance(geom, MultiPolygon)
        assert result["features"][0]["properties"]["station_count"] == 2

    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_handles_ors_failure_gracefully(self, mock_sleep, mock_ors):
        mock_ors.return_value = None

        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        assert result["type"] == "FeatureCollection"
        geom = result["features"][0]["geometry"]
        assert geom["type"] == "MultiPolygon"

    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_no_reachable_stations(self, mock_sleep, mock_ors):
        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "NRW", "journey_minutes": None,
             "remote_lat": 52.627, "remote_lon": 1.307},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        assert result["features"][0]["properties"]["station_count"] == 0
        mock_ors.assert_not_called()


    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_skips_invalid_geometry(self, mock_sleep, mock_ors):
        # Return something that shape() can't parse
        mock_ors.return_value = {"type": "InvalidType", "coordinates": "bad"}

        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        assert result["type"] == "FeatureCollection"
        assert result["features"][0]["properties"]["station_count"] == 1

    @patch("scripts.precompute.compute_isochrones.fetch_ors_isochrone")
    @patch("scripts.precompute.compute_isochrones.time.sleep")
    def test_single_polygon_becomes_multipolygon(self, mock_sleep, mock_ors):
        mock_ors.return_value = SAMPLE_POLYGON

        journey_times = [
            {"terminus_crs": "KGX", "remote_crs": "BDM", "journey_minutes": 44,
             "remote_lat": 52.136, "remote_lon": -0.480},
        ]

        result = compute_isochrone("KGX", "King's Cross", 60, journey_times, "key")
        assert result["features"][0]["geometry"]["type"] == "MultiPolygon"


class TestSaveGeojson:
    """Tests for save_geojson function."""

    def test_saves_valid_geojson(self, tmp_path):
        geojson = {"type": "FeatureCollection", "features": []}
        path = str(tmp_path / "sub" / "test.geojson")
        save_geojson(geojson, path)
        with open(path) as f:
            loaded = json.load(f)
        assert loaded == geojson

    def test_creates_parent_directories(self, tmp_path):
        geojson = {"type": "FeatureCollection", "features": []}
        path = str(tmp_path / "a" / "b" / "c" / "test.geojson")
        save_geojson(geojson, path)
        assert (tmp_path / "a" / "b" / "c" / "test.geojson").exists()
