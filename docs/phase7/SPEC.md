# Spec: IsoHome Phase 7 — Integration into oddtensor.dev

> **Purpose**: Implementation blueprint for migrating IsoHome into the hub codebase.
> Feed back to Claude with: _"Read docs/phase7/BRIEF.md and docs/phase7/SPEC.md. Implement Phase 7A."_
>
> **Hub repo**: `~/Projects/odd-tensor-hub`
> **IsoHome repo**: `~/Projects/isohome` (source of feature code to copy from)

---

## Architecture overview

```
BEFORE:
  isohome.joe-southin.workers.dev    (standalone Worker + R2 + React SPA)

AFTER:
  www.oddtensor.dev/tools/isohome    (hub SPA, served by hub Worker)
        │
        ├── GET /tools/isohome       → hub SPA → React Router → <IsoHomePage />
        │
        ├── GET /api/isohome/isochrone/:crs/:min  → hub Worker → ISOHOME_BUCKET
        ├── GET /api/isohome/static/:key           → hub Worker → ISOHOME_BUCKET
        │
  isohome.joe-southin.workers.dev    (unchanged, still live, used as dev proxy)
```

---

## 1. Dependencies (hub `package.json`)

Add to `dependencies`:
```json
"mapbox-gl": "^3.x",
"@turf/bbox": "^7.x",
"@turf/boolean-point-in-polygon": "^7.x",
"@turf/helpers": "^7.x"
```

Add to `devDependencies`:
```json
"@types/mapbox-gl": "^3.x"
```

Match the exact versions already used in the isohome `package.json` to avoid compatibility issues.

---

## 2. Feature code copy

Copy the entire isohome feature directory wholesale:

```
FROM: isohome/src/features/isohome/
TO:   odd-tensor-hub/src/features/isohome/
```

This includes all subdirectories and files:
- `config.ts`
- `types.ts`
- `colormaps.ts`
- `IsoHomePage.tsx`
- `IsoHomeMap.tsx`
- `IsoHomeControls.tsx`
- `HelpModal.tsx`
- `Tooltip.tsx`
- `utils/costField.ts`
- `utils/formatTime.ts`
- `utils/sliderIndex.ts`
- `__tests__/` (copy for reference; tests are not wired into hub's test runner in this phase)

Do NOT copy:
- `isohome/src/mocks/` (hub uses Vite proxy instead of MSW)
- `isohome/src/main.tsx`, `isohome/src/App.tsx` (hub has its own)
- `isohome/worker/` (hub has its own worker)

---

## 3. API base URL configuration

The standalone isohome uses paths like `/api/isochrone/:crs/:min`.
In the hub, these are namespaced to `/api/isohome/isochrone/:crs/:min`.

### 3.1 Add `API_BASE` to config.ts

**File**: `odd-tensor-hub/src/features/isohome/config.ts`

Add at the bottom:

```typescript
/**
 * Base path for IsoHome API requests.
 * Standalone: /api (default)
 * Hub (oddtensor.dev): /api/isohome (set via VITE_ISOHOME_API_BASE)
 */
export const ISOHOME_API_BASE =
  import.meta.env.VITE_ISOHOME_API_BASE ?? '/api';
```

### 3.2 Update all fetch calls in `IsoHomePage.tsx`

Replace hardcoded `/api/` prefixes with `ISOHOME_API_BASE`:

```typescript
// Add import at top
import { LONDON_TERMINI, TIME_BUCKETS, ISOHOME_API_BASE } from './config';

// BEFORE
const res = await fetch(`/api/isochrone/${crs}/${minutes}`);
// AFTER
const res = await fetch(`${ISOHOME_API_BASE}/isochrone/${crs}/${minutes}`);

// BEFORE
const res = await fetch(`/api/isochrone/walk/${crs}/${selectedMinutes}`);
// AFTER
const res = await fetch(`${ISOHOME_API_BASE}/isochrone/walk/${crs}/${selectedMinutes}`);

// BEFORE
queryFn: () => fetch('/api/static/stations').then(r => r.json()),
// AFTER
queryFn: () => fetch(`${ISOHOME_API_BASE}/static/stations`).then(r => r.json()),
```

Apply the same replacement to all six static layer fetches (`stations`, `rail-lines`,
`sunshine`, `house-prices`, `crime`, `deprivation`).

---

## 4. Back button in `IsoHomeControls.tsx`

Add a "Back to Tools" link at the very top of the controls panel, above the `<h2>IsoHome</h2>`
heading. Use React Router's `<Link>` (already available in the component via `react-router-dom`).

```tsx
// Add import (if not already present)
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Inside the panel div, as the first child:
<Link
  to="/tools"
  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1 -mt-1"
>
  <ArrowLeft className="h-3 w-3" />
  Back to Tools
</Link>
```

This sits above the `<h2 className="text-lg font-semibold">IsoHome</h2>` heading.

---

## 5. Route in `App.tsx`

**File**: `odd-tensor-hub/src/App.tsx`

Add a new import and route. The route must be placed **before** the generic `/tools/:slug`
catch-all, and must NOT be wrapped in `<Layout>` (fullscreen map experience):

```typescript
// Add import alongside other tool imports
import IsoHomePage from './features/isohome/IsoHomePage';

// In <Routes>, add before the /tools/:slug route:
<Route path="/tools/isohome" element={<IsoHomePage />} />
<Route path="/tools/:slug" element={<Layout><ToolDetail /></Layout>} />
```

### Why no Layout?

IsoHome is a fullscreen map. Wrapping in Layout would add the sticky nav header and
footer, forcing a `calc(100vh - Npx)` adjustment across multiple components. The "Back
to Tools" button in the panel provides sufficient navigation. This matches the current
standalone UX and is the correct mental model for a full-screen map tool.

---

## 6. Environment variables

**File**: `odd-tensor-hub/.env` (and `.dev.vars` for wrangler dev)

Add:
```bash
# IsoHome
VITE_MAPBOX_TOKEN=pk.xxx          # same token used in isohome/.env
VITE_ISOHOME_API_BASE=/api/isohome
```

Copy the `VITE_MAPBOX_TOKEN` value from `isohome/.env`.

---

## 7. Vite dev proxy

**File**: `odd-tensor-hub/vite.config.ts`

Add a proxy so that during `npm run dev`, calls to `/api/isohome/*` are forwarded
to the live standalone isohome worker (no MSW, no local R2 needed):

```typescript
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api/isohome': {
        target: 'https://isohome.joe-southin.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/isohome/, '/api'),
      },
    },
  },
  // ... rest unchanged
}));
```

This rewrites `/api/isohome/static/sunshine` → `https://isohome.joe-southin.workers.dev/api/static/sunshine`.

> **Note**: If the standalone worker is down during hub development, run `wrangler dev`
> in the isohome repo and point the proxy at `http://localhost:8787` instead.

---

## 8. Hub worker — IsoHome API routes

**File**: `odd-tensor-hub/worker.js`

### 8.1 Add R2 helper for IsoHome

Inside `handleBlogAPI` (which handles all `/api/*` routes), add the isohome handlers
**at the top** of the function, before any existing route checks. This ensures isohome
paths are matched first and don't accidentally fall through to blog/tools handlers:

```javascript
// ── IsoHome API ────────────────────────────────────────────────────────────
const ISOHOME_VALID_CRS = ['KGX', 'PAD', 'WAT', 'VIC', 'LST', 'BFR', 'CST', 'CHX', 'EUS', 'MYB', 'STP'];
const ISOHOME_VALID_MINUTES = ['30', '45', '60', '75', '90', '120'];
const ISOHOME_VALID_STATIC = ['stations', 'rail-lines', 'sunshine', 'house-prices', 'crime', 'deprivation'];

// GET /api/isohome/isochrone/:crs/:minutes
const isochroneMatch = pathname.match(/^\/api\/isohome\/isochrone\/([A-Z]+)\/(\d+)$/);
if (isochroneMatch && method === 'GET') {
  const [, crs, minutes] = isochroneMatch;
  if (!ISOHOME_VALID_CRS.includes(crs) || !ISOHOME_VALID_MINUTES.includes(minutes)) {
    return new Response(JSON.stringify({ error: 'Invalid CRS or time bucket', code: 'INVALID_PARAMS' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  if (!env.ISOHOME_BUCKET) {
    return new Response(JSON.stringify({ error: 'ISOHOME_BUCKET not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  const key = `isochrones/${crs}/${minutes}.geojson`;
  const obj = await env.ISOHOME_BUCKET.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'Isochrone not found', code: 'NOT_FOUND' }), {
      status: 404,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  return new Response(obj.body, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// GET /api/isohome/static/:key
const isoStaticMatch = pathname.match(/^\/api\/isohome\/static\/([a-z-]+)$/);
if (isoStaticMatch && method === 'GET') {
  const [, key] = isoStaticMatch;
  if (!ISOHOME_VALID_STATIC.includes(key)) {
    return new Response(JSON.stringify({ error: 'Resource not found', code: 'NOT_FOUND' }), {
      status: 404,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  if (!env.ISOHOME_BUCKET) {
    return new Response(JSON.stringify({ error: 'ISOHOME_BUCKET not configured' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  const obj = await env.ISOHOME_BUCKET.get(`static/${key}.geojson`);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'Resource not found', code: 'NOT_FOUND' }), {
      status: 404,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
  return new Response(obj.body, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
// ── End IsoHome API ─────────────────────────────────────────────────────────
```

> The walk isochrone endpoint (`/api/isohome/isochrone/walk/:crs/:min`) is intentionally
> omitted — the feature is not yet live (returns 404 gracefully in the frontend).
> Add it later following the same pattern when walk data is available.

### 8.2 Meta tags for `/tools/isohome`

The hub's `getRouteMetaTags` function provides OG/social meta tags per route. The
`/tools/:slug` pattern already queries D1 for tool metadata. Since `/tools/isohome`
is added to the D1 tools table (§9), this works automatically with no additional
code — the regex `^\/tools\/([^\/]+)$` will match `/tools/isohome` and return the
tool's title and description from D1.

---

## 9. Hub wrangler config

**File**: `odd-tensor-hub/wrangler.toml`

Add the IsoHome R2 bucket binding alongside the existing one:

```toml
[[r2_buckets]]
binding = "ISOHOME_BUCKET"
bucket_name = "isohome"
```

No preview bucket is needed (the live bucket serves both prod and dev-via-wrangler).

---

## 10. D1 database entry

**File**: `odd-tensor-hub/migrations/008_add_isohome_tool.sql`

```sql
INSERT INTO tools (
  id, slug, title, short_description, description,
  how_to_use, tech_notes, github_url,
  is_hero, status, created_at, updated_at
) VALUES (
  'isohome-1',
  'isohome',
  'IsoHome',
  'Explore which parts of the UK fall within a given commute time of London — with a desirability overlay.',
  '## IsoHome

IsoHome visualises which areas of the UK are reachable within a chosen commute time from a London terminus station.

Select a station, set your maximum commute time, and the map shades every area you can reach — combining drive-to-station time with train journey time for a realistic picture.

### Desirability layers

Beyond showing *where* you can commute from, IsoHome overlays a desirability heatmap weighted by:

- **Sunshine hours** — annual Met Office climate averages
- **House prices** — Land Registry median prices
- **Crime rate** — data.police.uk aggregate figures
- **Index of Deprivation** — MHCLG IoD 2025 composite score

Adjust the sliders to weight each factor by your own priorities.',
  '1. Select one or more London terminus stations
2. Use the commute time slider to set your maximum journey length
3. The map highlights all areas reachable within that time
4. Open "Desirability layers" to weight sunshine, house prices, crime, and deprivation
5. Hover over the isochrone to see the specific drive and train route for any point',
  'Pre-computed drive-time isochrones (OpenRouteService) combined with train journey times (Transport API). Static data layers served from Cloudflare R2. All scoring done client-side in the browser — no server computation at request time.',
  'https://github.com/joe-southin/isohome',
  1,
  'published',
  datetime('now'),
  datetime('now')
);
```

Run this migration:
```bash
wrangler d1 execute odd-tensor-hub-db --file=migrations/008_add_isohome_tool.sql
# For local dev:
wrangler d1 execute odd-tensor-hub-db --local --file=migrations/008_add_isohome_tool.sql
```

---

## 11. Tailwind / CSS — Mapbox GL styles

Mapbox GL requires its CSS to be imported. In the standalone isohome this is in
`IsoHomeMap.tsx` or `main.tsx`. In the hub, import it in `IsoHomeMap.tsx` (the component
that uses the map) to keep the dependency co-located:

```typescript
// At the top of src/features/isohome/IsoHomeMap.tsx
import 'mapbox-gl/dist/mapbox-gl.css';
```

If the hub's global CSS (`src/index.css`) already imports mapbox-gl styles, remove the
duplicate. Check before adding.

The Mapbox token in `IsoHomeMap.tsx` uses:
```typescript
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
```
This is unchanged — the env var name is the same in both repos.

---

## 12. Files changed summary

| Repo | File | Change |
|------|------|--------|
| `odd-tensor-hub` | `package.json` | Add `mapbox-gl`, `@turf/*`, `@types/mapbox-gl` |
| `odd-tensor-hub` | `src/features/isohome/**` | **New** — copy wholesale from isohome repo |
| `odd-tensor-hub` | `src/features/isohome/config.ts` | Add `ISOHOME_API_BASE` export |
| `odd-tensor-hub` | `src/features/isohome/IsoHomePage.tsx` | Replace `/api/` with `${ISOHOME_API_BASE}/` |
| `odd-tensor-hub` | `src/features/isohome/IsoHomeControls.tsx` | Add "Back to Tools" link at top of panel |
| `odd-tensor-hub` | `src/App.tsx` | Add `<Route path="/tools/isohome" element={<IsoHomePage />} />` |
| `odd-tensor-hub` | `wrangler.toml` | Add `ISOHOME_BUCKET` R2 binding |
| `odd-tensor-hub` | `worker.js` | Add IsoHome API handlers at top of `handleBlogAPI` |
| `odd-tensor-hub` | `vite.config.ts` | Add dev server proxy for `/api/isohome/*` |
| `odd-tensor-hub` | `.env` | Add `VITE_MAPBOX_TOKEN`, `VITE_ISOHOME_API_BASE` |
| `odd-tensor-hub` | `migrations/008_add_isohome_tool.sql` | **New** — D1 tool entry |
| `isohome` | *(no changes required)* | Standalone deployment unchanged |

---

## 13. Acceptance criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | `https://www.oddtensor.dev/tools/isohome` loads the full-screen map | Browser |
| 2 | Isochrone renders correctly for at least one terminus + time bucket | Select KGX + 60 min |
| 3 | All desirability layers load and heatmap renders | Toggle layers on/off |
| 4 | "Back to Tools" link navigates to `/tools` | Click it |
| 5 | IsoHome card appears on `/tools` grid | Browser |
| 6 | IsoHome card appears in "Featured Tools & Utils" on homepage (is_hero=1) | Browser |
| 7 | `npm run build` succeeds with no TS/Vite errors | Terminal |
| 8 | `wrangler deploy` succeeds | Terminal |
| 9 | Standalone `isohome.joe-southin.workers.dev` still works | Browser |
| 10 | Social meta tags for `/tools/isohome` return IsoHome title/description | curl OG check |
