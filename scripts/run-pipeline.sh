#!/bin/bash
# Run the IsoHome pre-computation pipeline.
# Designed to run in screen/tmux — loads .env automatically.
#
# Usage:
#   screen -S isohome
#   bash scripts/run-pipeline.sh              # full run
#   bash scripts/run-pipeline.sh fetch        # journey times only
#   bash scripts/run-pipeline.sh compute      # isochrones only
#   bash scripts/run-pipeline.sh fetch KGX    # single terminus
#
# Resume: just re-run — completed work is checkpointed and skipped.
# Cron:   0 3 * * 0 cd /Users/gy-joe/Projects/isohome && bash scripts/run-pipeline.sh

set -euo pipefail
cd "$(dirname "$0")/.."

STEP="${1:-all}"
TERMINUS="${2:-}"

ARGS="--step $STEP"
[ -n "$TERMINUS" ] && ARGS="$ARGS --terminus $TERMINUS"

echo "$(date): Starting pipeline ($ARGS)"
python scripts/precompute/run_all.py $ARGS 2>&1 | tee -a scripts/data/pipeline.log
echo "$(date): Pipeline finished"
