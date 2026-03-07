"""Tests for fetch_journey_times module."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.precompute.fetch_journey_times import (
    fetch_all_journey_times,
    fetch_journey_time,
    load_stations,
    parse_duration,
    save_journey_times,
)


class TestParseDuration:
    """Tests for the parse_duration function."""

    def test_iso_hours_and_minutes(self):
        assert parse_duration("PT1H5M") == 65

    def test_iso_minutes_only(self):
        assert parse_duration("PT45M") == 45

    def test_iso_hours_only(self):
        assert parse_duration("PT2H") == 120

    def test_hms_format(self):
        assert parse_duration("01:05:00") == 65

    def test_hms_minutes_only(self):
        assert parse_duration("00:45:00") == 45

    def test_empty_string(self):
        assert parse_duration("") is None

    def test_none_input(self):
        assert parse_duration(None) is None

    def test_invalid_format(self):
        assert parse_duration("invalid") is None

    def test_iso_with_seconds(self):
        assert parse_duration("PT1H5M30S") == 65


class TestLoadStations:
    """Tests for load_stations function."""

    def test_loads_stations_from_file(self, tmp_path):
        stations = [{"crs": "BDM", "name": "Bedford", "lat": 52.136, "lon": -0.480}]
        path = tmp_path / "stations.json"
        path.write_text(json.dumps(stations))
        result = load_stations(str(path))
        assert len(result) == 1
        assert result[0]["crs"] == "BDM"

    def test_loads_real_stations_file(self):
        path = str(Path(__file__).parent.parent / "precompute" / "stations.json")
        result = load_stations(path)
        assert len(result) >= 100
        crs_codes = [s["crs"] for s in result]
        assert "BDM" in crs_codes
        assert "FLT" in crs_codes
        assert "CBG" in crs_codes


class TestFetchJourneyTime:
    """Tests for fetch_journey_time function."""

    def test_successful_fetch_iso_duration(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "routes": [
                {
                    "duration": "PT1H5M",
                    "route_parts": [{"mode": "train"}, {"mode": "train"}],
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["remote_crs"] == "BDM"
        assert result["terminus_crs"] == "KGX"
        assert result["journey_minutes"] == 65
        assert result["changes"] == 1

    def test_successful_fetch_hms_duration(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "routes": [
                {
                    "duration": "00:44:00",
                    "route_parts": [{"mode": "train"}],
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        result = fetch_journey_time("FLT", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] == 44
        assert result["changes"] == 0

    def test_no_routes_returns_none(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"routes": []}
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        result = fetch_journey_time("ZZZ", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] is None

    def test_request_failure_returns_none(self):
        mock_session = MagicMock()
        mock_session.get.side_effect = Exception("Connection error")

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] is None
        assert result["remote_crs"] == "BDM"

    def test_api_url_construction(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"routes": []}
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        fetch_journey_time("BDM", "KGX", "myid", "mykey", session=mock_session)

        call_args = mock_session.get.call_args
        url = call_args[0][0]
        assert "station_code:BDM" in url
        assert "station_code:KGX" in url
        params = call_args[1]["params"]
        assert params["app_id"] == "myid"
        assert params["app_key"] == "mykey"
        assert params["date"] == "next_tuesday"
        assert params["time"] == "08:30"

    def test_empty_route_parts_zero_changes(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "routes": [{"duration": "PT30M", "route_parts": []}]
        }
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["changes"] == 0


class TestFetchAllJourneyTimes:
    """Tests for fetch_all_journey_times function."""

    @patch("scripts.precompute.fetch_journey_times.time.sleep")
    def test_fetches_for_each_station(self, mock_sleep):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "routes": [{"duration": "PT44M", "route_parts": [{"mode": "train"}]}]
        }
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        stations = [
            {"crs": "BDM", "name": "Bedford", "lat": 52.136, "lon": -0.480},
            {"crs": "CBG", "name": "Cambridge", "lat": 52.194, "lon": 0.137},
        ]

        with patch("scripts.precompute.fetch_journey_times.requests.Session", return_value=mock_session):
            results = fetch_all_journey_times("KGX", stations, "id", "key", delay=0)
        assert len(results) == 2
        assert mock_session.get.call_count == 2
        assert results[0]["remote_name"] == "Bedford"
        assert results[1]["remote_name"] == "Cambridge"

    @patch("scripts.precompute.fetch_journey_times.time.sleep")
    def test_applies_delay_between_calls(self, mock_sleep):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "routes": [{"duration": "PT44M", "route_parts": [{"mode": "train"}]}]
        }
        mock_response.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = mock_response

        stations = [
            {"crs": "BDM", "name": "Bedford", "lat": 52.136, "lon": -0.480},
            {"crs": "CBG", "name": "Cambridge", "lat": 52.194, "lon": 0.137},
            {"crs": "SVG", "name": "Stevenage", "lat": 51.902, "lon": -0.207},
        ]

        with patch("scripts.precompute.fetch_journey_times.requests.Session", return_value=mock_session):
            fetch_all_journey_times("KGX", stations, "id", "key", delay=0.5)
        assert mock_sleep.call_count == 2
        mock_sleep.assert_called_with(0.5)


class TestSaveJourneyTimes:
    """Tests for save_journey_times function."""

    def test_saves_to_file(self, tmp_path):
        data = [{"remote_crs": "BDM", "journey_minutes": 44}]
        output = str(tmp_path / "subdir" / "output.json")
        save_journey_times(data, output)
        with open(output) as f:
            loaded = json.load(f)
        assert loaded == data
