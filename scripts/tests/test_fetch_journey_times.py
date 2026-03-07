"""Tests for fetch_journey_times module."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.precompute.fetch_journey_times import (
    _next_tuesday,
    _time_to_minutes,
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


class TestTimeToMinutes:
    """Tests for _time_to_minutes helper."""

    def test_morning_time(self):
        assert _time_to_minutes("08:30") == 510

    def test_midnight(self):
        assert _time_to_minutes("00:00") == 0

    def test_invalid(self):
        assert _time_to_minutes("invalid") is None


class TestNextTuesday:
    """Tests for _next_tuesday helper."""

    def test_returns_iso_date(self):
        result = _next_tuesday()
        assert len(result) == 10
        assert result[4] == "-"


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


def _mock_timetable_response(dep_time="08:10", train_uid="C51378"):
    """Create a mock timetable API response."""
    resp = MagicMock()
    resp.json.return_value = {
        "departures": {
            "all": [
                {
                    "aimed_departure_time": dep_time,
                    "service_timetable": {
                        "id": f"https://transportapi.com/v3/uk/train/service_timetables/{train_uid}:2026-03-10.json"
                    },
                }
            ]
        }
    }
    resp.raise_for_status = MagicMock()
    return resp


def _mock_service_timetable_response(terminus_crs="KGX", arr_time="08:51"):
    """Create a mock service timetable API response."""
    resp = MagicMock()
    resp.json.return_value = {
        "stops": [
            {"station_code": "BDM", "aimed_departure_time": "08:10", "aimed_arrival_time": "08:09"},
            {"station_code": terminus_crs, "aimed_arrival_time": arr_time, "aimed_departure_time": None},
        ]
    }
    resp.raise_for_status = MagicMock()
    return resp


class TestFetchJourneyTime:
    """Tests for fetch_journey_time function (timetable-based)."""

    def test_successful_fetch(self):
        timetable_resp = _mock_timetable_response(dep_time="08:10")
        svc_resp = _mock_service_timetable_response(terminus_crs="KGX", arr_time="08:51")

        mock_session = MagicMock()
        mock_session.get.side_effect = [timetable_resp, svc_resp]

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["remote_crs"] == "BDM"
        assert result["terminus_crs"] == "KGX"
        assert result["journey_minutes"] == 41  # 08:51 - 08:10
        assert result["changes"] == 0

    def test_no_departures_returns_none(self):
        resp = MagicMock()
        resp.json.return_value = {"departures": {"all": []}}
        resp.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = resp

        result = fetch_journey_time("ZZZ", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] is None

    def test_request_failure_returns_none(self):
        mock_session = MagicMock()
        mock_session.get.side_effect = Exception("Connection error")

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] is None
        assert result["remote_crs"] == "BDM"

    def test_service_timetable_failure_returns_none(self):
        timetable_resp = _mock_timetable_response()
        mock_session = MagicMock()
        mock_session.get.side_effect = [timetable_resp, Exception("timeout")]

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] is None

    def test_terminus_not_in_stops_returns_none(self):
        timetable_resp = _mock_timetable_response()
        svc_resp = MagicMock()
        svc_resp.json.return_value = {
            "stops": [
                {"station_code": "BDM", "aimed_departure_time": "08:10"},
                {"station_code": "OTHER", "aimed_arrival_time": "09:00"},
            ]
        }
        svc_resp.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.side_effect = [timetable_resp, svc_resp]

        result = fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session)
        assert result["journey_minutes"] is None

    def test_api_url_uses_timetable_endpoint(self):
        resp = MagicMock()
        resp.json.return_value = {"departures": {"all": []}}
        resp.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = resp

        fetch_journey_time("BDM", "KGX", "myid", "mykey", session=mock_session)

        call_args = mock_session.get.call_args
        url = call_args[0][0]
        assert "/train/station/BDM/timetable.json" in url
        params = call_args[1]["params"]
        assert params["app_id"] == "myid"
        assert params["app_key"] == "mykey"
        assert params["calling_at"] == "KGX"

    def test_uses_ref_date(self):
        resp = MagicMock()
        resp.json.return_value = {"departures": {"all": []}}
        resp.raise_for_status = MagicMock()

        mock_session = MagicMock()
        mock_session.get.return_value = resp

        fetch_journey_time("BDM", "KGX", "id", "key", session=mock_session, ref_date="2026-04-01")

        params = mock_session.get.call_args[1]["params"]
        assert params["date"] == "2026-04-01"


class TestFetchAllJourneyTimes:
    """Tests for fetch_all_journey_times function."""

    @patch("scripts.precompute.fetch_journey_times.time.sleep")
    def test_fetches_for_each_station(self, mock_sleep):
        timetable_resp = _mock_timetable_response(dep_time="08:10")
        svc_resp = _mock_service_timetable_response(terminus_crs="KGX", arr_time="08:51")

        mock_session = MagicMock()
        mock_session.get.side_effect = [timetable_resp, svc_resp, timetable_resp, svc_resp]

        stations = [
            {"crs": "BDM", "name": "Bedford", "lat": 52.136, "lon": -0.480},
            {"crs": "CBG", "name": "Cambridge", "lat": 52.194, "lon": 0.137},
        ]

        with patch("scripts.precompute.fetch_journey_times.requests.Session", return_value=mock_session):
            results = fetch_all_journey_times("KGX", stations, "id", "key", delay=0)
        assert len(results) == 2
        assert results[0]["remote_name"] == "Bedford"
        assert results[1]["remote_name"] == "Cambridge"

    @patch("scripts.precompute.fetch_journey_times.time.sleep")
    def test_applies_delay_between_calls(self, mock_sleep):
        # Each station call needs timetable + svc_timetable responses
        timetable_resp = _mock_timetable_response()
        svc_resp = _mock_service_timetable_response()

        mock_session = MagicMock()
        mock_session.get.side_effect = [
            timetable_resp, svc_resp,
            timetable_resp, svc_resp,
            timetable_resp, svc_resp,
        ]

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
