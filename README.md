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
┌─────────────────────────────────────────────────────────────────────────┐
│                        PRE-COMPUTATION (Python, offline)                │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐    │
│  │ Transport API │   │  ORS Docker  │   │    Static Data Sources   │    │
│  │  (timetable)  │   │ (self-hosted)│   │                          │    │
│  └──────┬───────┘   └──────┬───────┘   │  Met Office (sunshine)   │    │
│         │                  │            │  Land Registry (prices)  │    │
│         ▼                  ▼            │  data.police.uk (crime)  │    │
│  journey_times      drive-time          │  IoD25 (deprivation)     │    │
│  per station ×      polygons per        │  OSM Overpass (rail)     │    │
│  terminus           station             └───────────┬──────────────┘    │
│         │                  │                        │                   │
│         ▼                  ▼                        ▼                   │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                    Pipeline Scripts                          │       │
│  │  fetch_journey_times.py  →  compute_isochrones.py           │       │
│  │  enrich_isochrones.py    →  compute_rail_routes.py          │       │
│  │  compute_walk_isochrones.py                                 │       │
│  │  generate_sunshine.py / generate_house_prices.py            │       │
│  │  generate_crime.py / generate_deprivation.py                │       │
│  │  convert_rail_gis.py                                        │       │
│  └──────────────────────────┬──────────────────────────────────┘       │
│                             │                                           │
│                             ▼                                           │
│                    output/ (GeoJSON files)                              │
│                     ├── isochrones/{CRS}/{min}.geojson                  │
│                     ├── isochrones/walk/{CRS}/{min}.geojson             │
│                     └── static/*.geojson                                │
│                             │                                           │
│                             ▼                                           │
│                   upload_to_r2.py (boto3)                               │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE (runtime)                             │
│                                                                         │
│  ┌──────────────────┐          ┌──────────────────────────────┐        │
│  │    R2 Bucket      │◄────────│     Cloudflare Worker        │        │
│  │   "isohome"       │────────►│     (zero computation)       │        │
│  │                   │         │                              │        │
│  │  isochrones/      │         │  /api/isochrone/:crs/:min   │        │
│  │  isochrones/walk/ │         │  /api/isochrone/walk/:crs/… │        │
│  │  static/          │         │  /api/static/stations       │        │
│  │   stations.geojson│         │  /api/static/rail-lines     │        │
│  │   sunshine.geojson│         │  /api/static/sunshine       │        │
│  │   house-prices…   │         │  /api/static/house-prices   │        │
│  │   crime.geojson   │         │  /api/static/deprivation    │        │
│  │   deprivation…    │         │  /api/static/crime          │        │
│  └──────────────────┘          └──────────────┬───────────────┘        │
│                                               │                        │
│                        ┌──────────────────────┘                        │
│                        │  + serves SPA via Assets binding              │
└────────────────────────┼────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         REACT SPA (browser)                             │
│                                                                         │
│  ┌─────────────────┐  ┌───────────────────┐  ┌────────────────────┐   │
│  │  TanStack Query  │  │   Mapbox GL JS    │  │  Client-side       │   │
│  │                  │  │                   │  │  Scoring Engine     │   │
│  │  useQueries()    │  │  Isochrone fill   │  │                    │   │
│  │  parallel fetch  │  │  Walk circles     │  │  z-score normalize │   │
│  │  staleTime:∞     │  │  Route hover      │  │  weighted average  │   │
│  │  for static data │  │  Station dots     │  │  heatmap render    │   │
│  └────────┬────────┘  │  Rail lines       │  │  (costField.ts)    │   │
│           │           │  Search geocode   │  └────────────────────┘   │
│           │           │  Heatmap layer    │                           │
│           ▼           └───────────────────┘                           │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │                  IsoHomeControls                             │      │
│  │  Terminus multi-select │ Time slider │ Transport modes      │      │
│  │  Desirability layers (sunshine, price, crime, deprivation)  │      │
│  │  Colormap picker │ Map overlays │ Search box                │      │
│  └─────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

Key architectural patterns:

- **Pre-computation over runtime computation**: All expensive GIS operations (polygon union, drive-time polygon calculation) happen offline at build time. The Cloudflare Worker is a pure R2 proxy with zero computation, so serving a request is just a key-value lookup.
- **Checkpoint/resume pipeline**: The Python pipeline tracks completed work in `scripts/data/checkpoint.json`, making it safe to interrupt and restart without re-doing finished steps. `recompute_isochrones.py` goes further and auto-restarts the local ORS Docker container if it crashes mid-run.
- **Rate limiting**: The pipeline includes configurable delays between API calls (0.2s for Transport API, 1.5s for the public ORS endpoint) to avoid throttling.
- **TanStack Query orchestration**: The frontend fires parallel queries for multiple terminus isochrones using `useQueries`, with `staleTime: Infinity` for static data (stations, rail lines, environmental layers) that only needs fetching once per session.
- **Graceful degradation**: MSW (Mock Service Worker) provides a full mock API layer for development, so the frontend runs without any backend (`VITE_USE_MOCKS=true`).

### Desirability heatmap

Beyond showing *where* you can commute from, IsoHome answers **which of those places is actually desirable** by overlaying weighted data layers as a heatmap inside the isochrone boundary.

Four layers are included:

| Layer | Source | Value | Directionality |
|-------|--------|-------|----------------|
| **Sunshine** | Met Office UK climate averages | Annual sunshine hours (900-1900 h/yr) | Higher = better |
| **House price** | Land Registry Price Paid Data | Median price in GBP (£80k-£2M) | Lower = better |
| **Crime rate** | [data.police.uk](https://data.police.uk/) bulk data | Crimes per 1,000 pop/yr (15-250) | Lower = better |
| **Deprivation** | English Indices of Deprivation 2025 (MHCLG) | IMD Score (0-80+) | Lower = better |

Each layer is a static GeoJSON file of Point features with `properties.value`. The data is served from Cloudflare R2 via `/api/static/{layer}` and fetched once per session (TanStack Query, `staleTime: Infinity`).

#### How the desirability index works

The score at each sample point is computed client-side in three steps:

1. **Grid sampling**: A 0.05° (~5 km) grid is generated over the isochrone bounding box, then clipped to the isochrone polygon using `@turf/boolean-point-in-polygon`.

2. **Standard scalar normalisation**: Each layer's raw value is z-scored against fixed population statistics, then mapped to 0-1 via a sigmoid:

   ```
   z = (raw_value - population_mean) / population_stddev
   norm = 1 / (1 + exp(-z))
   ```

   This ensures scores are stable regardless of which isochrone is visible. A value at the population mean always maps to 0.5; values 2 standard deviations above map to ~0.88.

   For "lower is better" layers (house price, crime), the normalised score is inverted: `norm = 1 - norm`.

3. **Weighted average**: Each layer's normalised score is multiplied by the user's weight (0-10) and averaged:

   ```
   score = sum(norm_i * weight_i) / sum(weight_i)
   ```

   Setting a weight to 0 or unchecking a layer excludes it entirely.

4. **Nearest-neighbour lookup**: Each grid point finds the closest data point in the layer's GeoJSON using squared Euclidean distance, with a 0.15° (~15 km) threshold to avoid extrapolation into data-sparse areas. This is a linear scan per query — fast enough given the ~5 km grid density.

The resulting `CostPoint[]` array is rendered as a Mapbox GL heatmap layer with zoom-adaptive radius (smooth at all zoom levels). Two colormaps are available: Jet (default) and Viridis.

#### Population statistics

| Layer | Mean | Std Dev |
|-------|------|---------|
| Sunshine | 1660.8 h | 146.5 h |
| House price | £192,049 | £76,572 |
| Crime rate | 51.8 /1k | 13.5 /1k |
| Deprivation | 23.6 IMD | 11.8 IMD |

### Data sources

| Data | Source | Notes |
|------|--------|-------|
| Train journey times | [Transport API](https://www.transportapi.com/) timetable endpoint | Morning peak, next Tuesday |
| Drive-time polygons | [OpenRouteService](https://openrouteservice.org/) (self-hosted Docker) | Full GB road network from OSM |
| Rail line geometry | [OpenStreetMap](https://www.openstreetmap.org/) via Overpass API | `railway=rail, usage=main`, Douglas-Peucker simplified at 0.001° (~100 m) |
| Station locations | Curated list of 116 UK mainline stations | CRS code, name, lat/lon |
| Sunshine hours | [Met Office](https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-averages) UK climate averages | 0.1° grid, ~11.6k points |
| House prices | [Land Registry](https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads) Price Paid Data | Postcode district centroids, ~2.8k points |
| Crime rates | [data.police.uk](https://data.police.uk/data/) bulk download | LSOA-level, England & Wales, ~3k points |
| Deprivation | [English Indices of Deprivation 2025](https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025) (MHCLG) | IMD Score per LSOA, ~33k areas |
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

Additional layers follow the same pattern as sunshine, house price, and crime:

1. Create a precomputation script in `scripts/precompute/` that produces GeoJSON
2. Upload the GeoJSON to R2 under `static/`
3. Add a Worker endpoint in `worker/index.ts`
4. Add a toggle in `IsoHomeControls.tsx` and a map layer in `IsoHomeMap.tsx`
5. Fetch via TanStack Query with `staleTime: Infinity`
6. Add population statistics (mean, stddev) to `costField.ts` for z-score normalisation

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
│   │   ├── utils/              # costField (z-score scoring), formatTime, sliderIndex
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
