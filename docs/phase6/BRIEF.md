# Brief: IsoHome Phase 6 — Index of Deprivation Layer + Compact Layer Panel

> Feed this back to Claude with: _"Read docs/phase6/BRIEF.md and docs/phase6/SPEC.md, implement Phase 6A"_

---

## Problem statement

The desirability model currently has three layers (sunshine, house price, crime). Two
more layers are planned imminently, and the layer panel already feels tall. Adding them
without redesigning the panel will make the controls unusable. At the same time, the
"Index of Multiple Deprivation 2025" (IoD25) — an official UK government dataset
measuring relative deprivation across 33,755 small areas (LSOAs) — is a high-value
addition to the desirability model: it aggregates income, employment, health, education,
crime, housing, and environment into a single composite score at the neighbourhood level.

## Goals

- Add **IoD25 deprivation** as a fourth desirability layer — real government data at
  LSOA level rather than synthetic — where higher deprivation score = less desirable.
- Redesign the desirability layer row layout: **toggle checkbox inline with the slider**
  (single row per layer), eliminating the separate checkbox + label row, so the panel can
  accommodate 5+ layers without feeling crowded.
- Reduce vertical spacing between layers in the panel.
- The panel must remain fully functional (enable/disable, weight slider, value readout).

## Non-goals

- No per-domain breakdowns (income, employment, health separately) — composite IMD score only.
- No choropleth at LSOA polygon level — use the same centroid point cloud + nearest-
  neighbour approach as existing layers, keeping client-side code unchanged.
- No changes to the isochrone, transport, or station layers.
- No new colormap options.

## Users / context

Same as Phase 5: Joe + visitors to the site. The controls panel is the primary concern —
it must not grow taller as new layers are added. Existing TypeScript + React + Tailwind
codebase (`src/features/isohome/`), same Python data pipeline pattern (`scripts/data/`).

## Constraints

- GeoJSON output must stay under 3 MB (33,755 LSOA centroids, compact encoding achieves ~1.7 MB).
- Client-side scoring logic (`costField.ts`) must not change — the new layer just adds
  an entry to the `LayerWeight[]` array and its data to the `dataByLayer` record.
- Must follow the existing pattern: Python script → GeoJSON → R2 → Worker endpoint →
  TanStack Query → `computeCostField`.
- `LayerId` union type in `types.ts` must be extended (not replaced) to preserve type safety.
- Panel redesign must not break existing test coverage.

## Open questions

- None. IoD25 data format (CSV + GeoPackage, LSOA-level) and the correct field to use
  (IMD Score from File 7, continuous 0–80+) are confirmed from the official statistical
  release. Population mean (~22) and stddev (~13) will be computed from the actual data
  during preprocessing and hard-coded into the layer config.

## Success criteria

- Deprivation layer appears in the panel, toggleable and weighted like existing layers.
- Heatmap visibly correlates with known deprived areas within commute range (e.g. coastal
  towns in Kent/Essex, Medway are more deprived than Surrey).
- Each layer row is a single line — checkbox, label, slider, and weight value all on one row.
- Adding a fifth layer later requires only a config change in `IsoHomePage.tsx`, not a
  layout redesign.
- All existing tests pass; new data pipeline script has ≥80% coverage.
