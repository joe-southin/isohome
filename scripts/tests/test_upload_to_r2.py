"""Tests for upload_to_r2 module."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.precompute.upload_to_r2 import (
    get_r2_client,
    upload_file,
    upload_output_directory,
)


class TestGetR2Client:
    """Tests for get_r2_client function."""

    @patch("scripts.precompute.upload_to_r2.boto3.client")
    def test_creates_client_with_env_vars(self, mock_boto_client):
        with patch.dict("os.environ", {
            "CF_ACCOUNT_ID": "test-account",
            "R2_ACCESS_KEY_ID": "test-key",
            "R2_SECRET_ACCESS_KEY": "test-secret",
        }):
            get_r2_client()
            mock_boto_client.assert_called_once_with(
                "s3",
                endpoint_url="https://test-account.r2.cloudflarestorage.com",
                aws_access_key_id="test-key",
                aws_secret_access_key="test-secret",
            )

    @patch("scripts.precompute.upload_to_r2.boto3.client")
    def test_creates_client_with_explicit_params(self, mock_boto_client):
        get_r2_client(
            account_id="my-account",
            access_key_id="my-key",
            secret_access_key="my-secret",
        )
        mock_boto_client.assert_called_once_with(
            "s3",
            endpoint_url="https://my-account.r2.cloudflarestorage.com",
            aws_access_key_id="my-key",
            aws_secret_access_key="my-secret",
        )


class TestUploadFile:
    """Tests for upload_file function."""

    def test_uploads_with_correct_params(self):
        mock_client = MagicMock()
        upload_file(mock_client, "/tmp/test.geojson", "isohome", "isochrones/KGX/60.geojson")
        mock_client.upload_file.assert_called_once_with(
            "/tmp/test.geojson",
            "isohome",
            "isochrones/KGX/60.geojson",
            ExtraArgs={"ContentType": "application/geo+json"},
        )

    def test_custom_content_type(self):
        mock_client = MagicMock()
        upload_file(mock_client, "/tmp/test.json", "isohome", "data.json", content_type="application/json")
        mock_client.upload_file.assert_called_once_with(
            "/tmp/test.json",
            "isohome",
            "data.json",
            ExtraArgs={"ContentType": "application/json"},
        )


class TestUploadOutputDirectory:
    """Tests for upload_output_directory function."""

    def test_uploads_all_geojson_files(self, tmp_path):
        # Create test files
        iso_dir = tmp_path / "isochrones" / "KGX"
        iso_dir.mkdir(parents=True)
        (iso_dir / "60.geojson").write_text('{"type":"FeatureCollection","features":[]}')
        static_dir = tmp_path / "static"
        static_dir.mkdir()
        (static_dir / "stations.geojson").write_text('{"type":"FeatureCollection","features":[]}')

        mock_client = MagicMock()
        uploaded = upload_output_directory(mock_client, str(tmp_path), "isohome")

        assert len(uploaded) == 2
        assert mock_client.upload_file.call_count == 2
        assert "isochrones/KGX/60.geojson" in uploaded
        assert "static/stations.geojson" in uploaded

    def test_empty_directory(self, tmp_path):
        mock_client = MagicMock()
        uploaded = upload_output_directory(mock_client, str(tmp_path), "isohome")
        assert len(uploaded) == 0
        mock_client.upload_file.assert_not_called()
