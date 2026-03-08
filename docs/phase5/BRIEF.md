# Brief: IsoHome Phase 5 — Weighted Desirability Layers

> Feed this back to Claude with: _"Read BRIEF.md, then help me write SPEC.md"_
> Or skip straight to: _"Read BRIEF.md and SPEC.md, implement Phase 5A"_

---

## Problem statement

The isochronic map already shows *where* you can live within a commute budget. Phase 5
answers "which of those places is actually desirable?" — by overlaying data layers
(sunshine, house price) weighted by the user's priorities, and highlighting hotspots
inside the isochrone where the combined score is highest.

## Goals

- Fetch and display two data layers within the isochrone boundary: **average annual
  sunshine hours** and **median house price** (both UK-wide static grids).
- Let the user set a **relative integer weight (0–10)** for each layer in a collapsible
  "Desirability Layers" panel that can grow with future layers.
- Compute a **weighted normalised score** per sampled point within the isochrone and
  render it as a smooth **heatmap** using a perceptual colormap (Viridis default; Jet as
  an alternative). Higher score = more desirable.
- Hotspot heatmap is **clipped to the isochrone boundary** — it does not bleed outside.

## Non-goals

- No user accounts or persisted weight preferences (local state only for now).
- No backend computation — all score maths run client-side in the browser.
- No new layers beyond sunshine and house price in this phase (panel is extensible but
  only these two are wired up).
- No sub-national or property-type breakdowns for house prices.

## Users / context

A single user (Joe) running the app locally in the browser. React 18 + TypeScript +
Mapbox GL + TanStack Query + Tailwind. No shadcn/ui in use — plain HTML inputs +
Tailwind. The app lives at `src/features/isohome/`.

## Constraints

- Static data files must be small enough to serve from the existing `/api/static/*`
  mock/handler pattern (< 3 MB each after processing).
- Client-side sample grid: ≤ ~10k points inside isochrone at 5 km spacing —
  must not block the main thread for more than ~200 ms.
- No new npm dependencies except `@turf/boolean-point-in-polygon` and
  `@turf/bbox` (both already in the turf ecosystem; check if turf is already installed
  before adding).
- Colormap stops must be hand-coded (Mapbox GL expression arrays) — no external
  colormap library.

## Open questions

- None that block the spec. Data sourcing approach is decided (see SPEC.md §Data
  preparation).

## Success criteria

- With both layers enabled and non-zero weights, a coloured heatmap appears inside (and
  only inside) the isochrone within 2 s of the isochrone loading.
- Changing a weight slider updates the heatmap within 300 ms.
- Setting a layer weight to 0 effectively disables that layer's contribution.
- The "Desirability Layers" section collapses and expands without affecting other
  controls.
- Existing functionality (isochrone, stations, rail lines, route hover) is unaffected.
