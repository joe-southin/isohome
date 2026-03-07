"""Upload pre-computed GeoJSON files to Cloudflare R2."""

import os
from pathlib import Path
from typing import Optional

import boto3


def get_r2_client(
    account_id: Optional[str] = None,
    access_key_id: Optional[str] = None,
    secret_access_key: Optional[str] = None,
):
    """Create an S3-compatible client for Cloudflare R2.

    Args:
        account_id: Cloudflare account ID. Defaults to CF_ACCOUNT_ID env var.
        access_key_id: R2 access key. Defaults to R2_ACCESS_KEY_ID env var.
        secret_access_key: R2 secret key. Defaults to R2_SECRET_ACCESS_KEY env var.

    Returns:
        boto3 S3 client configured for R2.
    """
    account_id = account_id or os.environ["CF_ACCOUNT_ID"]
    access_key_id = access_key_id or os.environ["R2_ACCESS_KEY_ID"]
    secret_access_key = secret_access_key or os.environ["R2_SECRET_ACCESS_KEY"]

    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
    )


def upload_file(
    client,
    local_path: str,
    bucket: str,
    r2_key: str,
    content_type: str = "application/geo+json",
) -> None:
    """Upload a single file to R2.

    Args:
        client: boto3 S3 client.
        local_path: Path to the local file.
        bucket: R2 bucket name.
        r2_key: Object key in R2.
        content_type: MIME type for the uploaded object.
    """
    client.upload_file(
        local_path,
        bucket,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )


def upload_output_directory(
    client,
    output_dir: str = "output",
    bucket: str = "isohome",
) -> list[str]:
    """Upload all GeoJSON files from the output directory to R2.

    Args:
        client: boto3 S3 client.
        output_dir: Local output directory root.
        bucket: R2 bucket name.

    Returns:
        List of R2 keys that were uploaded.
    """
    uploaded = []
    output_path = Path(output_dir)

    for file_path in output_path.rglob("*.geojson"):
        r2_key = str(file_path.relative_to(output_path))
        upload_file(client, str(file_path), bucket, r2_key)
        uploaded.append(r2_key)
        print(f"Uploaded: {r2_key}")

    return uploaded


if __name__ == "__main__":
    client = get_r2_client()
    uploaded = upload_output_directory(client)
    print(f"\nUploaded {len(uploaded)} files to R2")
