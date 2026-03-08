# Spec: IsoHome Phase 5 — Weighted Desirability Layers

> Feed a section to Claude: _"Read SPEC.md §Architecture. Implement it."_
> Or the whole thing: _"Read BRIEF.md and SPEC.md. Implement Phase 5B."_

---

## Overview

Two static UK data grids (sunshine hours, median house price) are fetched once and
cached. When the isochrone is present and at least one layer has a non-zero weight, the
app samples the isochrone region on a 5 km grid, clips the samples to the isochrone
polygon, looks up each layer's value at each point, normalises and combines them into a
0–1 score, then renders the scores as a Mapbox GL heatmap layer using the Viridis
colormap. A collapsible "Desirability Layers" panel in `IsoHomeControls` exposes weight
sliders (0–10) for each layer.

---

## Data preparation (one-time, before Phase 5B)

Two static JSON files must be committed under `public/` (or served via the existing
mock handler system) before the frontend work begins.

### `sunshine.json` — annual sunshine hours grid

**Source**: Met Office UK Climate Projections (UKCP18) 1 km gridded data, or the
freely downloadable Met Office "UK climate averages" dataset
(https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-averages).
Annual sunshine hours are available at ~5 km resolution.

**Pre-processing** (Python script `scripts/prepare_sunshine.py`):
1. Download Met Office gridded sunshine CSV/NetCDF.
2. Resample to a 0.05° × 0.05° WGS84 grid (≈ 5 km at UK latitudes).
3. Filter to UK bounding box: lon −8.0 → 2.0, lat 49.5 → 61.0.
4. Output as GeoJSON FeatureCollection of Point features.

**Schema**:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-1.5, 51.5] },
      "properties": { "value": 1650.4 }
    }
  ]
}
```
Typical range: 900–1900 hours/year. Target size: < 1.5 MB.

### `house-prices.json` — median house price grid

**Source**: UK Land Registry "Price Paid Data" (open data, free download).
Aggregate median transaction price per postcode district (e.g. GL7, SW1A) using
the most recent 3 years of data.

**Pre-processing** (Python script `scripts/prepare_house_prices.py`):
1. Download Land Registry PP-complete CSV.
2. Group by postcode district; compute median price.
3. Geocode each district to its centroid using ONS Postcode Directory.
4. Output as GeoJSON FeatureCollection of Point features.

**Schema**: same shape as sunshine — `properties.value` = median price in GBP.
Typical range: £80,000–£2,000,000. Target size: < 0.5 MB (≈ 2800 districts).

### API endpoint

Add both files to `src/mocks/handlers.ts` (MSW) for local dev and serve from
`/api/static/sunshine` and `/api/static/house-prices`. In production these can be
served as static assets.

---

## Architecture

```
IsoHomePage
  ├── useQuery(['static','sunshine'])  → /api/static/sunshine  (GeoJSON, staleTime: Infinity)
  ├── useQuery(['static','house-prices']) → /api/static/house-prices (GeoJSON, staleTime: Infinity)
  ├── layerWeights: LayerWeight[]  (state: [{id:'sunshine', weight:5, enabled:true}, ...])
  ├── computedScores: CostPoint[]  (useMemo: recomputes when isochrone | layerWeights | data changes)
  │
  ├── IsoHomeControls  (new props: layerWeights, onLayerWeightsChange)
  │     └── <DesirabilityPanel> (collapsible, inside IsoHomeControls JSX)
  │
  └── IsoHomeMap  (new prop: costScores: CostPoint[])
        └── 'cost-heatmap' Mapbox GL layer  (heatmap type, Viridis colormap)
```

---

## Data models

```ts
// src/features/isohome/types.ts  (new file)

export type LayerId = 'sunshine' | 'house_price';

export interface LayerWeight {
  id: LayerId;
  label: string;
  weight: number;       // integer 0–10
  enabled: boolean;
  higherIsBetter: boolean; // sunshine=true, house_price=false
}

export interface CostPoint {
  lng: number;
  lat: number;
  score: number; // normalised 0–1
}

export type Colormap = 'viridis' | 'jet';
```

Default `layerWeights` state (in `IsoHomePage`):
```ts
const DEFAULT_LAYER_WEIGHTS: LayerWeight[] = [
  { id: 'sunshine',    label: 'Sunshine',    weight: 5, enabled: true, higherIsBetter: true  },
  { id: 'house_price', label: 'House price', weight: 5, enabled: true, higherIsBetter: false },
];
```

---

## Computation engine

New file: `src/features/isohome/utils/costField.ts`

### `generateSampleGrid`

```ts
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bbox from '@turf/bbox';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

/**
 * Returns [lng, lat] pairs on a 0.05° grid clipped to the isochrone polygon.
 * 0.05° ≈ 5 km at UK latitudes.
 */
export function generateSampleGrid(
  isochrone: FeatureCollection<Polygon | MultiPolygon>,
  spacingDeg = 0.05,
): [number, number][]
```

Algorithm:
1. Compute bounding box of isochrone with `bbox(isochrone)`.
2. Walk lon/lat at `spacingDeg` intervals over the bbox.
3. Keep only points where `booleanPointInPolygon(point, isochrone)` is true.
4. Return array of `[lng, lat]`.

### `lookupNearest`

```ts
/**
 * Returns the value of the nearest point feature in `grid` to [lng, lat].
 * Uses squared Euclidean distance (fast, good enough at 5 km resolution).
 * Returns null if grid is empty or nearest point > 0.15° away.
 */
export function lookupNearest(
  lng: number,
  lat: number,
  grid: FeatureCollection,
): number | null
```

### `computeCostField`

```ts
/**
 * Given sample points inside the isochrone, layer data, and weights,
 * returns a CostPoint[] with normalised scores (0–1).
 * Points where any enabled layer has no data are excluded.
 */
export function computeCostField(
  points: [number, number][],
  layers: LayerWeight[],
  dataByLayer: Record<LayerId, FeatureCollection>,
): CostPoint[]
```

Algorithm:
```
For each enabled layer with weight > 0:
  1. Look up raw value at each point using lookupNearest.
  2. Compute min/max across all valid points for this layer.
  3. Normalise: norm = (val - min) / (max - min).
  4. If higherIsBetter=false, invert: norm = 1 - norm.

For each point:
  totalWeight = sum of weights for active layers
  score = sum(norm_i * weight_i) / totalWeight   // weighted average

Return CostPoint[] sorted by score descending.
```

Edge cases:
- If all weights are 0 or no layers enabled → return `[]`.
- If min === max for a layer → all normalised values = 0.5.
- If `lookupNearest` returns null → exclude that point from results.

---

## Interfaces

### `IsoHomePage` additions

```ts
// New state
const [layerWeights, setLayerWeights] = useState<LayerWeight[]>(DEFAULT_LAYER_WEIGHTS);

// New queries
const { data: sunshineData } = useQuery({
  queryKey: ['static', 'sunshine'],
  queryFn: () => fetch('/api/static/sunshine').then(r => r.json()),
  staleTime: Infinity,
});
const { data: housePriceData } = useQuery({
  queryKey: ['static', 'house-prices'],
  queryFn: () => fetch('/api/static/house-prices').then(r => r.json()),
  staleTime: Infinity,
});

// Derived: recomputes when isochrone, data, or weights change
const costScores = useMemo<CostPoint[]>(() => {
  if (!mergedIsochrone || !sunshineData || !housePriceData) return [];
  const activeWeights = layerWeights.filter(l => l.enabled && l.weight > 0);
  if (activeWeights.length === 0) return [];
  const points = generateSampleGrid(mergedIsochrone);
  return computeCostField(points, activeWeights, {
    sunshine: sunshineData,
    house_price: housePriceData,
  });
}, [mergedIsochrone, sunshineData, housePriceData, layerWeights]);
```

### `IsoHomeControls` additions

New props:
```ts
layerWeights: LayerWeight[];
onLayerWeightsChange: (weights: LayerWeight[]) => void;
colormap: Colormap;
onColormapChange: (c: Colormap) => void;
```

New UI inside `IsoHomeControls` JSX — collapsible "Desirability Layers" section:
```tsx
// Collapsible driven by local `open` state (useState<boolean>(false))
<div>
  <button
    onClick={() => setLayerPanelOpen(o => !o)}
    className="flex items-center justify-between w-full text-sm font-medium py-1"
    aria-expanded={layerPanelOpen}
  >
    Desirability layers
    <ChevronDown className={`h-4 w-4 transition-transform ${layerPanelOpen ? 'rotate-180' : ''}`} />
  </button>

  {layerPanelOpen && (
    <div className="space-y-3 mt-2">
      {layerWeights.map(layer => (
        <div key={layer.id} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={layer.enabled}
                onChange={e => updateLayer(layer.id, { enabled: e.target.checked })} />
              {layer.label}
            </label>
            <span className="text-gray-500 tabular-nums">{layer.weight}</span>
          </div>
          <input type="range" min={0} max={10} step={1} value={layer.weight}
            disabled={!layer.enabled}
            onChange={e => updateLayer(layer.id, { weight: Number(e.target.value) })}
            className="w-full" aria-label={`${layer.label} weight`} />
        </div>
      ))}

      {/* Colormap selector */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-600">Colormap</span>
        <select value={colormap} onChange={e => onColormapChange(e.target.value as Colormap)}
          className="text-xs border rounded px-1 py-0.5">
          <option value="viridis">Viridis</option>
          <option value="jet">Jet</option>
        </select>
      </div>
    </div>
  )}
</div>
```

### `IsoHomeMap` additions

New prop: `costScores: CostPoint[]`

New Mapbox GL source + layer (added after existing sources in the map `load` effect):

```ts
// Source: GeoJSON FeatureCollection of point features
map.addSource('cost-heatmap-source', {
  type: 'geojson',
  data: makeEmptyFC(),
});

// Layer: heatmap type
map.addLayer({
  id: 'cost-heatmap-layer',
  type: 'heatmap',
  source: 'cost-heatmap-source',
  paint: {
    'heatmap-weight': ['get', 'score'],   // 0–1 from CostPoint.score
    'heatmap-radius': 30,
    'heatmap-opacity': 0.75,
    'heatmap-intensity': 1.5,
    'heatmap-color': COLORMAP_EXPRESSIONS['viridis'],  // swapped via setLayoutProperty/setPaintProperty
  },
}, 'isochrone-fill'); // insert BELOW isochrone fill so boundary remains visible
```

When `costScores` changes, call:
```ts
const fc: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: costScores.map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: { score: p.score },
  })),
};
(map.getSource('cost-heatmap-source') as mapboxgl.GeoJSONSource).setData(fc);
```

### Colormap expressions

New file: `src/features/isohome/colormaps.ts`

```ts
import type { Expression } from 'mapbox-gl';
import type { Colormap } from './types';

export const COLORMAP_EXPRESSIONS: Record<Colormap, Expression> = {
  viridis: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,    'rgba(68, 1, 84, 0)',
    0.15, 'rgba(68, 1, 84, 0.6)',
    0.35, 'rgba(59, 82, 139, 0.75)',
    0.55, 'rgba(33, 145, 140, 0.8)',
    0.75, 'rgba(94, 201, 97, 0.85)',
    1.0,  'rgba(253, 231, 37, 0.9)',
  ],
  jet: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,    'rgba(0, 0, 143, 0)',
    0.15, 'rgba(0, 0, 255, 0.6)',
    0.35, 'rgba(0, 255, 255, 0.75)',
    0.5,  'rgba(0, 255, 0, 0.8)',
    0.65, 'rgba(255, 255, 0, 0.85)',
    0.85, 'rgba(255, 128, 0, 0.9)',
    1.0,  'rgba(255, 0, 0, 0.95)',
  ],
};
```

When the user changes colormap, call:
```ts
map.setPaintProperty('cost-heatmap-layer', 'heatmap-color', COLORMAP_EXPRESSIONS[newColormap]);
```

---

## Behaviour

### Happy path

1. User loads app. Isochrone loads for KGX/60 min.
2. Sunshine and house-price static files are fetched in parallel (TanStack Query,
   staleTime: Infinity — fetched once per session).
3. Once all three are available, `costScores` is computed via `useMemo`:
   - `generateSampleGrid` returns ~5–15k points inside the isochrone.
   - `computeCostField` normalises both layers and blends by weight (default 5/5).
   - Result is ~5–15k `CostPoint[]`.
4. `IsoHomeMap` receives updated `costScores`, sets GeoJSON source data.
5. Mapbox GL renders the heatmap inside the isochrone boundary.
6. User opens "Desirability Layers" collapsible, adjusts "House price" weight to 8.
7. `layerWeights` state updates → `costScores` recomputes → heatmap updates within
   one render cycle (~50–150 ms for the maths, then a Mapbox repaint).

### Weight = 0 for all layers

`costScores` returns `[]`, heatmap source is set to empty FeatureCollection, heatmap
disappears.

### Data not yet loaded

`costScores` memo guards on `sunshineData && housePriceData` — returns `[]` until both
are ready. No heatmap is shown during loading.

### Layer disabled (checkbox unchecked)

Treated as weight 0 for that layer — excluded from `computeCostField`.

### Isochrone changes (new terminus or time budget)

`mergedIsochrone` updates → `costScores` recomputes from scratch. This is the most
expensive path (~200 ms for grid generation + lookup). Acceptable; no debouncing needed
at this stage.

---

## Error handling

| Situation | Behaviour |
|-----------|-----------|
| `/api/static/sunshine` returns non-OK | TanStack Query retries (default 3×); heatmap stays hidden |
| `lookupNearest` finds no point within 0.15° | That CostPoint is excluded; heatmap rendered from remaining points |
| All points excluded (no data coverage) | `costScores = []`; heatmap hidden; no error shown to user in this phase |
| `computeCostField` throws | Caught in `useMemo` via try/catch; returns `[]` and logs to console |

---

## Acceptance criteria

- [ ] Collapsible "Desirability Layers" section appears below existing controls in `IsoHomeControls`.
- [ ] Section starts collapsed; clicking the header toggles open/closed.
- [ ] Each layer shows: enabled checkbox, label, weight slider (0–10), current weight value.
- [ ] Colormap selector shows Viridis and Jet options.
- [ ] With both layers enabled and non-zero weights, a heatmap appears inside the
      isochrone within 2 s of isochrone loading.
- [ ] Heatmap does not render outside the isochrone polygon.
- [ ] Changing a weight slider updates the heatmap without a page reload.
- [ ] Setting a layer weight to 0 removes its contribution (same as disabling).
- [ ] Disabling a layer checkbox removes its contribution.
- [ ] Switching colormap updates heatmap colours immediately.
- [ ] Existing controls (termini, time slider, stations/rail toggles, route hover) continue
      to work correctly.
- [ ] Unit tests pass for `generateSampleGrid`, `lookupNearest`, `computeCostField`.

---

## Out of scope

- Persisting weight preferences to localStorage or a backend.
- More than two layers in this phase (panel is designed to be extensible).
- Server-side score computation or raster tile generation.
- Sub-national house price breakdowns (property type, new-build vs resale).
- Legend/scale bar for the heatmap colours.
- Performance optimisation for grids > 20k points (Web Worker offload).
