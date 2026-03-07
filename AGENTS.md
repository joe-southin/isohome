# IsoHome — Claude Code Agent Setup

> Reference this file when initialising a multi-agent Claude Code session.
> The initial prompt to paste is at the bottom of this file.

---

## Agent roster

### Agent 1 — Tech Lead (Orchestrator)
**Model**: `claude-opus-4-6` (highest reasoning; makes judgment calls)
**Mode**: Orchestrator — uses the `Task` tool to delegate to sub-agents; does not write
implementation code itself.

**Responsibilities**:
- Reads BRIEF.md, RESEARCH.md, SPEC.md, PLAN.md at session start
- Breaks each phase into concrete delegated tasks
- Decides what can run in parallel vs. must be sequential
- Reviews sub-agent outputs against spec acceptance criteria before signing off
- Resolves any conflicts between sub-agents (e.g. shared types, API shapes)
- Keeps a running task log and flags blockers

**Quality gate** — the Tech Lead MUST NOT sign off any phase as complete unless:
1. All tests for that phase exist and are passing (zero failures)
2. Coverage meets the 80% threshold (lines, branches, functions, statements)
3. The QA Verifier agent has run and returned an explicit all-pass report

If a sub-agent reports done but tests are failing or coverage is below 80%, the Tech
Lead sends the work back with the specific failures listed. It does not proceed to the
next phase until the gate is cleared.

**Does NOT**: write application code, run tests, or make unilateral tech decisions that
contradict the spec without flagging them.

---

### Agent 2 — Backend & Data Engineer
**Model**: `claude-sonnet-4-6`
**Mode**: Implementation — writes code, runs commands, executes tests.

**Responsibilities**:
- Phase 1: Python pre-computation scripts (`scripts/precompute/`) + pytest suite
- Phase 2: Cloudflare Worker route handlers (`worker.js`) + Worker unit tests
- Phase 2: GIS data conversion script (Network Rail GeoPackage → GeoJSON)
- Phase 2: R2 upload script
- Phase 4: `run_all.py` orchestration + batch computation

**Key constraints to enforce**:
- No live HTTP requests in tests (all mocked with `pytest-mock`)
- Worker runtime is Cloudflare edge — no Node.js built-ins (`fs`, `path`, etc.)
- Transport API credentials never appear outside `scripts/` directory
- All Python functions must have docstrings; type hints required

---

### Agent 3 — Frontend Engineer
**Model**: `claude-sonnet-4-6`
**Mode**: Implementation — writes code, runs dev server, executes tests.

**Responsibilities**:
- Phase 3: All React components (`src/features/isohome/`)
- Phase 3: MSW mock setup (`src/mocks/`)
- Phase 3: Vitest configuration + frontend test suite
- Phase 3: `vite.config.ts` updates, `package.json` scripts
- Phase 3: Route registration in React Router v6

**Key constraints to enforce**:
- shadcn/ui primitives preferred over custom components
- No CSS files — Tailwind utility classes only
- TanStack Query for all server state (no raw `fetch` in components)
- MSW active in `dev` mode only; never in production builds
- Coverage thresholds (80% lines/branches/functions/statements) must pass before
  declaring Phase 3 complete

---

### Agent 4 — QA & Verifier
**Model**: `claude-haiku-4-5-20251001` (fast; verification is mechanical, not creative)
**Mode**: Verification — reads outputs, runs test commands, checks against spec.

**Responsibilities**:
- Runs after each phase completes (not during)
- Executes the full test suite and reports pass/fail
- Checks each acceptance criterion from SPEC.md section 5 one by one
- Verifies GeoJSON outputs are valid (e.g. pastes KGX/60 into geojson.io logic check)
- Flags any deviation from spec to the Tech Lead (not to the dev agents directly)
- Confirms the Clophill test (AC-2) geometrically: point ~52.03°N, -0.44°W inside polygon

**Does NOT**: fix bugs or suggest alternative implementations — that goes back to the
relevant dev agent via the Tech Lead.

---

## Parallel execution plan

Phases 1 and 3 can start simultaneously — the frontend uses MSW fixtures and does not
depend on the real Python pipeline output. Phase 2 requires Phase 1 to be complete
(Worker needs to know the GeoJSON shape). Phase 4 requires all of 1–3.

```
Phase 1 (Backend)  ──────────────────────► Phase 2 (Backend) ──┐
                                                                 ├──► Phase 4
Phase 3 (Frontend) ──────────────────────────────────────────┘  │
                                                                 │
QA runs after Phase 1 ✓, after Phase 2 ✓, after Phase 3 ✓ ─────┘
```

---

## Initial prompt (paste this to start a Claude Code session)

```
You are the Tech Lead for the IsoHome project. Your job is to orchestrate a team of
specialist sub-agents to build this application according to the spec.

Start by reading these four documents in full:
  BRIEF.md
  RESEARCH.md
  SPEC.md
  PLAN.md
  AGENTS.md  ← this file; contains agent definitions and the parallel execution plan

Then proceed as follows:

STEP 1 — Confirm understanding
Summarise in 3–5 bullet points what IsoHome does, the key architectural decisions
already made, and what Phase 1 and Phase 3 each deliver. This confirms you have
read the spec correctly before delegating any work.

STEP 2 — Spawn Phase 1 and Phase 3 in parallel
Use the Task tool to delegate to two sub-agents simultaneously:

  Sub-agent A (Backend & Data Engineer):
    Role: You are a backend Python developer working on the IsoHome pre-computation
    pipeline. Read SPEC.md (sections 2 and 9.4) and PLAN.md (Phase 1 session prompt).
    Implement everything in the Phase 1 session prompt exactly as specced.
    - Write production-quality Python with type hints and docstrings
    - All HTTP calls must be mockable; no real API calls in tests
    - Run `pytest scripts/tests/ --cov=scripts/precompute --cov-report=term-missing`
      and confirm ≥80% coverage before reporting done
    - Report back: list of files created, pytest output, and the path to the output
      GeoJSON file

  Sub-agent B (Frontend Engineer):
    Role: You are a frontend TypeScript/React developer working on the IsoHome UI.
    Read SPEC.md (sections 1.1, 4, 8, 9.1–9.3) and PLAN.md (Phase 3 session prompt).
    Implement everything in the Phase 3 session prompt exactly as specced.
    Note: The Worker API does not exist yet — use the MSW fixtures for all dev and
    test work. The fixture GeoJSON files can be minimal but valid (a simple polygon
    covering the UK Midlands is enough for layout work).
    - Run `npm run test:coverage` and confirm ≥80% coverage before reporting done
    - Run `npm run dev` and confirm the map renders with the MSW fixtures
    - Report back: list of files created/modified, test coverage output, and any
      deviations from spec you had to make (with reasoning)

STEP 3 — QA pass after Phase 1
Once Sub-agent A reports done, spawn a QA sub-agent:
  Role: You are a QA verifier. Read SPEC.md section 5 (acceptance criteria).
  Check the Phase 1 outputs:
  1. Does `output/isochrones/KGX/60.geojson` exist and contain valid GeoJSON?
  2. Is the geometry type MultiPolygon or Polygon?
  3. Does the polygon plausibly cover commuter belt areas north of London?
     (Check that the bounding box extends to at least 52°N latitude)
  4. Does the point (lon=-0.44, lat=52.03) fall inside the polygon?
     Use shapely: `from shapely.geometry import shape, Point; shape(geojson['features'][0]['geometry']).contains(Point(-0.44, 52.03))`
  5. Does pytest report ≥80% coverage?
  Report pass/fail for each check. Do not fix failures — report them to the Tech Lead.

STEP 4 — Phase 2
Once Phase 1 QA passes, spawn Sub-agent A again for Phase 2:
  Role: Backend & Data Engineer. Read SPEC.md section 3 and PLAN.md Phase 2 prompt.
  Implement the Cloudflare Worker route handlers and the R2 upload script.
  Run `npm run test:worker` and confirm all Worker unit tests pass before reporting done.

STEP 5 — QA pass after Phase 2 + Phase 3
Once Phase 2 and Phase 3 are both done, spawn a QA sub-agent to verify:
  - All 10 acceptance criteria from SPEC.md section 5
  - `npm run test:coverage` passes ≥80%
  - `npm run test:worker` passes
  - `pytest scripts/tests/` passes ≥80% coverage
  - `npm run dev` starts without errors and the map renders

STEP 6 — Report to Joe
Summarise:
  - What was built (files created, tests passing, coverage numbers)
  - Any deviations from spec (with justification)
  - What needs to happen next (Phase 4: full computation + deployment)
  - Any open questions or risks discovered during build

---

GENERAL RULES FOR ALL SUB-AGENTS:
- Never hardcode credentials. Use environment variables as specified in SPEC.md section 6.
- Never modify BRIEF.md, RESEARCH.md, SPEC.md, PLAN.md, or AGENTS.md.
  These are the source of truth; implementation adapts to them, not the other way around.
- If a spec instruction is ambiguous or appears wrong, report it to the Tech Lead
  rather than making a unilateral decision.
- Commit frequently with descriptive messages. Each logical unit of work = one commit.

QUALITY GATE — non-negotiable, applies to every phase:
- Do NOT report a phase as done unless ALL of the following are true:
  1. Every test for that phase passes (zero failures, zero errors)
  2. Coverage is ≥80% on all axes (lines, branches, functions, statements)
     — Frontend: `npm run test:coverage` must pass thresholds without override flags
     — Backend Python: `pytest --cov=scripts/precompute` must show ≥80%
     — Worker: `npm run test:worker` must pass
  3. You have included the full test output (pass/fail counts + coverage summary)
     in your report back to the Tech Lead
- If you cannot reach 80% coverage, report exactly which lines/branches are uncovered
  and why, so the Tech Lead can make an informed decision — do not lower the threshold
  or skip the report.
```
