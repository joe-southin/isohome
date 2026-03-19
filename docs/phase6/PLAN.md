# Plan: IsoHome Phase 6 — Index of Deprivation Layer + Compact Layer Panel

> Each session prompt below is self-contained. Start a new Claude session, paste the
> prompt, and implement. Complete Phase 6A before starting 6B.

---

## Phase overview

```
Phase 6A: Data pipeline + type extension + Worker endpoint + mock
Phase 6B: UI redesign (compact inline layer rows)
Phase 6C: Frontend wiring + end-to-end verification
```

Phases 6A and 6B are **independent** and can be run in parallel in separate sessions.
Phase 6C depends on both completing.

---

## Phase 6A — Data pipeline, Worker, mock

**Goal**: Produce the deprivation GeoJSON, serve it from the Worker, and mock it for
development — everything except the React component changes.

**Deliverables**:
- `scripts/data/generate_deprivation.py` — downloads IoD25 + ONS centroids, outputs GeoJSON
- `scripts/tests/test_generate_deprivation.py` — pytest suite, ≥80% coverage
- `worker/index.ts` — extended with `/api/static/deprivation` route
- `worker/__tests__/` — updated Worker test for the new route
- `src/mocks/fixtures/deprivation.json` — fixture (generated or synthetic)
- `src/mocks/handlers.ts` — deprivation handler added
- `src/features/isohome/types.ts` — `LayerId` union extended

**Acceptance gate**: `pytest scripts/tests/test_generate_deprivation.py --cov=scripts/data/generate_deprivation -v` reports ≥80% coverage and zero failures. `npm run test:worker` passes.

---

### Session prompt — Phase 6A

```
Read docs/phase6/BRIEF.md and docs/phase6/SPEC.md.

Implement Phase 6A: Data pipeline, Worker endpoint, mock.

Goal: Produce the deprivation GeoJSON and wire it into the data path, without
touching any React components.

Deliverables (in order):
1. scripts/data/generate_deprivation.py
   - Follow SPEC §1. Use the ONS LSOA 2021 population-weighted centroids CSV
     (lat/long variant) joined with IoD25 File 1 or File 7 IMD Score column.
   - If live download is flaky: cache files locally under scripts/data/cache/.
   - Print computed mean and stddev before writing output.
   - Write to both src/mocks/fixtures/deprivation.json and
     output/static/deprivation.geojson.

2. scripts/tests/test_generate_deprivation.py
   - Follow SPEC §6.3 test list exactly. Use small in-memory DataFrames as
     fixtures — no network calls in tests.
   - Run: pytest scripts/tests/test_generate_deprivation.py --cov=scripts/data/generate_deprivation -v
   - Must report ≥80% coverage and zero failures before proceeding.

3. src/features/isohome/types.ts
   - Extend LayerId union to include 'deprivation' (SPEC §2).

4. worker/index.ts
   - Add /api/static/deprivation route (SPEC §3).
   - Add corresponding Worker test.

5. src/mocks/handlers.ts + src/mocks/fixtures/deprivation.json
   - Add MSW handler following SPEC §6.2.
   - If generate_deprivation.py produced a real file, use it as the fixture.
     Otherwise generate a synthetic version matching the existing crime.py pattern
     (urban centres score higher = more deprived, rural areas score lower).

Start from: the existing codebase in src/features/isohome/ and scripts/data/.
Refer to scripts/data/generate_crime.py and src/mocks/handlers.ts as templates.
```

---

## Phase 6B — Compact inline layer row UI

**Goal**: Redesign the desirability layer rows in `IsoHomeControls.tsx` to a single
compact line per layer, with the toggle checkbox inline with the label and slider.

**Deliverables**:
- `src/features/isohome/IsoHomeControls.tsx` — layer row layout redesigned
- Existing tests must still pass (no logic changes, purely presentational)

**Acceptance gate**: `npm test` passes. Visual check: each layer is one row with
checkbox → label → slider → weight value, all on the same line.

---

### Session prompt — Phase 6B

```
Read docs/phase6/BRIEF.md and docs/phase6/SPEC.md.

Implement Phase 6B: Compact inline layer row UI redesign.

Goal: Redesign the desirability layer panel in IsoHomeControls.tsx so each layer
occupies a single compact row instead of two rows.

Changes are confined to src/features/isohome/IsoHomeControls.tsx:
- Replace the current two-row layer layout (checkbox+label row, then slider row)
  with the single-row layout described in SPEC §5.3.
- Change wrapper spacing from space-y-3 to space-y-1.5 (SPEC §5.3).
- Preserve all existing functionality: enable/disable toggle, weight slider,
  weight value readout, disabled state when layer is unchecked.
- Follow SPEC §5.4 accessibility notes (aria-label on standalone checkboxes).
- Make NO logic changes. This is a pure layout/class update.

After making changes:
1. Run npm test — all tests must pass.
2. Confirm TypeScript compiles: npm run build (or tsc --noEmit).

Start from: src/features/isohome/IsoHomeControls.tsx (current implementation).
Reference: SPEC §5 for the exact before/after layout and class names.
```

---

## Phase 6C — Frontend wiring + end-to-end verification

**Goal**: Wire the deprivation data into the React page (query + layerWeights +
dataByLayer), verify the heatmap works end-to-end, and run the full test suite.

**Depends on**: Phase 6A (types extended, mock ready) and Phase 6B (UI ready) both complete.

**Deliverables**:
- `src/features/isohome/IsoHomePage.tsx` — deprivation query + layer config + dataByLayer
- Full test suite green: `npm test && npm run test:worker && pytest`
- Update `stats` in the deprivation `LayerWeight` entry with values printed by the script

**Acceptance gate**: All 10 acceptance criteria in SPEC §7 verified.

---

### Session prompt — Phase 6C

```
Read docs/phase6/BRIEF.md and docs/phase6/SPEC.md.

Implement Phase 6C: Wire deprivation data into the React page and verify end-to-end.

Prerequisite: Phase 6A (types.ts extended, mock + handler ready) and Phase 6B
(compact layer UI) are complete.

Changes to src/features/isohome/IsoHomePage.tsx (follow SPEC §4 exactly):
1. Add useQuery for deprivation (§4.1).
2. Add deprivation entry to layerWeights useState initialiser (§4.2).
   - Use stats: { mean: 22.0, stddev: 13.0 } as a starting point.
   - If generate_deprivation.py printed different values, use those instead.
3. Add deprivation: deprivationData to the computeCostField call (§4.3).
4. Update the useMemo guard condition (§4.4).

After wiring:
1. Run npm test — all tests must pass, including any for IsoHomePage.
2. Verify TypeScript compiles cleanly: npm run build.
3. Run the dev server (npm run dev, VITE_USE_MOCKS=true) and confirm:
   - "Deprivation" layer appears in the Desirability Layers panel.
   - Toggling the checkbox enables/disables the layer.
   - Moving the slider updates the heatmap.
   - Layer rows are compact (single line each).
4. Run the full suite: npm test && npm run test:worker && pytest scripts/tests/ -v

If tests reference missing deprivation fixture or handler, fix those first (they
should have been completed in Phase 6A).

Start from: current IsoHomePage.tsx with Phase 6A + 6B changes applied.
```

---

## Rollout checklist (after all phases complete)

- [ ] Run `python -m scripts.data.generate_deprivation` with real IoD25 data
- [ ] Verify output file: `ls -lh output/static/deprivation.geojson` (should be < 3 MB)
- [ ] Update `stats.mean` and `stats.stddev` in `IsoHomePage.tsx` with script output values
- [ ] Upload to R2: `python -m scripts.precompute.upload_to_r2` (or add deprivation to existing upload script)
- [ ] Deploy Worker: `npm run deploy`
- [ ] Visual check on live site: deprivation heatmap visible, Medway scores worse than Surrey
