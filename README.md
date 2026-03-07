# IsoHome — UK Commute Isochrone Map

IsoHome visualises which areas of the UK fall within a given commute time of a London terminus station. It combines **train journey times** with **drive-to-station polygons** to produce realistic isochrone maps that account for actual road networks and rail timetables.

**Live**: [isohome.joe-southin.workers.dev](https://isohome.joe-southin.workers.dev/isohome)

## How it works

The key insight is that commute time from any point to London = **drive to nearest station** + **train to terminus**. For a given time budget (e.g. 60 minutes), the app:

1. **Filters stations** where the train journey time leaves enough driving budget: `drive_budget = total_budget - train_minutes` (minimum 5-minute drive buffer).
2. **Computes drive-time isochrones** around each reachable station using OpenRouteService, with the remaining drive budget as the radius.
3. **Unions all polygons** into one MultiPolygon — this is the area from which you can commute within the budget.

For example, Clophill in Bedfordshire (10-minute drive to Flitwick + 41-minute train to St Pancras = 51 minutes) falls inside the 60-minute St Pancras isochrone.

### Architecture

```
PRE-COMPUTATION (Python, offline)
  Transport API → journey times per station × terminus
  ORS Docker    → drive-time polygon per station
  Shapely       → union polygons → GeoJSON files
  boto3         → upload to Cloudflare R2

CLOUDFLARE WORKER (runtime, no computation)
  GET /api/isochrone/:crs/:minutes  → R2 → GeoJSON
  GET /api/static/stations          → R2 → GeoJSON
  GET /api/static/rail-lines        → R2 → GeoJSON

REACT SPA
  Mapbox GL JS map + TanStack Query + Tailwind CSS
  Multi-select termini + time slider + layer toggles
```

### Data sources

| Data | Source | Notes |
|------|--------|-------|
| Train journey times | [Transport API](https://www.transportapi.com/) timetable endpoint | Morning peak, next Tuesday |
| Drive-time polygons | [OpenRouteService](https://openrouteservice.org/) (self-hosted Docker) | Full GB road network from OSM |
| Rail line geometry | [OpenStreetMap](https://www.openstreetmap.org/) via Overpass API | `railway=rail, usage=main` |
| Station locations | Curated list of 116 UK mainline stations | CRS code, name, lat/lon |
| Base map | [Mapbox GL JS](https://www.mapbox.com/) | `light-v11` style |

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- Docker (for ORS, pre-computation only)
- Cloudflare account with R2 bucket `isohome`

### Environment variables

Create `.env` in the project root:

```bash
# Frontend
VITE_MAPBOX_TOKEN=pk.xxx

# Pre-computation
TRANSPORT_API_APP_ID=xxx
TRANSPORT_API_APP_KEY=xxx
ORS_API_KEY=xxx              # or use local Docker
ORS_BASE_URL=http://localhost:8080/ors/v2  # local ORS

# Deployment
CF_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
```

### Install

```bash
npm install
pip install -r scripts/precompute/requirements.txt
```

## Running

### Frontend development

```bash
npm run dev          # Vite dev server with MSW mocks (no backend needed)
# or
npm run dev          # with VITE_USE_MOCKS=false in .env.local to hit live worker
```

The Vite proxy forwards `/api/*` requests to the deployed Cloudflare Worker.

### Pre-computation pipeline

The pipeline produces all isochrone GeoJSON files. It requires either the ORS public API or a local ORS Docker instance.

**Start ORS Docker** (recommended for bulk computation):

```bash
# Download GB OSM extract (~2GB)
wget -P ors-docker/files/ https://download.geofabrik.de/europe/great-britain-latest.osm.pbf

# Start ORS with 8GB heap
docker run -dt --name ors-app -p 8080:8082 \
  -e XMX=8g \
  -v $(pwd)/ors-docker/files:/home/ors/files \
  -v $(pwd)/ors-docker/config:/home/ors/config \
  openrouteservice/openrouteservice:latest

# Wait for graph build (~10 min for full GB)
docker logs -f ors-app
```

**Run the full pipeline**:

```bash
# Fetch journey times + compute isochrones for all 11 termini × 6 time buckets
python -m scripts.precompute.run_all

# Or step by step:
python -m scripts.precompute.run_all --step fetch       # journey times only
python -m scripts.precompute.run_all --step compute      # isochrones only
python -m scripts.precompute.run_all --terminus KGX      # single terminus

# Resilient recomputation (auto-restarts ORS on crash):
python -m scripts.precompute.recompute_isochrones
python -m scripts.precompute.recompute_isochrones --skip KGX PAD  # skip done ones
```

**Upload to R2**:

```bash
python -m scripts.precompute.upload_to_r2  # or handled by run_all.py
```

### Deploy

```bash
npm run deploy       # deploys Worker to Cloudflare
```

## Testing

```bash
# Frontend tests (Vitest + React Testing Library)
npm test             # run once
npm run test:watch   # watch mode
npm run test:coverage # with coverage (80% threshold enforced)

# Worker tests
npm run test:worker

# Python tests
python -m pytest scripts/tests/ -v
python -m pytest scripts/tests/ --cov=scripts/precompute  # with coverage
```

### Realistic test cases

| Scenario | Route | Expected |
|----------|-------|----------|
| Clophill → STP (60 min) | 10 min drive to Flitwick + 41 min train | Inside isochrone |
| Clophill → STP (30 min) | 51 min total | Outside isochrone |
| Bedford → KGX (60 min) | 44 min train + 16 min drive budget | Inside isochrone |
| Cambridge → KGX (60 min) | 48 min train + 12 min drive budget | Inside isochrone |

## How to extend

### Adding a new terminus

1. Add to `scripts/precompute/compute_isochrones.py` → `LONDON_TERMINI`
2. Add to `scripts/precompute/generate_static_journey_times.py` → `STATION_TERMINUS_TIMES`
3. Add to `src/features/isohome/config.ts` → `LONDON_TERMINI`
4. Add to `worker/index.ts` → `VALID_CRS`
5. Run `python -m scripts.precompute.run_all --terminus NEW`
6. Upload to R2 and redeploy

### Adding a new data layer

Future layers (house prices, school ratings, sunshine hours, etc.) follow the pattern:

1. Create a precomputation script in `scripts/precompute/` that produces GeoJSON
2. Upload the GeoJSON to R2 under `static/`
3. Add a Worker endpoint in `worker/index.ts`
4. Add a toggle in `IsoHomeControls.tsx` and a map layer in `IsoHomeMap.tsx`
5. Fetch via TanStack Query with `staleTime: Infinity`

### Adding a transport mode

To add tube/walking support:

1. Extend `compute_isochrones.py` to accept a mode parameter
2. For tube: use the TfL Journey Planner API for zones 3–6
3. For walking: use ORS walking profile (`isochrones/foot-walking`)
4. Compute separate isochrones per mode and union with the existing rail+drive polygon

## Project structure

```
isohome/
├── src/
│   ├── features/isohome/       # Main feature
│   │   ├── config.ts           # Termini + time bucket constants
│   │   ├── IsoHomePage.tsx     # Page component with TanStack Query
│   │   ├── IsoHomeControls.tsx # Multi-select + slider + toggles
│   │   ├── IsoHomeMap.tsx      # Mapbox GL JS wrapper
│   │   ├── utils/              # formatTime, sliderIndex
│   │   └── __tests__/          # Vitest tests
│   ├── mocks/                  # MSW handlers + fixtures
│   ├── App.tsx                 # Router
│   └── main.tsx                # Entry point + MSW bootstrap
├── worker/
│   └── index.ts                # Cloudflare Worker (R2 proxy)
├── scripts/
│   ├── precompute/             # Python data pipeline
│   │   ├── stations.json       # 116 UK mainline stations
│   │   ├── fetch_journey_times.py
│   │   ├── compute_isochrones.py
│   │   ├── convert_rail_gis.py
│   │   ├── generate_static_journey_times.py
│   │   ├── recompute_isochrones.py
│   │   └── run_all.py          # Orchestrated pipeline
│   └── tests/                  # pytest test suite
├── output/                     # Generated GeoJSON (git-ignored)
│   ├── isochrones/{CRS}/{min}.geojson
│   └── static/
├── BRIEF.md                    # Problem statement
├── SPEC.md                     # Implementation blueprint
└── PLAN.md                     # Phased execution roadmap
```

## Maths

For a point P on the map to be "within X minutes of terminus T":

```
commute_time(P, T) = drive_time(P, nearest_station_S) + train_time(S, T) ≤ X
```

Where:
- `drive_time(P, S)` is computed by ORS using the real road network (OSM data)
- `train_time(S, T)` is the scheduled journey time from the timetable
- `nearest_station_S` is whichever reachable station minimises total commute time

The isochrone polygon is the union of all drive-time polygons:

```
isochrone(T, X) = ⋃ { ORS_drive_polygon(S, X - train_time(S, T)) }
                  for all stations S where train_time(S, T) ≤ X - 5
```

The 5-minute minimum drive buffer prevents stations where the train journey alone nearly exhausts the budget from contributing tiny, unhelpful polygons.
