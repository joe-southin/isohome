# Plan: IsoHome Phase 7 — Integration into oddtensor.dev

> Paste the session prompt for each phase into a new Claude session.
> Work in the **hub repo** (`~/Projects/odd-tensor-hub`) unless noted otherwise.
> Complete Phase 7A before starting 7B; 7B and 7C can run in parallel.

---

## Phase overview

```
Phase 7A: Infrastructure (deps, worker, wrangler, env, proxy, D1)
Phase 7B: Feature code copy + API URL update
Phase 7C: UI — route, back button, final wiring
Phase 7D: Smoke test + deploy
```

7A must complete first (worker routes needed for 7B/7C to work end-to-end).
7B and 7C are independent of each other and can run in parallel.
7D is the final verification pass.

---

## Phase 7A — Infrastructure

**Goal**: Wire everything except the React code. After this phase, hitting
`/api/isohome/static/stations` on the deployed hub Worker returns valid GeoJSON.

**Deliverables**:
- `wrangler.toml` — ISOHOME_BUCKET binding added
- `worker.js` — IsoHome API handlers added
- `vite.config.ts` — dev proxy added
- `.env` — VITE_MAPBOX_TOKEN and VITE_ISOHOME_API_BASE added
- `migrations/008_add_isohome_tool.sql` — created and executed (local + remote)
- `package.json` — new deps added and installed

**Acceptance gate**: `wrangler deploy` succeeds. `curl https://www.oddtensor.dev/api/isohome/static/stations` returns GeoJSON. D1 migration applied (IsoHome visible on `/tools` and homepage after browser refresh).

---

### Session prompt — Phase 7A

```
Read ~/Projects/isohome/docs/phase7/BRIEF.md and ~/Projects/isohome/docs/phase7/SPEC.md.

Implement Phase 7A: Infrastructure — wrangler binding, worker routes, env vars,
Vite proxy, npm deps, and D1 migration.

Work in: ~/Projects/odd-tensor-hub

Steps (do in order):

1. package.json (SPEC §1)
   - Add mapbox-gl, @turf/bbox, @turf/boolean-point-in-polygon, @turf/helpers to
     dependencies. Match version numbers from ~/Projects/isohome/package.json exactly.
   - Add @types/mapbox-gl to devDependencies.
   - Run npm install.

2. wrangler.toml (SPEC §9)
   - Add [[r2_buckets]] binding = "ISOHOME_BUCKET" bucket_name = "isohome"

3. worker.js (SPEC §8.1)
   - Add IsoHome API handlers at the TOP of handleBlogAPI (before any existing route
     checks). Follow SPEC §8.1 exactly — isochrone route + static route + validation.
   - Do NOT modify any existing handlers.

4. vite.config.ts (SPEC §7)
   - Add server.proxy for /api/isohome → https://isohome.joe-southin.workers.dev

5. .env (SPEC §6)
   - Add VITE_ISOHOME_API_BASE=/api/isohome
   - Add VITE_MAPBOX_TOKEN — copy value from ~/Projects/isohome/.env

6. migrations/008_add_isohome_tool.sql (SPEC §10)
   - Create file with the SQL from SPEC §10.
   - Execute: wrangler d1 execute odd-tensor-hub-db --local --file=migrations/008_add_isohome_tool.sql
   - (Remote execution happens in Phase 7D before final deploy)

7. Verify build still passes: npm run build
   (TypeScript will complain about missing feature files — that's expected and fine
   for this phase; the feature files are added in Phase 7B)

Ignore TypeScript errors about missing isohome feature imports — those are resolved in
Phase 7B. The goal of this phase is that the infrastructure changes are in place.
```

---

## Phase 7B — Feature code copy + API URL update

**Goal**: Copy the isohome React feature into the hub and update all API fetch calls
to use the namespaced `/api/isohome/` prefix.

**Deliverables**:
- `src/features/isohome/` — all files copied from isohome repo
- `config.ts` — ISOHOME_API_BASE added
- `IsoHomePage.tsx` — all fetch paths updated
- `IsoHomeMap.tsx` — mapbox-gl CSS import added

**Acceptance gate**: `npm run build` passes with no TypeScript errors (the route in
App.tsx is added in 7C, so there may be a lint warning about unused import if you
add the import early; that's acceptable).

---

### Session prompt — Phase 7B

```
Read ~/Projects/isohome/docs/phase7/BRIEF.md and ~/Projects/isohome/docs/phase7/SPEC.md.

Implement Phase 7B: Copy isohome feature code and update API paths.

Work in: ~/Projects/odd-tensor-hub (destination)
Source:  ~/Projects/isohome/src/features/isohome/ (copy from here)

Steps:

1. Copy feature directory (SPEC §2)
   Copy all files from ~/Projects/isohome/src/features/isohome/
   to ~/Projects/odd-tensor-hub/src/features/isohome/
   Include: config.ts, types.ts, colormaps.ts, IsoHomePage.tsx, IsoHomeMap.tsx,
            IsoHomeControls.tsx, HelpModal.tsx, Tooltip.tsx, utils/, __tests__/
   Do NOT copy: anything from isohome/src/mocks/ or isohome/src/main.tsx

2. Add ISOHOME_API_BASE to config.ts (SPEC §3.1)
   Add the export at the bottom of the copied config.ts.

3. Update all fetch() calls in IsoHomePage.tsx (SPEC §3.2)
   Replace every hardcoded /api/ prefix with ${ISOHOME_API_BASE}/.
   There are approximately 8 fetch calls — find them all with a grep for "fetch(" and
   "/api/". Update the import of config to include ISOHOME_API_BASE.

4. Add mapbox-gl CSS import in IsoHomeMap.tsx (SPEC §11)
   Add: import 'mapbox-gl/dist/mapbox-gl.css';
   at the top of the file.

5. Verify: npm run build
   All TypeScript errors in the isohome feature should be zero.
   (App.tsx may warn about a missing route or import until Phase 7C — ignore that.)
```

---

## Phase 7C — Route, back button, final wiring

**Goal**: Register the `/tools/isohome` route in the hub's router and add the
"Back to Tools" button to the controls panel.

**Deliverables**:
- `src/App.tsx` — IsoHomePage route added (no Layout)
- `src/features/isohome/IsoHomeControls.tsx` — Back to Tools link at top

**Acceptance gate**: `npm run dev` → navigate to `http://localhost:8080/tools/isohome`
→ map loads. "Back to Tools" link visible and navigates correctly.

---

### Session prompt — Phase 7C

```
Read ~/Projects/isohome/docs/phase7/BRIEF.md and ~/Projects/isohome/docs/phase7/SPEC.md.

Implement Phase 7C: Register the route and add the Back to Tools button.

Prerequisite: Phase 7B is complete (feature files exist in src/features/isohome/).
Work in: ~/Projects/odd-tensor-hub

Steps:

1. Add route to App.tsx (SPEC §5)
   - Import IsoHomePage from './features/isohome/IsoHomePage'
   - Add <Route path="/tools/isohome" element={<IsoHomePage />} />
     BEFORE the existing <Route path="/tools/:slug" .../> catch-all.
   - No Layout wrapper.

2. Add Back to Tools link to IsoHomeControls.tsx (SPEC §4)
   - Import Link from 'react-router-dom' and ArrowLeft from 'lucide-react'
     (both are already in the hub's dependencies).
   - Add the Link element as the very first child inside the controls panel div,
     above the <h2>IsoHome</h2> heading.
   - Use exactly the className from SPEC §4.

3. Verify:
   - npm run build (must pass with zero errors)
   - npm run dev → open http://localhost:8080/tools/isohome
   - Map loads, controls panel visible, "Back to Tools" link present
   - Click "Back to Tools" → navigates to /tools
   - IsoHome card visible on /tools page and on homepage (if D1 migration from 7A
     was applied locally)
```

---

## Phase 7D — Smoke test + deploy

**Goal**: Final end-to-end verification and production deploy.

**Deliverables**:
- Remote D1 migration executed
- `wrangler deploy` of hub worker (with new ISOHOME_BUCKET binding)
- Live site verified

**Steps** (do manually or in a session):

```bash
# 1. Apply D1 migration to production
wrangler d1 execute odd-tensor-hub-db \
  --file=migrations/008_add_isohome_tool.sql

# 2. Build
npm run build

# 3. Deploy
wrangler deploy

# 4. Smoke tests — verify each in browser:
open https://www.oddtensor.dev/tools/isohome
# → fullscreen map, no layout header/footer
# → select KGX + 60 min → isochrone renders
# → open Desirability Layers → heatmap renders
# → click "Back to Tools" → navigates to /tools

open https://www.oddtensor.dev/tools
# → IsoHome card visible in grid

open https://www.oddtensor.dev/
# → IsoHome in "Featured Tools & Utils" section

# 5. Verify standalone still works
open https://isohome.joe-southin.workers.dev/isohome

# 6. OG meta tag check
curl -s -A "Twitterbot/1.0" https://www.oddtensor.dev/tools/isohome \
  | grep -E "og:title|og:description"
# Should return IsoHome title and short description from D1
```

---

## Dependency note

Phase 7A (infrastructure) must complete before 7D (deploy), since wrangler.toml
needs the ISOHOME_BUCKET binding before deploying.

7B and 7C can be done in the same session if convenient — they touch different files
and don't conflict.

The recommended order for a single-session execution: 7A → 7B → 7C → 7D.
