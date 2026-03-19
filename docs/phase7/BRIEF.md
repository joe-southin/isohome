# Brief: IsoHome Phase 7 — Integration into oddtensor.dev

> Feed this back to Claude with: _"Read docs/phase7/BRIEF.md and docs/phase7/SPEC.md, implement Phase 7A"_

---

## Problem statement

IsoHome is currently a standalone Cloudflare Worker at `isohome.joe-southin.workers.dev`.
It was built on the same stack as `oddtensor.dev` specifically to make migration easy.
Hosting it separately means it isn't discoverable via the main site and lacks the
"Featured Tools & Utils" surface. The goal is to embed IsoHome as a first-class tool
at `https://www.oddtensor.dev/tools/isohome`, with the isohome R2/API co-located in
the hub's Cloudflare account.

## Goals

- IsoHome is accessible at `https://www.oddtensor.dev/tools/isohome` — a full-screen
  interactive map experience (no nav header/footer, matching the current standalone UX).
- A "Back to Tools" button in the controls panel returns the user to `/tools`.
- IsoHome appears in the `/tools` listing page and as a hero card on the homepage
  ("Featured Tools & Utils"), linking to `/tools/isohome`.
- The hub's single Cloudflare Worker handles all IsoHome API requests
  (`/api/isohome/isochrone/*`, `/api/isohome/static/*`), reading from the existing
  `isohome` R2 bucket via a new binding.
- Dev workflow: Vite proxy forwards `/api/isohome/*` to the live isohome worker, so
  no MSW setup is needed in the hub.

## Non-goals

- No decommissioning of the standalone isohome Worker/deployment in this phase (keep it
  running as a fallback / for its own dev workflow).
- No changes to the isohome Worker or its R2 bucket contents (files stay where they are).
- No port of the isohome unit test suite to the hub's test framework.
- No mobile-specific layout work.
- No changes to the isohome feature logic itself (that's Phases 5/6).

## Users / context

Visitors to oddtensor.dev who land on the tools page or homepage. Same audience as
the standalone site. The hub is React 18 + React Router v6 + TanStack Query + Tailwind
+ shadcn/ui + Cloudflare Worker (JS) + D1 + R2. IsoHome uses React + TanStack Query +
Mapbox GL + Tailwind + Cloudflare Worker (TS) + R2.

## Constraints

- Hub worker is plain JavaScript (not TypeScript) — isohome API routes must follow the
  same JS pattern, not the TS pattern from the isohome Worker.
- Hub's `handleBlogAPI` is the monolithic handler for all `/api/*` — isohome routes are
  added inside it (consistent with existing pattern, no architectural refactor needed).
- `mapbox-gl`, `@turf/*`, and `@types/mapbox-gl` are new dependencies for the hub.
- MSW is NOT introduced into the hub; dev uses Vite proxy to the live isohome worker.
- `VITE_MAPBOX_TOKEN` is a new env var for the hub (isohome's token, same value).

## Open questions

None. Architecture decisions resolved:
- **API**: Hub worker handles `/api/isohome/*`, reads from `ISOHOME_BUCKET` binding.
- **R2**: Add `ISOHOME_BUCKET` binding to hub wrangler.toml; no file migration.
- **Back button**: Inside the controls panel, top of the panel, above the "IsoHome" heading.
- **Layout**: No Layout wrapper — fullscreen map, matching current standalone UX.
- **D1**: Add IsoHome entry via migration SQL (`is_hero = 1` to feature on homepage).

## Success criteria

- `https://www.oddtensor.dev/tools/isohome` loads the full map with controls.
- The map and all layers (isochrone, stations, desirability heatmap) work correctly.
- "Back to Tools" button navigates to `/tools`.
- IsoHome card appears in `/tools` grid and in "Featured Tools & Utils" on homepage.
- `npm run build && wrangler deploy` succeeds with zero errors.
- Standalone `isohome.joe-southin.workers.dev` continues to work unchanged.
