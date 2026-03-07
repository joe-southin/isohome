# Research: IsoHome — Open Questions

> **Purpose**: Resolves the open questions from BRIEF.md before the spec can be written.
> When complete, decisions feed directly into SPEC.md.

---

## Q1: Which UK rail timetable API are we using?

### Findings

| API | Type | Cost | Journey time query | Notes |
|-----|------|------|--------------------|-------|
| **OpenLDBWS (Darwin)** | SOAP/XML (or REST via Huxley2 wrapper) | Free (up to 5M req/4 weeks) | GetFastestDepartures or GetNextDepartures filtered by destination | Official NRE feed; real-time + scheduled |
| **Realtime Trains (RTT)** | REST JSON | Free non-commercial (registrations currently limited) | `GET /api/v1/search/{from}/{to}` | Clean API; good calling points data |
| **Transport API** | REST JSON | Commercial (contact for pricing) | `GET /v3/routes.json?from=CRS&to=CRS` | Includes route geometry; most complete |
| **Network Rail STOMP** | Stream (ActiveMQ) | Commercial | N/A (movement events, not journey planner) | Not suitable for this use case |
| **GTFS static** | Static files | Free | N/A (schedule data, no live querying) | Useful for pre-computation only |

### ✅ Decision: Transport API (transportapi.com)

**Confirmed by Joe** — the existing API key is for Transport API (transportapi.com). This is the richest option available:

- REST JSON API, well-documented
- Supports journey planner queries by CRS code
- Includes route geometry for map rendering (useful for Phase 2+)
- Authentication via `app_id` + `app_key` query parameters (or `X-App-Id` / `X-App-Key` headers)
- Known endpoint pattern: `GET https://transportapi.com/v3/uk/public/journey/from/station_code:{crs}/to/station_code:{crs}.json`
- Journey duration returned in `routes[0].duration` (verify field name against actual API response)
- Credentials stored as `TRANSPORT_API_APP_ID` and `TRANSPORT_API_APP_KEY` env vars — never in Worker or frontend (pre-computation script only)

---

## Q2: How to compute drive-to-station times using real road data?

### Findings

| API | Pricing | Max destinations/request | Notes |
|-----|---------|--------------------------|-------|
| **Mapbox Matrix API** | ~$2/1,000 elements (included in Mapbox account) | 25×25 = 625 elements | Joe already has Mapbox token — consistent billing |
| **OpenRouteService** | Free (public API) / self-hostable | Generous limits | OSM data; also has **Isochrone endpoint** (polygon of reachable area in X min) |
| **Google Maps Distance Matrix** | $5/1,000 elements | 25×25 = 625 elements | Deprecated March 2025, migrated to Routes API |
| **TomTom Routing** | €6/1,000 requests | 200 cells/sync req | Less relevant given alternatives |
| **HERE Routing** | $5/1,000 matrix req | 10,000 origins/destinations | Powerful but overkill for MVP |

### ✅ Decision: Use OpenRouteService Isochrone API (free)

**Reasoning**: The core need is not a distance matrix — it's an **isochrone polygon** (all points reachable within X minutes drive of a given station). OpenRouteService has a dedicated isochrone endpoint that returns exactly this: a GeoJSON polygon for "all areas within N minutes drive of this point". This is:

- Free and open-source (uses OpenStreetMap road data)
- More direct than computing a matrix and reconstructing a polygon
- Self-hostable if rate limits become a concern
- Accuracy is acceptable for the use case (OSM road data in UK is very good quality)

**The computation pipeline**:
1. For each UK station, and for each available drive-time budget (5, 10, 15, 20, 25, 30 min):
   - Query ORS Isochrone API → get a polygon of "driveable area within N minutes"
2. These isochrone polygons are **pre-computed** and stored. Not computed live.

Mapbox Matrix API remains an option if we need real-time drive times to specific points, but for the map layer (colouring areas) the polygon approach is better.

---

## Q3: Where to get train line geometry for the map overlay?

### Findings

| Source | Format | Cost | Accuracy | Notes |
|--------|--------|------|----------|-------|
| **Network Rail GIS (Rail Data Marketplace)** | GeoPackage | Free (OGL) | ⭐⭐⭐⭐⭐ Official | Complete track network; requires format conversion |
| **OpenStreetMap via Overpass API** | GeoJSON | Free | ⭐⭐⭐⭐ | Dynamic queries; good UK railway coverage |
| **Humanitarian Data Exchange (HDX)** | GeoJSON | Free | ⭐⭐⭐ | Pre-built OSM export; one-time download |
| **OS National Geographic Database** | OS API | Free for some; trial for others | ⭐⭐⭐⭐⭐ | Topologically structured; more complex access |
| **GTFS shapes.txt** | CSV (requires conversion) | Free (after ATOC-CIF conversion) | ⭐⭐⭐ | Adds conversion complexity |

### ✅ Decision: Network Rail GIS data, pre-processed to GeoJSON, served from R2

**Reasoning**: Download the Network Rail GIS GeoPackage (free, OGL licence), convert to GeoJSON, store in Cloudflare R2, and serve as a static asset. Mapbox GL JS loads it once and adds it as a source for the toggled layer.

- Official, most accurate representation of the actual track network
- Served as a static file → fast, no per-request API calls, no rate limit concerns
- Conversion is a one-time offline step (use `ogr2ogr` or Python `fiona`/`geopandas`)
- Needs to be refreshed occasionally (Network Rail updates infrequently)

Station locations (as GeoJSON point features) can come from the same source or from the rail timetable API's CRS code database.

---

## Q4: Should isochrones be pre-computed or live?

### The computation required

A single isochrone for "60 minutes from King's Cross" requires:
1. Find all UK stations where fastest train to King's Cross ≤ 55 min (leaving 5 min buffer)
2. For each such station with train time T, the remaining drive budget = 60 - T minutes
3. Query ORS for the drive-time polygon around that station for the remaining budget
4. Union all polygons → final isochrone shape

With ~2,500 UK stations, 10 London termini, and ~8 time buckets = **200,000 ORS queries** for full pre-computation. This is non-trivial but a one-time (or nightly) offline job, not a live request.

### ✅ Decision: Pre-compute all isochrones, cache as GeoJSON in R2

**Reasoning**:
- A live request would require 100+ API calls and take 10–30 seconds — unacceptable UX
- Pre-computation (offline script) can run once and produce ~80 GeoJSON files (10 termini × 8 time buckets)
- Files stored in R2; Cloudflare Worker serves them by key (e.g. `GET /api/isochrone/KGX/60`)
- Pre-computation script runs locally (Python) or as a scheduled Cloudflare Worker Cron
- Total storage: GeoJSON polygons are typically 100KB–2MB each → well within R2 free tier

**Time bucket options**: 30, 45, 60, 75, 90, 120 minutes (slider snaps to these)

---

## Q5: "Just in time" — what does this mean exactly?

### Clarification needed

Two interpretations:

**A. Time-of-day aware (real-time)**: When a user queries the map, look up the *actual next train* right now, using live departure data. The isochrone would change depending on when you look (9am Monday vs 2am Sunday).

**B. Timetable best-case (static)**: Use scheduled timetable data to find the *fastest available journey* between each remote station and each London terminus (e.g. peak-hour morning commute). This becomes a fixed number per station pair.

**For a pre-computed isochrone map, interpretation B is the only practical option.** You cannot pre-compute time-of-day-specific isochrones for every hour of the week. However, we could offer the user a "time of day" slider to pick morning peak vs. off-peak, and pre-compute separate isochrones for each.

### ✅ Decision: Timetable best-case (morning peak) for MVP

**Confirmed by Joe** — the isochrone should reflect the fastest scheduled journey on a typical weekday morning peak, not live real-time departures. The map will be labelled accordingly (e.g. "Based on typical weekday morning peak journeys"). Real-time "next actual train" querying is explicitly deferred to Phase 2.

---

## Summary of decisions

All questions resolved. ✅

| Question | Decision |
|----------|----------|
| Rail timetable data | **Transport API** (transportapi.com) — Joe's existing key |
| Drive-to-station times | **OpenRouteService Isochrone API** (free, polygon-based) |
| Train line geometry | **Network Rail GIS GeoPackage** → GeoJSON → served from R2 |
| Isochrone computation | **Pre-computed offline script** → store in R2 |
| "Just in time" semantics | **Timetable best-case (morning peak)** for MVP; real-time is Phase 2 |
