# Brief: IsoHome — UK Commute Isochrone Map

> **Purpose**: Captures *what* we're building and *why*. Target: under 300 words.
> Feed back to Claude with: _"Read BRIEF.md, then help me write SPEC.md"_

---

## Problem statement

When considering where to live in the UK, it's very difficult to visualise which areas fall within a given commute time of central London. Straight-line distance is a poor proxy because train frequency, drive-to-station time, and road conditions vary enormously. This tool gives house-hunters a clear, accurate picture of "anywhere within 60 minutes of King's Cross" — including the drive to the local station.

## Goals

- A user can select a major London terminus and set a max travel time (via slider); the map renders a shaded isochrone showing all areas reachable within that time.
- Travel time calculation combines: drive from home location to nearest reachable station (using real road times) + train journey time to the London terminus (using live timetable data, "just in time" logic — next available train).
- A toggleable map layer shows UK train stations and train lines (lines following real geographic routes, not straight lines).
- The app is hosted on Joe's personal website (isochronal.earth or similar) as a single-page tool.

## Non-goals (MVP)

- Target destinations are limited to major London termini only (King's Cross, Paddington, Waterloo, Victoria, Liverpool Street, Blackfriars, Cannon Street, Charing Cross, Euston, Marylebone).
- No tube, bus, walking, or multi-modal journeys within London — mainline rail + optional drive to remote station only.
- No additional data overlays (house prices, school ratings, sunshine) — these are explicitly Phase 2+.
- No user accounts, no saved searches.

## Users / context

Joe, and visitors to his personal website. Users are house-hunting and want to reason spatially about commute time. They are comfortable with maps and sliders but are not developers. The app should work on desktop; mobile is a stretch goal.

## Constraints

- **Mapping**: Mapbox GL JS (token already available).
- **Rail data**: Existing API key for UK rail timetable raw data (exact API TBD — see Open Questions).
- **Platform**: Cloudflare Workers + D1 + R2, React + shadcn/ui + TanStack Query (Joe's personal website stack).
- **Driving times**: Must use real road-network times, not Euclidean distance. API TBD — see Open Questions.
- **Train line geometry**: Must follow actual geographic routes on the map. Source TBD — see Open Questions.
- **Repo**: `isohome` (new, empty).

## Open questions

1. Which UK rail timetable API is in use, and what does a journey time query look like? (National Rail Darwin? Transport API? OpenRail?)
2. What API will provide real drive-to-station road times? (Google Maps Distance Matrix, Mapbox Matrix API, OpenRouteService?)
3. Where does train line geometry come from for the map overlay? (OpenStreetMap/Overpass API, Network Rail GIS, GTFS shapes.txt?)
4. Should isochrone polygons be pre-computed and cached (e.g. nightly, stored in R2) or computed live per request?
5. "Just in time" — does this mean the next train within the next 30 minutes, or the absolute next departure regardless of time of day?
6. For the driving leg: do we compute drive time from *any point on the map* to *the nearest station*, or only from a user-specified home address?

## Success criteria

- Enter "King's Cross" + 60 minutes → map renders a plausible shaded region covering commuter towns (Cambridge, Peterborough, Bedford, Grantham, etc.).
- Toggle train layer on/off → stations and lines appear/disappear without reloading the map.
- Clophill, Bedfordshire falls *inside* the 60-minute isochrone for King's Cross (10 min drive + 44 min train = 54 min).
- App loads and responds in under 3 seconds on a standard broadband connection.
