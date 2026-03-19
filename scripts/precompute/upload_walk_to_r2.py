"""Upload pre-computed walk isochrone GeoJSON files to Cloudflare R2.

Usage:
  python -m scripts.precompute.upload_walk_to_r2
  python -m scripts.precompute.upload_walk_to_r2 --terminus KGX
"""

import argparse
import os
from pathlib import Path

# Load .env
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from scripts.precompute.upload_to_r2 import get_r2_client, upload_file
from scripts.precompute.compute_isochrones import LONDON_TERMINI

OUTPUT_DIR = Path(__file__).parent.parent.parent / "output"
TIME_BUCKETS = [30, 45, 60, 75, 90, 120]


def main():
    parser = argparse.ArgumentParser(description="Upload walk isochrones to R2")
    parser.add_argument("--terminus", help="Single terminus CRS (default: all)")
    parser.add_argument("--bucket", default="isohome", help="R2 bucket name")
    args = parser.parse_args()

    client = get_r2_client()
    termini = [args.terminus] if args.terminus else list(LONDON_TERMINI.keys())
    uploaded = 0

    for terminus in termini:
        for budget in TIME_BUCKETS:
            local_path = OUTPUT_DIR / "isochrones" / "walk" / terminus / f"{budget}.geojson"
            if not local_path.exists():
                print(f"  [MISSING] walk/{terminus}/{budget}.geojson — skipping")
                continue

            r2_key = f"isochrones/walk/{terminus}/{budget}.geojson"
            upload_file(client, str(local_path), args.bucket, r2_key)
            size_kb = local_path.stat().st_size / 1024
            print(f"  Uploaded: {r2_key} ({size_kb:.0f}KB)")
            uploaded += 1

    print(f"\nUploaded {uploaded} walk isochrone files to R2")


if __name__ == "__main__":
    main()
