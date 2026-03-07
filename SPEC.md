# Spec: IsoHome — UK Commute Isochrone Map

> **Purpose**: Implementation blueprint. Precise enough to build from.
> Feed back to Claude with: _"Read BRIEF.md and SPEC.md. Implement Phase N: [name]"_

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  OFFLINE PRE-COMPUTATION (Python script, runs once / nightly) │
│                                                               │
│  Transport API ──► journey_times.json                         │
│  (all UK stations × 10 London termini, morning peak)          │
│              ↓                                                │
│  ORS Isochrone API ──► per-station drive polygons             │
│              ↓                                                │
│  Union polygons ──► isochrones/{CRS}/{minutes}.geojson        │
│              ↓                                                │
│  Upload to Cloudflare R2                                      │
│                                                               │
│  Network Rail GIS ──► stations.geojson                        │
│                    ──► rail-lines.geojson    → R2             │
└─────────────────────────────────────────────────────────────┘
                          │  R2 objects
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  CLOUDFLARE WORKER (runtime, no computation)                  │
│  GET /api/isochrone/:crs/:minutes  → read R2 → GeoJSON        │
│  GET /api/static/stations          → read R2 → GeoJSON        │
│  GET /api/static/rail-lines        → read R2 → GeoJSON        │
└─────────────────────────────────────────────────────────────┘
                          │  JSON/GeoJSON
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  REACT SPA (Cloudflare Pages / ASSETS binding)               │
│  Route: /isohome                                             │
│  Mapbox GL JS map                                            │
│  shadcn/ui controls (Select + Slider + Toggle)               │
│  TanStack Query fetches from Worker                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Data models

### 1.1 London termini (static config)

Hardcoded in the frontend config. No database needed.

```typescript
// src/features/isohome/config.ts
export const LONDON_TERMINI = [
  { crs: 'KGX', name: "King's Cross" },
  { crs: 'PAD', name: 'Paddington' },
  { crs: 'WAT', name: 'Waterloo' },
  { crs: 'VIC', name: 'Victoria' },
  { crs: 'LST', name: 'Liverpool Street' },
  { crs: 'BFR', name: 'Blackfriars' },
  { crs: 'CST', name: 'Cannon Street' },
  { crs: 'CHX', name: 'Charing Cross' },
  { crs: 'EUS', name: 'Euston' },
  { crs: 'MYB', name: 'Marylebone' },
] as const;

export const TIME_BUCKETS = [30, 45, 60, 75, 90, 120] as const; // minutes
```

### 1.2 Journey time matrix (intermediate, pre-computation only)

Produced by the offline script; not stored in D1 long-term (too large). Stored as a single JSON file in R2 for reference and re-use between computation runs.

```typescript
// Structure of journey_times.json stored in R2
type JourneyTimeMatrix = {
  computed_at: string; // ISO 8601
  query_time: '08:30';
  query_day: 'tuesday';
  entries: Array<{
    remote_crs: string;     // e.g. "BDM"
    remote_name: string;    // e.g. "Bedford"
    remote_lat: number;
    remote_lon: number;
    terminus_crs: string;   // e.g. "KGX"
    journey_minutes: number | null; // null = no direct/1-change service found
    changes: number;        // 0 = direct, 1 = one change, etc.
  }>;
};
```

### 1.3 Isochrone GeoJSON (primary output, stored in R2)

```
R2 key:  isochrones/{terminus_crs}/{minutes}.geojson
Example: isochrones/KGX/60.geojson
```

Each file is a standard GeoJSON `FeatureCollection` with a single `Feature` of type `Polygon` or `MultiPolygon`. Properties on the feature:

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "MultiPolygon", "coordinates": [...] },
    "properties": {
      "terminus_crs": "KGX",
      "terminus_name": "King's Cross",
      "time_budget_minutes": 60,
      "station_count": 87,
      "computed_at": "2026-03-06T00:00:00Z"
    }
  }]
}
```

### 1.4 Stations GeoJSON (stored in R2)

```
R2 key: static/stations.geojson
```

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [-0.1234, 52.1234] },
    "properties": {
      "crs": "BDM",
      "name": "Bedford",
      "operator": "Thameslink"
    }
  }]
}
```

Source: Network Rail GIS or extracted from Transport API station list. CRS codes are the join key between the journey matrix and the geometry.

### 1.5 Rail lines GeoJSON (stored in R2)

```
R2 key: static/rail-lines.geojson
```

Standard GeoJSON `FeatureCollection` of `LineString` features, each representing a rail line segment. Source: Network Rail GIS GeoPackage, converted to GeoJSON using `ogr2ogr` or Python `fiona`.

Properties per feature (minimal):
```json
{
  "properties": {
    "name": "East Midlands Railway",
    "route_type": "mainline"
  }
}
```

---

## 2. Pre-computation pipeline

### 2.1 Overview

The pipeline is a Python script (`scripts/precompute.py`) that runs offline (locally or as a cron job). It produces the GeoJSON files that are uploaded to R2.

```
scripts/
  precompute.py          # main orchestration
  fetch_journey_times.py # Transport API queries
  compute_isochrones.py  # ORS API calls + polygon union
  upload_to_r2.py        # upload outputs to R2 via S3-compatible API
  data/
    stations.json        # cached station list (CRS + coords)
    journey_times.json   # cached journey matrix
```

### 2.2 Step 1: Fetch station list

Source: Transport API station list endpoint or a static CRS code list (e.g. from Network Rail's station master data). Store as `data/stations.json` with CRS code, name, lat, lon.

Filter to UK mainline stations only (exclude London Underground, DLR, Overground, tram stops). Approximately 2,500 stations.

### 2.3 Step 2: Fetch journey times (Transport API)

For each remote station × each London terminus, query the Transport API journey planner:

```python
# Transport API journey planner — verify exact URL with your account docs
# Known pattern (confirm from developer.transportapi.com):
url = (
  f"https://transportapi.com/v3/uk/public/journey"
  f"/from/station_code:{remote_crs}"
  f"/to/station_code:{terminus_crs}.json"
  f"?app_id={APP_ID}&app_key={APP_KEY}"
  f"&date=next_tuesday&time=08:30&type=fastest"
)
# Response: routes[0].duration gives total journey minutes
# Joe: verify `routes[0].duration` field name in your API response
```

Rate limit: batch requests with a small delay (0.2s between calls). With ~2,500 stations × 10 termini = 25,000 queries. At ~5 req/sec this takes ~90 minutes. Cache results aggressively — re-run only when timetables change (seasonally).

Store the result matrix as `data/journey_times.json`.

### 2.4 Step 3: Compute isochrone polygons (OpenRouteService)

For each terminus × time bucket:

```python
for terminus in LONDON_TERMINI:
  for budget in TIME_BUCKETS:
    # Find stations where train time leaves room for a drive
    reachable = [
      s for s in journey_matrix
      if s.terminus_crs == terminus
      and s.journey_minutes is not None
      and s.journey_minutes < budget - 5  # 5 min minimum drive buffer
    ]

    # For each reachable station, drive budget = total_budget - train_time
    # Query ORS isochrone API for drive polygon
    polygons = []
    for station in reachable:
      drive_budget = budget - station.journey_minutes
      poly = ors_isochrone(
        lon=station.lon, lat=station.lat,
        minutes=drive_budget,
        profile='driving-car'
      )
      polygons.append(poly)

    # Union all polygons into one MultiPolygon
    merged = shapely.ops.unary_union(polygons)

    # Save to file
    save_geojson(merged, f"output/isochrones/{terminus}/{budget}.geojson")
```

**ORS Isochrone API** (free public endpoint):
```
POST https://api.openrouteservice.org/v2/isochrones/driving-car
Body: { "locations": [[lon, lat]], "range": [drive_seconds], "range_type": "time" }
Headers: Authorization: Bearer {ORS_API_KEY}  # free at openrouteservice.org
```

Rate limit: ORS free tier allows 500 req/day. With ~2,500 stations, batching is needed — compute one terminus × one time bucket per day, or use a self-hosted ORS instance. **Recommended: self-host ORS via Docker for the initial full computation.**

### 2.5 Step 4: Upload to R2

Use the Cloudflare R2 S3-compatible API:

```python
import boto3
s3 = boto3.client(
    's3',
    endpoint_url=f'https://{ACCOUNT_ID}.r2.cloudflarestorage.com',
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
)
s3.upload_file('output/isochrones/KGX/60.geojson', 'isohome', 'isochrones/KGX/60.geojson',
               ExtraArgs={'ContentType': 'application/geo+json'})
```

---

## 3. Cloudflare Worker API

### Environment bindings required

```toml
# wrangler.toml
[[r2_buckets]]
binding = "ISOHOME_BUCKET"
bucket_name = "isohome"
```

No new secrets required (R2 is accessed via the binding). Transport API key is only used in the offline pre-computation script, not in the Worker.

### 3.1 `GET /api/isochrone/:crs/:minutes`

Returns the pre-computed isochrone GeoJSON for a London terminus and time budget.

**Request**:
```
GET /api/isochrone/KGX/60
```

**Response `200`**:
```json
{
  "type": "FeatureCollection",
  "features": [{ "type": "Feature", "geometry": {...}, "properties": {...} }]
}
```

**Response `400`** — invalid CRS or unsupported time bucket:
```json
{ "error": "Invalid terminus or time bucket", "code": "INVALID_PARAMS" }
```

**Response `404`** — isochrone not yet computed:
```json
{ "error": "Isochrone not available for this combination", "code": "NOT_FOUND" }
```

**Worker implementation**:
```javascript
if (url.pathname.startsWith('/api/isochrone/')) {
  const [, , , crs, minutes] = url.pathname.split('/');
  const validCRS = ['KGX','PAD','WAT','VIC','LST','BFR','CST','CHX','EUS','MYB'];
  const validBuckets = ['30','45','60','75','90','120'];
  if (!validCRS.includes(crs) || !validBuckets.includes(minutes)) {
    return Response.json({ error: 'Invalid terminus or time bucket', code: 'INVALID_PARAMS' }, { status: 400 });
  }
  const obj = await env.ISOHOME_BUCKET.get(`isochrones/${crs}/${minutes}.geojson`);
  if (!obj) return Response.json({ error: 'Isochrone not available', code: 'NOT_FOUND' }, { status: 404 });
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/geo+json', 'Cache-Control': 'public, max-age=86400' }
  });
}
```

### 3.2 `GET /api/static/stations`

Returns GeoJSON of all UK mainline station points.

**Response `200`**: GeoJSON FeatureCollection (application/geo+json)

### 3.3 `GET /api/static/rail-lines`

Returns GeoJSON of UK rail network lines.

**Response `200`**: GeoJSON FeatureCollection (application/geo+json)

---

## 4. Frontend

### 4.1 Route

Add to React Router v6 config:
```typescript
{ path: '/isohome', element: <IsoHomePage /> }
```

### 4.2 Component tree

```
IsoHomePage
  ├── IsoHomeControls          (shadcn/ui panel, top-left overlay on map)
  │     ├── Select             (terminus dropdown, from LONDON_TERMINI)
  │     ├── Slider             (time budget, snaps to TIME_BUCKETS)
  │     └── LayerToggles
  │           ├── Switch       ("Show stations")
  │           └── Switch       ("Show rail lines")
  └── IsoHomeMap               (Mapbox GL JS wrapper)
        ├── isochrone-fill     (fill layer from fetched GeoJSON)
        ├── isochrone-outline  (line layer, same source)
        ├── stations-layer     (circle layer, toggled)
        └── rail-lines-layer   (line layer, toggled)
```

### 4.3 Map initialisation

```typescript
// src/features/isohome/IsoHomeMap.tsx
const map = new mapboxgl.Map({
  container: mapContainerRef.current,
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-2.5, 54.0],   // centre of UK
  zoom: 5.5,
  accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
});
```

Environment variable: `VITE_MAPBOX_TOKEN` (already available, same as used elsewhere on the site).

### 4.4 Data fetching (TanStack Query)

```typescript
// Query key structure
['isochrone', terminus_crs, time_minutes]
['static', 'stations']
['static', 'rail-lines']

// Isochrone query
const { data: isochroneGeoJSON, isLoading } = useQuery({
  queryKey: ['isochrone', selectedTerminus, selectedMinutes],
  queryFn: () =>
    fetch(`/api/isochrone/${selectedTerminus}/${selectedMinutes}`)
      .then(r => r.json()),
  staleTime: 1000 * 60 * 60, // 1 hour — data changes rarely
});

// Stations and rail lines: fetched once, staleTime: Infinity
```

### 4.5 Map layer management

When `isochroneGeoJSON` changes:
1. If source `isochrone-source` doesn't exist: `map.addSource(...)`, then `map.addLayer(...)` for fill and outline.
2. If source already exists: `map.getSource('isochrone-source').setData(isochroneGeoJSON)`.

Layer styles:
```javascript
// Fill layer
{ type: 'fill', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } }

// Outline layer
{ type: 'line', paint: { 'line-color': '#dc2626', 'line-width': 1.5 } }

// Stations (circles)
{ type: 'circle', paint: { 'circle-radius': 4, 'circle-color': '#1d4ed8', 'circle-opacity': 0.8 } }

// Rail lines
{ type: 'line', paint: { 'line-color': '#1d4ed8', 'line-width': 1, 'line-opacity': 0.6 } }
```

### 4.6 Slider behaviour

The slider has 6 stops: 30, 45, 60, 75, 90, 120 minutes. Implemented as a shadcn/ui `<Slider>` with `min=0 max=5 step=1`, mapping index → `TIME_BUCKETS[index]`. Display label shows the human-readable value (e.g. "1 hour", "1 hr 30 min").

When slider value changes → update TanStack Query key → fetch new isochrone → update map source data.

### 4.7 Loading states

While isochrone is loading, show a subtle spinner inside the controls panel and set map opacity to 0.5. Do not show a full-screen loader — the map remains interactive.

### 4.8 Error states

If the Worker returns 404 (isochrone not yet computed for this combo), show a shadcn/ui `<Alert>` inside the controls panel: "Data not yet available for this combination. Try again later."

---

## 5. Acceptance criteria

| # | Criterion |
|---|-----------|
| AC-1 | Selecting "King's Cross" + 60 min renders a shaded isochrone covering recognisable commuter belt areas (Bedford, Cambridge, Stevenage, Peterborough). |
| AC-2 | Clophill, Bedfordshire (~52.03°N, -0.44°W) falls inside the 60-minute King's Cross isochrone. |
| AC-3 | Toggling "Show stations" adds/removes station dots without reloading the page. |
| AC-4 | Toggling "Show rail lines" adds/removes rail line overlay without reloading the page. |
| AC-5 | Changing the terminus or time slider triggers a new isochrone fetch; the old isochrone is replaced. |
| AC-6 | Worker returns a valid GeoJSON response for all 10 termini × 6 time buckets (60 combinations). |
| AC-7 | Map loads and controls are interactive within 3 seconds on standard broadband. |
| AC-8 | Isochrone fetch is served from Worker cache on repeat requests (Cache-Control header set). |
| AC-9 | Pre-computation script produces valid GeoJSON for at least one terminus × time bucket without error. |
| AC-10 | Rail lines on the map visually follow real geographic routes (not straight lines between stations). |

---

## 6. Environment variables and secrets

| Name | Where used | Notes |
|------|-----------|-------|
| `VITE_MAPBOX_TOKEN` | Frontend build | Existing on the site |
| `TRANSPORT_API_APP_ID` | Pre-computation script only | Never in Worker or frontend |
| `TRANSPORT_API_APP_KEY` | Pre-computation script only | Never in Worker or frontend |
| `ORS_API_KEY` | Pre-computation script only | Free from openrouteservice.org |
| `CF_ACCOUNT_ID` | Pre-computation script (R2 upload) | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Pre-computation script (R2 upload) | R2 API token |
| `R2_SECRET_ACCESS_KEY` | Pre-computation script (R2 upload) | R2 API token |
| `ISOHOME_BUCKET` | Worker env binding | R2 bucket name: `isohome` |

---

## 7. Out of scope (MVP)

- Real-time "live next train" queries — Phase 2
- Additional overlay layers (house prices, schools, sunshine) — Phase 2+
- Mobile layout optimisation — Phase 2
- User accounts or saved preferences — Phase 2
- Walking to station (drive only for MVP)
- Journeys not involving a London terminus
- Tube/DLR/Overground legs
