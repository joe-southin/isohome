# Spec: IsoHome Phase 6 — Index of Deprivation Layer + Compact Layer Panel

> **Purpose**: Implementation blueprint. Precise enough to build from without asking questions.
> Feed back to Claude with: _"Read docs/phase6/BRIEF.md and docs/phase6/SPEC.md. Implement Phase 6A."_

---

## Architecture overview

Phase 6 touches four areas of the codebase, all following established patterns:

```
A. Python data script   scripts/data/generate_deprivation.py
   → downloads IoD25 CSV + GeoPackage, extracts LSOA centroids + IMD Score
   → outputs src/mocks/fixtures/deprivation.json  (dev mock)
   → outputs output/static/deprivation.geojson    (for R2 upload)

B. Worker              worker/index.ts
   → add GET /api/static/deprivation route (identical pattern to /crime, /sunshine)

C. Frontend data       src/features/isohome/IsoHomePage.tsx
   → add deprivation useQuery + extend layerWeights + extend dataByLayer

D. Frontend UI         src/features/isohome/IsoHomeControls.tsx
   → redesign layer row layout (inline toggle + compact spacing)
   → no logic changes, purely presentational
```

Type extension: `src/features/isohome/types.ts`
Mock handler: `src/mocks/handlers.ts` (add /api/static/deprivation)

---

## 1. Data source and processing (Python)

### 1.1 Source

**English Indices of Deprivation 2025** — published 30 October 2025 by MHCLG.

| Asset | URL | Purpose |
|-------|-----|---------|
| CSV File 7 | `https://assets.publishing.service.gov.uk/...` (see note below) | IMD Score per LSOA (continuous, 0–80+) |
| GeoPackage | Official spatial download from deprivation.communities.gov.uk | 2021 LSOA boundaries → centroids |

> **Note on URLs**: The exact asset URLs from gov.uk may redirect or change. The script
> should fetch the main page or use the official download portal
> `https://deprivation.communities.gov.uk/download-all` to find current links. If
> download is unreliable, fall back to a locally cached copy. The script must print a
> clear error if download fails rather than silently producing bad output.

**Alternative (simpler) approach if GeoPackage download is cumbersome**: Use ONS LSOA
centroids CSV (2021, published separately) and join on LSOA code — avoids needing
`geopandas` and GDAL for the GeoPackage. This is the **recommended approach** for
implementation simplicity.

### 1.2 Recommended data processing approach

Use **ONS LSOA 2021 Population-Weighted Centroids** (CSV, ~33k rows, no GIS library
needed) joined with IoD25 File 1 or File 7 scores.

```
Source A: ONS LSOA centroids (CSV)
  URL: https://geoportal.statistics.gov.uk/datasets/...lsoa-2021-population-weighted-centroids
  Columns: LSOA21CD, LSOA21NM, x (easting), y (northing)  [British National Grid EPSG:27700]
  OR: lat/long variant available — prefer that to avoid coordinate conversion

Source B: IoD25 File 1 (CSV, ~33k rows)
  Columns: LSOA code (2021), LSOA name, IMD Score, IMD Rank, IMD Decile, ...
  Key column: "Index of Multiple Deprivation (IMD) Score"
```

Join on `LSOA code`. Output: one point per LSOA with `properties.value = IMD Score`.

### 1.3 Script: `scripts/data/generate_deprivation.py`

```python
# Skeleton — implement to match this contract

def download_file(url: str, dest: Path) -> Path:
    """Download url to dest if not already cached. Returns dest."""

def load_lsoa_centroids(path: Path) -> pd.DataFrame:
    """Load ONS centroids CSV. Returns df with columns: lsoa_code, lat, lon."""

def load_imd_scores(path: Path) -> pd.DataFrame:
    """Load IoD25 CSV. Returns df with columns: lsoa_code, imd_score (float)."""

def build_geojson(merged: pd.DataFrame) -> dict:
    """
    Build GeoJSON FeatureCollection from merged df.
    Each feature: Point geometry at [lon, lat], properties = {"value": imd_score}.
    Coordinates rounded to 4 decimal places. Values rounded to 2 decimal places.
    """

def compute_stats(scores: pd.Series) -> dict:
    """Return {"mean": float, "stddev": float} rounded to 1 decimal place."""

def main():
    # 1. Download / cache source files
    # 2. Load centroids + scores
    # 3. Merge on lsoa_code (inner join — drop any LSOAs missing from either source)
    # 4. Print stats (mean, stddev) — copy into types.ts layer config
    # 5. Write compact GeoJSON to:
    #    - src/mocks/fixtures/deprivation.json
    #    - output/static/deprivation.geojson (create dirs if missing)
    # 6. Print file sizes
```

**Dependencies** (add to `scripts/precompute/requirements.txt`):
- `pandas` (likely already present)
- `requests` (already present)
- No geopandas or GDAL required

**Acceptance**:
- Output GeoJSON has 30,000–33,755 features (inner join may drop a handful with missing data).
- File size < 3 MB compact JSON.
- Script prints computed mean and stddev so they can be copy-pasted into `types.ts`.
- `pytest scripts/tests/test_generate_deprivation.py -v` passes (see §6 for test spec).

### 1.4 Population statistics

Compute from actual data and hard-code. Expected approximate values based on IoD 2019
(IoD 2025 distribution is similar):

| Stat | Approximate value |
|------|-------------------|
| Mean IMD Score | ~22.0 |
| Std Dev | ~13.0 |

The script must print the exact computed values so they can be verified and inserted
into the layer config.

---

## 2. Type extension

**File**: `src/features/isohome/types.ts`

Extend `LayerId` to include `'deprivation'`:

```typescript
// BEFORE
export type LayerId = 'sunshine' | 'house_price' | 'crime';

// AFTER
export type LayerId = 'sunshine' | 'house_price' | 'crime' | 'deprivation';
```

No other changes to `types.ts`. The `LayerWeight`, `CostPoint`, and other types are
already generic.

---

## 3. Worker endpoint

**File**: `worker/index.ts`

Add one route, identical in structure to the existing `/crime` handler:

```typescript
// Add to VALID_STATIC_KEYS or add as an explicit if-branch:
if (url.pathname === '/api/static/deprivation') {
  return handleStatic('deprivation', env);
}
```

No other Worker changes required.

---

## 4. Frontend data wiring

**File**: `src/features/isohome/IsoHomePage.tsx`

### 4.1 Add TanStack Query for deprivation data

Add alongside the existing `sunshineData`, `housePriceData`, `crimeData` queries:

```typescript
const { data: deprivationData } = useQuery({
  queryKey: ['static', 'deprivation'],
  queryFn: () => fetch('/api/static/deprivation').then((r) => r.json()),
  staleTime: Infinity,
});
```

### 4.2 Extend layerWeights initial state

Add the deprivation entry to the `useState` initialiser:

```typescript
{
  id: 'deprivation',
  label: 'Deprivation',
  weight: 5,
  enabled: true,
  higherIsBetter: false,   // higher IMD score = more deprived = worse
  stats: { mean: 22.0, stddev: 13.0 }  // replace with computed values from script
}
```

### 4.3 Extend dataByLayer

Update the `computeCostField` call to include `deprivation`:

```typescript
// BEFORE
return computeCostField(points, activeWeights, {
  sunshine: sunshineData,
  house_price: housePriceData,
  crime: crimeData,
});

// AFTER
return computeCostField(points, activeWeights, {
  sunshine: sunshineData,
  house_price: housePriceData,
  crime: crimeData,
  deprivation: deprivationData,
});
```

### 4.4 Guard condition update

Update the data-readiness guard in the `costScores` useMemo:

```typescript
// BEFORE
if (!mergedIsochrone || !sunshineData || !housePriceData || !crimeData) return [];

// AFTER
if (!mergedIsochrone || !sunshineData || !housePriceData || !crimeData || !deprivationData) return [];
```

---

## 5. UI redesign — compact layer rows

**File**: `src/features/isohome/IsoHomeControls.tsx`

### 5.1 Current layout (per layer, 2 rows + gap)

```
┌──────────────────────────────────────────┐
│ [✓] Sunshine                          5  │  ← row 1: checkbox + label + weight value
│ [════════════●══════════════════════]    │  ← row 2: slider
│                                          │  ← gap (space-y-3)
│ [✓] House price                       5  │
│ [════════════●══════════════════════]    │
└──────────────────────────────────────────┘
```

### 5.2 New layout (per layer, 1 row)

```
┌──────────────────────────────────────────┐
│ [✓] Sunshine  [═══●══════════════════] 5 │  ← single row
│ [✓] House price [═══●════════════════] 5 │  ← tighter gap (space-y-1.5)
│ [✓] Crime     [═══●════════════════] 5   │
│ [✓] Deprivation [═●═════════════════] 5  │
└──────────────────────────────────────────┘
```

### 5.3 Implementation

Replace the current layer loop (in the `layerPanelOpen && (...)` block) with:

```tsx
{/* BEFORE — remove this block */}
{layerWeights.map((layer) => (
  <div key={layer.id} className="space-y-1">
    <div className="flex items-center justify-between text-xs">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={layer.enabled} onChange={...} />
        {layer.label}
      </label>
      <span className="text-gray-500 tabular-nums">{layer.weight}</span>
    </div>
    <input type="range" ... className="w-full" />
  </div>
))}

{/* AFTER — replace with this */}
{layerWeights.map((layer) => (
  <div key={layer.id} className="flex items-center gap-1.5 text-xs">
    <input
      type="checkbox"
      checked={layer.enabled}
      onChange={(e) => updateLayer(layer.id, { enabled: e.target.checked })}
      aria-label={`Enable ${layer.label}`}
      className="shrink-0"
    />
    <label className="w-16 shrink-0 truncate">{layer.label}</label>
    <input
      type="range"
      min={0}
      max={10}
      step={1}
      value={layer.weight}
      disabled={!layer.enabled}
      onChange={(e) => updateLayer(layer.id, { weight: Number(e.target.value) })}
      className="flex-1 min-w-0"
      aria-label={`${layer.label} weight`}
    />
    <span className="w-4 text-right text-gray-500 tabular-nums shrink-0">
      {layer.weight}
    </span>
  </div>
))}
```

Change the wrapper `div` spacing from `space-y-3` to `space-y-1.5`:

```tsx
{/* BEFORE */}
<div className="space-y-3 mt-2">

{/* AFTER */}
<div className="space-y-1.5 mt-2">
```

### 5.4 Accessibility notes

- The `<label>` element is no longer a wrapping label (since the input is a sibling).
  Use `aria-label` on the checkbox to maintain screen reader accessibility, as shown above.
- `disabled` state on the slider visually greys it out; this behaviour is unchanged.

---

## 6. Mock and test updates

### 6.1 Mock fixture

**File**: `src/mocks/fixtures/deprivation.json`

Generated by `generate_deprivation.py` (see §1.3). For MSW development mocks, this
file is served by the existing mock handler pattern.

**If real data download is not yet complete**: generate a synthetic version following
the same approach as `generate_crime.py`. Synthetic data should model deprivation as
higher in urban centres (London inner areas, coastal towns, northern cities) and lower
in rural/suburban areas — the inverse of the sunshine gradient.

### 6.2 MSW handler

**File**: `src/mocks/handlers.ts`

Add alongside the existing handlers:

```typescript
http.get('/api/static/deprivation', () => {
  return HttpResponse.json(deprivationFixture);
}),
```

Import the fixture at the top of the file matching the existing pattern.

### 6.3 Python test spec

**File**: `scripts/tests/test_generate_deprivation.py`

Required tests (≥80% line/branch coverage for `generate_deprivation.py`):

```python
def test_load_lsoa_centroids_returns_required_columns():
    # Given a CSV with LSOA21CD, lat, lon columns
    # When load_lsoa_centroids is called
    # Then the result has columns: lsoa_code, lat, lon with correct dtypes

def test_load_imd_scores_returns_required_columns():
    # Given the IoD25 CSV
    # When load_imd_scores is called
    # Then the result has columns: lsoa_code, imd_score (float)

def test_build_geojson_structure():
    # Given a small merged DataFrame (3 rows)
    # When build_geojson is called
    # Then the result is {"type": "FeatureCollection", "features": [...]}
    # And each feature has geometry.type == "Point"
    # And each feature has properties.value (float)

def test_build_geojson_coordinate_precision():
    # Coordinates are rounded to 4 decimal places
    # Values are rounded to 2 decimal places

def test_compute_stats():
    # Given a series [10.0, 20.0, 30.0]
    # Returns {"mean": 20.0, "stddev": 10.0} (approximately)

def test_inner_join_drops_unmatched_lsoas():
    # Given centroids with 5 LSOAs and scores with 4 (one missing)
    # When merged (inner join)
    # Then output has 4 features (the unmatched LSOA is dropped)

def test_output_file_written(tmp_path):
    # End-to-end: given small test fixtures
    # When main() is called with --output-dir tmp_path
    # Then output file exists and is valid JSON with >0 features
```

### 6.4 Frontend test updates

**File**: `src/features/isohome/__tests__/IsoHomePage.test.tsx` (or equivalent)

- Add `deprivationFixture` to mock setup alongside existing fixtures.
- Verify the deprivation layer appears in the layer panel (check for "Deprivation" text).
- No changes needed to `costField` tests (the scoring logic is unchanged).

---

## 7. Acceptance criteria

| # | Criterion | Verified by |
|---|-----------|-------------|
| 1 | Deprivation layer visible in panel, checkbox and slider functional | Manual + UI test |
| 2 | Heatmap updates when deprivation weight changes | Manual |
| 3 | Known deprived areas score lower than affluent neighbours | Visual check: compare Medway vs Surrey |
| 4 | Each layer row is a single line with inline toggle | Visual |
| 5 | Panel height with 4 layers ≤ panel height with 3 layers under old design | Visual |
| 6 | All existing tests pass (no regressions) | `npm test && pytest` |
| 7 | New pytest coverage ≥ 80% for `generate_deprivation.py` | `pytest --cov` |
| 8 | GeoJSON file size < 3 MB | `ls -lh output/static/deprivation.geojson` |
| 9 | TypeScript compiles cleanly (`npm run build`) | CI |
| 10 | Worker test for new `/api/static/deprivation` route | `npm run test:worker` |

---

## 8. Files changed summary

| File | Change |
|------|--------|
| `scripts/data/generate_deprivation.py` | **New** — IoD25 data pipeline |
| `scripts/tests/test_generate_deprivation.py` | **New** — pytest suite |
| `scripts/precompute/requirements.txt` | Add `pandas` if not present |
| `src/features/isohome/types.ts` | Extend `LayerId` union |
| `worker/index.ts` | Add `/api/static/deprivation` route |
| `src/features/isohome/IsoHomePage.tsx` | Add query, extend layerWeights, extend dataByLayer |
| `src/features/isohome/IsoHomeControls.tsx` | Redesign layer row layout |
| `src/mocks/handlers.ts` | Add deprivation mock handler |
| `src/mocks/fixtures/deprivation.json` | **New** — generated fixture |
