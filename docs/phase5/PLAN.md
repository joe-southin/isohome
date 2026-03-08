# Plan: IsoHome Phase 5 — Weighted Desirability Layers

> Paste the session prompt for each phase into a new Claude session to kick it off.
> Complete one phase before starting the next.

---

## Agent architecture recommendation

**Use a single lead agent (Opus 4.6) with optional Sonnet 4.6 sub-agents for
isolated tasks.**

Rationale: Phase 5 writes to a single shared React codebase. True parallel sub-agents
would cause file conflicts on shared files (`IsoHomePage.tsx`, `IsoHomeMap.tsx`,
`IsoHomeControls.tsx`). Sequential work by one agent is safer and simpler to review.

Where sub-agents *do* make sense:

| Sub-task | When to spawn | Model |
|----------|---------------|-------|
| Python data prep scripts (5A) | Fully isolated; no overlap with TS frontend | Sonnet 4.6 |
| Colormap expression generation | Pure maths / lookup table, no file conflicts | Sonnet 4.6 |
| Unit test authoring (5D) | After implementation is stable; read-only of src files | Sonnet 4.6 |

**Pattern**: Lead (Opus 4.6) reads BRIEF + SPEC, plans the session, delegates isolated
sub-tasks to Sonnet 4.6 sub-agents, integrates their outputs, then continues with the
parts that require shared-file awareness.

---

## Phase overview

| Phase | Name | Deliverable | Status |
|-------|------|-------------|--------|
| 5A | Data preparation | Two static GeoJSON files + mock handlers | ⬜ not started |
| 5B | Computation engine | `costField.ts`, `colormaps.ts`, `types.ts` | ⬜ not started |
| 5C | Map rendering | Heatmap layer in `IsoHomeMap` | ⬜ not started |
| 5D | Controls UI + wiring | Collapsible panel, weight sliders, page wiring | ⬜ not started |
| 5E | Tests + polish | Unit tests, component tests, acceptance sweep | ⬜ not started |

---

## Phase 5A: Data preparation

**Goal**: Produce two static GeoJSON files (sunshine grid, house price grid) and wire
them into the existing MSW mock handler system.

**Deliverables**:
- `scripts/prepare_sunshine.py` — downloads Met Office data, resamples to 0.05° grid,
  outputs `public/sunshine.json`
- `scripts/prepare_house_prices.py` — downloads Land Registry PP data, aggregates
  median by postcode district, geocodes centroids, outputs `public/house-prices.json`
- `src/mocks/handlers.ts` updated to serve both files at `/api/static/sunshine` and
  `/api/static/house-prices`
- Brief README comment in each script documenting the data source URL

**Depends on**: nothing (can run in parallel with 5B if needed)

**Notes**:
- Both JSON files must use the schema in SPEC.md §Data preparation: GeoJSON
  FeatureCollection of Point features with `properties.value` (number).
- Target file sizes: sunshine < 1.5 MB, house prices < 0.5 MB.
- If the exact Met Office source is unavailable, use Open-Meteo historical API
  (https://open-meteo.com/en/docs/historical-weather-api) to build the sunshine grid:
  query annual sunshine duration for a 0.05° grid over UK bbox.
- For house prices, fallback: use ONS median house price by local authority
  (https://www.ons.gov.uk/peoplepopulationandcommunity/housing) if Land Registry
  PP-complete is too large to process quickly.

**Session prompt**:

```
Read planning/phase5/BRIEF.md and planning/phase5/SPEC.md (§Data preparation section).

Implement Phase 5A: Data preparation.

Goal: Produce two static GeoJSON files for UK sunshine hours and median house prices,
and register them in the MSW mock handler.

Deliverables:
- scripts/prepare_sunshine.py
- scripts/prepare_house_prices.py
- Update src/mocks/handlers.ts to serve /api/static/sunshine and /api/static/house-prices

Notes:
- Both output files use the schema: GeoJSON FeatureCollection, Point features,
  properties.value (number). See SPEC.md §Data preparation for details.
- Sunshine grid: 0.05° spacing, UK bbox (lon -8→2, lat 49.5→61), ~15k points.
- House prices: postcode district centroids, ~2800 points.
- Run the scripts and verify the output files exist and have correct GeoJSON structure.
- If Met Office data requires authentication, use the Open-Meteo fallback described
  in PLAN.md §5A notes.
```

---

## Phase 5B: Computation engine

**Goal**: Implement the pure TypeScript functions that turn isochrone + data grids +
weights into a `CostPoint[]` array, fully unit-tested in isolation.

**Deliverables**:
- `src/features/isohome/types.ts` — `LayerId`, `LayerWeight`, `CostPoint`, `Colormap`
- `src/features/isohome/utils/costField.ts` — `generateSampleGrid`, `lookupNearest`,
  `computeCostField`
- `src/features/isohome/colormaps.ts` — `COLORMAP_EXPRESSIONS` (Viridis + Jet)
- `src/features/isohome/__tests__/costField.test.ts` — unit tests (see acceptance
  criteria in SPEC.md)

**Depends on**: nothing (data files from 5A are not needed to write/test these functions
— use small synthetic GeoJSON fixtures in tests)

**Session prompt**:

```
Read planning/phase5/BRIEF.md and planning/phase5/SPEC.md.

Implement Phase 5B: Computation engine.

Goal: Pure TypeScript functions for grid sampling, nearest-neighbour lookup, and
weighted score computation. No UI changes in this phase.

Deliverables:
- src/features/isohome/types.ts
- src/features/isohome/utils/costField.ts  (generateSampleGrid, lookupNearest, computeCostField)
- src/features/isohome/colormaps.ts  (COLORMAP_EXPRESSIONS for viridis + jet)
- src/features/isohome/__tests__/costField.test.ts  (unit tests)

Notes:
- Check whether @turf/boolean-point-in-polygon and @turf/bbox are already installed
  in package.json before running npm install.
- The full algorithm for each function is in SPEC.md §Computation engine.
- Use small synthetic GeoJSON fixtures in tests — no dependency on the real data files.
- Run vitest after implementing to confirm all tests pass.
```

---

## Phase 5C: Map rendering

**Goal**: Add the heatmap layer to `IsoHomeMap` and wire it to a new `costScores` prop.

**Deliverables**:
- `src/features/isohome/IsoHomeMap.tsx` updated:
  - New prop `costScores: CostPoint[]`
  - `cost-heatmap-source` (GeoJSON) and `cost-heatmap-layer` (heatmap) added
  - Layer inserted below `isochrone-fill` so the isochrone boundary stays visible
  - Responds to `costScores` changes by calling `source.setData()`
  - New prop `colormap: Colormap`; calls `setPaintProperty` when colormap changes

**Depends on**: Phase 5B (types + colormap expressions must exist)

**Session prompt**:

```
Read planning/phase5/BRIEF.md and planning/phase5/SPEC.md.

Phase 5B is complete. The following now exist:
- src/features/isohome/types.ts  (CostPoint, Colormap)
- src/features/isohome/colormaps.ts  (COLORMAP_EXPRESSIONS)

Implement Phase 5C: Map rendering.

Goal: Add a Mapbox GL heatmap layer to IsoHomeMap driven by a new costScores prop.

Deliverables:
- Updated src/features/isohome/IsoHomeMap.tsx

Notes:
- Full interface spec is in SPEC.md §IsoHomeMap additions and §Colormap expressions.
- The new layer must be inserted BELOW 'isochrone-fill' so the isochrone boundary
  remains visible on top of the heatmap.
- When costScores is empty ([]), the source should be set to an empty FeatureCollection
  (use the existing makeEmptyFC() helper).
- IsoHomePage.tsx does NOT need to be updated in this phase — pass dummy data from
  IsoHomePage temporarily (empty array) to verify the layer registers without errors.
- Run the existing IsoHomeMap tests after changes to check nothing is broken.
```

---

## Phase 5D: Controls UI + page wiring

**Goal**: Add the collapsible Desirability Layers panel to `IsoHomeControls`, then wire
everything together in `IsoHomePage` — queries, `useMemo` computation, and prop passing.

**Deliverables**:
- `src/features/isohome/IsoHomeControls.tsx` updated with collapsible panel and sliders
- `src/features/isohome/IsoHomePage.tsx` updated:
  - Two new `useQuery` calls for static data
  - `layerWeights` + `colormap` state
  - `costScores` via `useMemo` calling `generateSampleGrid` + `computeCostField`
  - New props passed to `IsoHomeControls` and `IsoHomeMap`

**Depends on**: Phases 5B and 5C

**Session prompt**:

```
Read planning/phase5/BRIEF.md and planning/phase5/SPEC.md.

Phases 5B and 5C are complete. The following now exist:
- src/features/isohome/types.ts
- src/features/isohome/utils/costField.ts  (generateSampleGrid, computeCostField)
- src/features/isohome/colormaps.ts
- IsoHomeMap already accepts costScores: CostPoint[] and colormap: Colormap props

Implement Phase 5D: Controls UI + page wiring.

Goal: Add the collapsible Desirability Layers panel and connect all state through
IsoHomePage.

Deliverables:
- Updated src/features/isohome/IsoHomeControls.tsx
- Updated src/features/isohome/IsoHomePage.tsx

Notes:
- Full JSX spec for the collapsible panel is in SPEC.md §IsoHomeControls additions.
- Full useMemo / useQuery spec is in SPEC.md §IsoHomePage additions.
- Use ChevronDown from lucide-react (already installed) for the collapse chevron.
- The DEFAULT_LAYER_WEIGHTS are defined in SPEC.md §Data models — both layers start
  enabled with weight 5.
- After wiring, manually verify in the browser that the heatmap appears when the
  isochrone loads (MSW must be serving the static files from Phase 5A).
```

---

## Phase 5E: Tests + polish

**Goal**: Full acceptance sweep against SPEC.md criteria, unit tests for new utilities,
component tests for the new controls.

**Deliverables**:
- `src/features/isohome/__tests__/costField.test.ts` — complete unit tests if not
  already written in 5B (or extend them)
- `src/features/isohome/__tests__/IsoHomeControls.test.tsx` — tests for collapsible
  panel: open/close, weight slider interaction, checkbox enable/disable
- All existing tests continue to pass
- Console free of errors/warnings in normal operation

**Depends on**: Phases 5B, 5C, 5D

**Session prompt**:

```
Read planning/phase5/BRIEF.md and planning/phase5/SPEC.md (§Acceptance criteria).

Phases 5A–5D are complete. The Desirability Layers feature is fully wired.

Implement Phase 5E: Tests + polish.

Goal: Ensure all acceptance criteria in SPEC.md pass; add missing tests.

Deliverables:
- Extended src/features/isohome/__tests__/costField.test.ts
- New src/features/isohome/__tests__/IsoHomeControls.test.tsx covering the
  collapsible panel
- All vitest tests passing (run: npm test)

Notes:
- Check each acceptance criterion in SPEC.md §Acceptance criteria explicitly.
- For costField tests: test edge cases — all weights zero, min===max layer, points
  with no data coverage.
- For Controls tests: the collapsible section must start closed; verify aria-expanded.
- Fix any TypeScript errors or test failures before marking this phase done.
```

---

## Notes

**Ordering flexibility**: 5A and 5B can be worked in parallel (by separate agents or
sessions) since they touch different files. 5C requires 5B's types. 5D requires both
5B and 5C. 5E requires all prior phases.

**Performance checkpoint** (do in 5E): after loading a real isochrone, log
`performance.now()` around the `computeCostField` call. If it exceeds 300 ms, the
follow-up optimisation is to move the computation to a Web Worker — but don't do this
preemptively.

**Future layers** (not in this spec): The `LayerWeight[]` array and `dataByLayer`
record pattern make it trivial to add a third layer (e.g. school Ofsted ratings,
flood risk) in Phase 6 — just add a new `LayerId`, a new data file, and a new entry in
`DEFAULT_LAYER_WEIGHTS`.
