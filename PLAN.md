# Plan: IsoHome — Phased Implementation

> **Purpose**: Execution roadmap. Each phase is a self-contained Claude session prompt.
> Start a new session, paste the session prompt, and build.

---

## Note on Google APIs (architectural decision, recorded here)

> **Decision**: Do NOT replace ORS with Google APIs for isochrone computation.
>
> Google Maps has no isochrone endpoint. Approximating one using the Distance Matrix API
> (grid of points → travel time per point → reconstruct polygon) would cost ~$200+ per
> full UK computation run and produce a blocky, grid-limited result.
>
> The right tool split is:
> - **Transport API** → train journey times (you have a key; best UK rail data)
> - **OpenRouteService (ORS)** → drive-time polygons (free; purpose-built isochrone API)
>
> For Phase 2 (tube/Overground connections), the TfL Journey Planner API is a better
> extension point than Google Transit — it's free for TfL routes and covers the Underground
> natively. ORS continues to handle the drive-time polygon layer regardless.

---

## Phase overview

```
Phase 1: Data pipeline foundation
Phase 2: Worker API + R2 storage
Phase 3: React map UI
Phase 4: Full pre-computation + deployment
Phase 5: (Future) Tube / real-time / additional layers
```

---

## Phase 1 — Data pipeline foundation

**Goal**: Python scripts that can fetch journey times from Transport API and produce isochrone GeoJSON files for one terminus + one time bucket. Proof of concept that the pipeline works end-to-end.

**Deliverables**:
- `scripts/precompute/fetch_journey_times.py` — queries Transport API, outputs `data/journey_times.json`
- `scripts/precompute/compute_isochrones.py` — reads journey times, queries ORS, unions polygons, outputs `output/isochrones/KGX/60.geojson`
- `scripts/precompute/stations.json` — static list of UK mainline stations (CRS, name, lat, lon)
- One working isochrone GeoJSON verified visually in geojson.io

**Dependencies**:
- Python packages: `requests`, `shapely`, `fiona` (or `geopandas`), `boto3`
- Transport API credentials: `TRANSPORT_API_APP_ID`, `TRANSPORT_API_APP_KEY`
- ORS API key: free registration at openrouteservice.org → `ORS_API_KEY`

**Acceptance**:
- Running `python compute_isochrones.py --terminus KGX --minutes 60` produces a valid GeoJSON
- Pasting the output into geojson.io shows a plausible UK region centred around London
- Clophill, Bedfordshire (~52.03°N, -0.44°W) falls inside the polygon
- `pytest scripts/tests/ --cov=scripts/precompute` reports ≥80% coverage

---

### Phase 1 session prompt

```
Read BRIEF.md and SPEC.md.

Implement Phase 1: Data pipeline foundation.

Goal: Python scripts to fetch UK rail journey times from Transport API and compute
one isochrone GeoJSON (King's Cross, 60 minutes) using the OpenRouteService API.

Deliverables:
  scripts/precompute/
    stations.json               # static UK mainline station list (CRS, name, lat, lon)
    fetch_journey_times.py      # queries Transport API for all stations → KGX, 08:30 Tuesday
    compute_isochrones.py       # reads journey times, calls ORS, unions polygons, writes GeoJSON
    requirements.txt            # requests, shapely, fiona, boto3, pytest, pytest-mock, pytest-cov
  scripts/tests/
    test_fetch_journey_times.py # mock Transport API responses; test duration parsing
    test_compute_isochrones.py  # mock ORS responses; test polygon union + drive budget logic

Start from: empty scripts/ directory.

Key spec notes:
- Transport API pattern: GET https://transportapi.com/v3/uk/public/journey/from/station_code:{crs}/to/station_code:{crs}.json
  with params: app_id, app_key, date=next_tuesday, time=08:30, type=fastest
- Journey duration field: routes[0].duration (verify against actual API response)
- ORS isochrone: POST https://api.openrouteservice.org/v2/isochrones/driving-car
  body: {"locations": [[lon, lat]], "range": [seconds], "range_type": "time"}
- Drive budget = total_budget_minutes - journey_minutes (min 5 min drive buffer)
- Use shapely.ops.unary_union() to merge all drive polygons
- Output: output/isochrones/KGX/60.geojson (valid GeoJSON MultiPolygon)

Credentials come from environment variables (never hardcoded):
  TRANSPORT_API_APP_ID, TRANSPORT_API_APP_KEY, ORS_API_KEY

Also implement pytest test suite (see spec section 9.4):
- Mock all HTTP calls with pytest-mock; no real API requests in tests
- Test duration field parsing from Transport API response
- Test drive budget calculation (total - train_time, min 5 min buffer)
- Test polygon union produces a valid shapely geometry
- Target: ≥80% coverage on scripts/precompute/
```

---

## Phase 2 — Static data prep + Cloudflare Worker API

**Goal**: Network Rail GIS data converted to GeoJSON, everything uploaded to R2, and the three Worker API endpoints live and returning data.

**Deliverables**:
- `scripts/precompute/convert_rail_gis.py` — converts Network Rail GeoPackage → `output/static/stations.geojson` + `output/static/rail-lines.geojson`
- `scripts/precompute/upload_to_r2.py` — uploads all output files to R2 `isohome` bucket
- `worker.js` additions: `GET /api/isochrone/:crs/:minutes`, `GET /api/static/stations`, `GET /api/static/rail-lines`

**Dependencies**:
- Network Rail GIS GeoPackage: download from https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/ (requires registration)
- Cloudflare R2 bucket `isohome` created in Cloudflare dashboard
- R2 API token with read/write access: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`

**Acceptance**:
- `GET /api/isochrone/KGX/60` returns valid GeoJSON (200)
- `GET /api/isochrone/ZZZ/60` returns `{ error: ..., code: "INVALID_PARAMS" }` (400)
- `GET /api/static/stations` returns GeoJSON with >2,000 station features
- `GET /api/static/rail-lines` returns GeoJSON with line features that visually trace UK rail routes

---

### Phase 2 session prompt

```
Read BRIEF.md and SPEC.md.

Implement Phase 2: Static data preparation and Cloudflare Worker API.

Goal: Convert Network Rail GIS data to GeoJSON, upload everything to R2, and add
three API endpoints to the Cloudflare Worker.

Deliverables:
  scripts/precompute/convert_rail_gis.py  # GeoPackage → stations.geojson + rail-lines.geojson
  scripts/precompute/upload_to_r2.py      # uploads output/ directory to R2 bucket 'isohome'
  worker.js                               # add three new route handlers (see spec section 3)

Start from: Phase 1 complete; scripts/ directory exists; output/isochrones/KGX/60.geojson exists.

Key spec notes:
- R2 binding name: ISOHOME_BUCKET (add to wrangler.toml)
- R2 keys: isochrones/{CRS}/{minutes}.geojson, static/stations.geojson, static/rail-lines.geojson
- Worker must validate CRS against the 10 termini list and minutes against TIME_BUCKETS
- Cache-Control: public, max-age=86400 on all responses
- See spec section 3 for full Worker implementation snippets

Credentials: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (env vars, never hardcoded)
```

---

## Phase 3 — React map UI + dev tooling

**Goal**: The `/isohome` page exists on the site with a working Mapbox map, terminus selector, time slider, and layer toggles. MSW mocking enables frontend development without Cloudflare services. Vitest is configured with ≥80% coverage enforced in CI.

**Deliverables**:
- `src/features/isohome/config.ts` — LONDON_TERMINI + TIME_BUCKETS constants
- `src/features/isohome/IsoHomePage.tsx` — page component
- `src/features/isohome/IsoHomeControls.tsx` — shadcn/ui controls panel
- `src/features/isohome/IsoHomeMap.tsx` — Mapbox GL JS wrapper
- `src/features/isohome/__tests__/` — Vitest tests for all modules (see spec section 9.2)
- `src/mocks/handlers.ts` + `src/mocks/browser.ts` + `src/mocks/server.ts` — MSW setup
- `src/mocks/fixtures/` — KGX-60.geojson, stations.geojson, rail-lines.geojson (dev fixtures)
- `src/test-setup.ts` — MSW node server wired to Vitest lifecycle
- `scripts/seed-local.sh` — seeds local wrangler R2 from fixture files
- `vite.config.ts` updated — Vitest config with v8 coverage, 80% thresholds
- Route added to React Router v6 config

**Dependencies**:
- `mapbox-gl`, `msw`, `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` (add to package.json)
- `VITE_MAPBOX_TOKEN` in `.env.local`
- Phase 2 Worker endpoints available (or run `npm run dev` for MSW-only mode)

**Acceptance**:
- `npm run dev` starts without errors; map renders using MSW fixture data
- `npm run test:coverage` passes with ≥80% lines/branches/functions/statements
- All 10 acceptance criteria from SPEC.md section 5 pass against live Worker data

---

### Phase 3 session prompt

```
Read BRIEF.md and SPEC.md.

Implement Phase 3: React map UI + dev tooling.

Goal: Build the /isohome page with Mapbox GL JS map, shadcn/ui controls, MSW mocking
for offline frontend dev, and Vitest with ≥80% coverage.

Deliverables:
  src/features/isohome/config.ts            # LONDON_TERMINI + TIME_BUCKETS (spec section 1.1)
  src/features/isohome/IsoHomePage.tsx      # page layout
  src/features/isohome/IsoHomeControls.tsx  # shadcn/ui Select + Slider + Switch toggles
  src/features/isohome/IsoHomeMap.tsx       # Mapbox GL JS map + all layers
  src/features/isohome/utils/formatTime.ts  # formatMinutes(n) → human-readable string
  src/features/isohome/__tests__/           # Vitest tests (spec section 9.2)
  src/mocks/handlers.ts                     # MSW handlers for all three /api/* endpoints
  src/mocks/browser.ts                      # setupWorker for Vite dev mode
  src/mocks/server.ts                       # setupServer for Vitest (Node)
  src/mocks/fixtures/KGX-60.geojson         # trimmed real isochrone GeoJSON
  src/mocks/fixtures/stations.geojson       # ~50 station points
  src/mocks/fixtures/rail-lines.geojson     # sample rail lines
  src/test-setup.ts                         # beforeAll/afterEach/afterAll MSW lifecycle
  scripts/seed-local.sh                     # wrangler r2 object put for local dev
  (update) vite.config.ts                   # add vitest config with v8 coverage thresholds
  (update) src/main.tsx                     # conditional MSW bootstrap in dev mode
  (update) src/App.tsx or router config     # add /isohome route
  (update) package.json                     # add dev, dev:worker, test, test:coverage, seed:local scripts

Start from: Phase 2 complete; Worker API endpoints exist; MSW and Vitest not yet installed.

Key spec notes:

MSW (spec section 8.2):
- Activate in dev when import.meta.env.DEV && VITE_USE_MOCKS !== 'false'
- Return KGX-60 fixture for all /api/isochrone/:crs/:minutes combos in dev
- MSW Node server used in Vitest via src/test-setup.ts (server.listen/resetHandlers/close)

Vitest (spec section 9.1–9.2):
- environment: jsdom, globals: true
- coverage provider: v8, include: src/features/isohome/**, thresholds: 80% all axes
- Test config.ts invariants, formatTime utils, IsoHomeControls interactions, IsoHomePage states

Map (spec section 4):
- Map init: center [-2.5, 54.0], zoom 5.5, style mapbox://styles/mapbox/light-v11
- Slider: 6 stops (30/45/60/75/90/120 min), index → TIME_BUCKETS[i]
- Layer colours: isochrone fill #ef4444 opacity 0.25; outline #dc2626; stations/lines #1d4ed8
- TanStack Query keys: ['isochrone', crs, minutes], ['static', 'stations'], ['static', 'rail-lines']
- staleTime: 1 hour for isochrones, Infinity for static layers
- On isochrone source update: setData() if source exists, addSource/addLayer if not
- Loading: controls spinner + map opacity 0.5; Error: shadcn/ui Alert on 404
```

---

## Phase 4 — Full pre-computation + production deployment

**Goal**: Run the full pipeline for all 10 termini × 6 time buckets (60 combinations), upload to R2, and deploy the complete app to production.

**Deliverables**:
- `scripts/precompute/run_all.py` — orchestrates full computation (with rate limiting and resume capability)
- All 60 isochrone GeoJSON files in R2
- Production deployment verified

**Notes**:
- This phase involves 25,000 Transport API queries and ~2,500+ ORS queries — takes several hours
- ORS free tier (500 req/day) may require running over multiple days OR spinning up a local ORS Docker instance
- Consider running `run_all.py` in batches: one terminus per session

**ORS Docker (if needed)**:
```bash
docker run -dt --name ors-app -p 8080:8082 \
  -v /path/to/osm/data:/home/ors/files \
  openrouteservice/openrouteservice:latest
# Download UK OSM extract from https://download.geofabrik.de/europe/great-britain.html
```

---

### Phase 4 session prompt

```
Read BRIEF.md and SPEC.md.

Implement Phase 4: Full pre-computation and production deployment.

Goal: Run the complete pipeline for all 10 London termini × 6 time buckets, upload
all isochrone GeoJSON files to R2, and verify the production deployment works end to end.

Deliverables:
  scripts/precompute/run_all.py   # orchestrated run with progress tracking + resume support
  (verify) All 60 R2 objects exist and are valid GeoJSON
  (verify) Production /isohome page works with all combinations

Start from: Phases 1–3 complete and tested locally.

Key notes:
- Rate limit Transport API: 0.2s delay between requests
- Rate limit ORS public API: max 40 req/min; use local Docker instance for bulk
- run_all.py should checkpoint progress (which combinations are done) so it can resume
  if interrupted
- Verify AC-1 through AC-10 from SPEC.md section 5 against production
```

---

## Phase 5 — Future extensions (not specced yet)

Ideas for future phases — these need their own BRIEF → SPEC → PLAN cycle when the time comes:

- **Tube/Overground connectivity**: Add TfL Journey Planner API for zones 3–6 catchment areas
- **Real-time mode**: "What's the next actual train right now?" using Transport API live departures; isochrone computed live for a single query (not map-wide)
- **Additional layers**: House price heatmap (Land Registry OpenData), school Ofsted ratings (DfE API), annual sunshine (Met Office), broadband speeds (Ofcom)
- **Mobile layout**: Responsive controls panel (drawer instead of overlay)
- **Saved searches**: User accounts + saved combinations (needs auth — see existing site auth pattern)
