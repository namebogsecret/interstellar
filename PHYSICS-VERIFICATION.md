# PHYSICS-VERIFICATION — how the physics in this sim is checked

This document describes the test suite that runs against every physics/render
change in this repository — what it checks, against which reference formula,
and to what tolerance. It is written for anyone who wants to know *why they
should believe* the numbers this simulator shows, not as marketing copy: where
a tolerance is wide, or a check is really an engineering/code-contract guard
rather than a from-scratch physics derivation, that is stated plainly below.

Nothing here is aspirational. Every row in every table maps to a real,
currently-passing file under `tests/`. If a check isn't listed here, it isn't
part of the gate.

## Reproduce it yourself

```bash
bash tests/run.sh
```

Runs every `tests/*.test.mjs` file under Node (`tests/three-loader.mjs`
resolves the vendored Three.js import), bare `assert`, no framework, no
build step. Prints `PHYSICS GATE: PASS` and exits 0 only if every file's
assertions hold; a single failing assertion throws and fails the whole run
(exit 1). At the time of writing this is **39 files**, ~2 seconds.

Separately, `tests/smoke_playwright.py` drives a real browser (Playwright)
and catches frame-loop crashes the Node tests can't see — it self-contains
its own local server. It is a crash/console-error smoke check, not a physics
check, and is not covered by the tables below.

## The machine-readable gate: `physics-gate.yaml`

`physics-gate.yaml` at the repo root is a valid YAML document that formalizes
**4** of the invariants below as individually-runnable entries — own command,
own tolerance, own exit code — rather than lines inside the combined
`tests/run.sh` output. It documents the commands for a human or agent to run
by hand; the file itself is **not** wired into any CI runner (no
`.github/workflows` exist, and `tests/run.sh` does not read it), so
reproduction is manual, not automated. These are the four the project treats
as the load-bearing physical claims of the simulator:

| Invariant | Test file | What it locks | Reference | Tolerance |
|---|---|---|---|---|
| INV-PHYS-01 | `longitudinal.regression.test.mjs` | Longitudinal 4-force is **not** divided by γ: sustained 1000 g proper acceleration reproduces the analytic relativistic rocket | γ(t) = √(1+(αt/c)²) | 2% |
| INV-PHYS-03 | `orbits.test.mjs` | Orbit elements (a, e, rPeri, rApo) computed from a state (r,v) via `circularizeVelocity`/`orbitFromState`; actual conservation of angular momentum under propagation is checked separately in `propagator.conservation.test.mjs` (not one of these 4 formalized INV-ids) | v² = μ(2/r − 1/a) | 1e-3 |
| INV-PHYS-06 | `gravity.test.mjs` | Gravitational potential's sign and monotonicity (no numeric reference comparison); weak-field time-dilation factor converges to 1 as r → ∞ | Φ = −μ/r (sign/monotonicity check, not a numeric comparison) | dτ-factor→1: 1e-12 abs (this tolerance is on the dτ factor, not on Φ itself) |
| INV-PHYS-09 | `relativity.test.mjs` | Relativistic aberration: exact formula, round-trip with its own inverse, monotonicity | aberratedCos(cp,β) = (cp−β)/(1−β·cp) | 1e-9 |

**On the 2% tolerance (INV-PHYS-01):** that is not a rounding margin picked
for convenience — it is the tolerance the test itself asserts at γ≈13 after
a 1000g burn, and the file is marked `NEVER DELETE, NEVER WEAKEN` in its own
header: if a future 4-force refactor ever divides the longitudinal thrust
term by γ, this is the test that is supposed to go red.

A number of other test files carry their own in-code `INV-PHYS-NN` labels
(04, 05, 07, 10, 11, 12 — see the tables below) that are **not yet wired into
`physics-gate.yaml`**; they run as part of `tests/run.sh` but don't have an
individual entry with their own exit code. That is a real gap, not an
oversight being hidden here.

## Full gate, by topic

### A — Special relativity

| File | Checks | Reference | Tolerance |
|---|---|---|---|
| `relativity.test.mjs` | Aberration formula, round-trip, monotonicity (INV-PHYS-09) | aberratedCos(cp,β) = (cp−β)/(1−β·cp) | 1e-9 |
| `longitudinal.regression.test.mjs` | γ(t) under constant 1000g proper acceleration, longitudinal 4-force undivided by γ (INV-PHYS-01, **NEVER DELETE/WEAKEN**) | γ(t) = √(1+(αt/c)²) | 2% |
| `gravity.relativistic.test.mjs` | **(a) Transverse** coordinate-acceleration factor — actually gated: hard guard `ratio > 1.5` plus a 3% tolerance against `(1+β²)` at β=0.99 (internally labeled INV-PHYS-10, not yet in `physics-gate.yaml`). **(b) Longitudinal** factor `(1−3β²)` — implemented in `js/physics/ship.js`, but only printed via `console.log` inside a `try/catch`; it is **not asserted** by the gate at all | a⊥ = (1+β²)·g⊥ · a∥ = (1−3β²)·g∥ (both at β=0.99 for (a); β=0.5 for the (b) diagnostic) | (a) hard guard ratio>1.5 + 3% rel · (b) none — diagnostic only |

The `(1−3β²)` longitudinal factor is a fixed, deliberate decision by the
project owner about the physics engine itself — an internal decision, not
something independently verifiable from a source inside this repo, and not
something this document is proposing to revisit. What's inaccurate is
describing it as *gate coverage*: there is currently no automated regression
assertion on the longitudinal term, only the diagnostic `console.log` above.
That is a known, stated gap, not a hidden one — see the honest-gap list
above and (b) in the row directly above.

### B — Orbital mechanics / Kepler

| File | Checks | Reference | Tolerance |
|---|---|---|---|
| `orbits.test.mjs` | Kepler elements (a, e, rPeri, rApo) from a state (r,v) via `circularizeVelocity`/`orbitFromState` (INV-PHYS-03) — does **not** itself assert conservation of angular momentum during propagation; that is checked separately below in `propagator.conservation.test.mjs` | v² = μ(2/r − 1/a) | 1e-3 |
| `orbits.classify.test.mjs` | bound/unbound classification uses specific orbital energy, **not** `e ≥ 1` (ADR-8) | eps = v²/2 − μ/r < 0 | exact identity (not a numeric tolerance) |
| `orbits.guards.test.mjs` | Degenerate inputs (r→0, exact parabola e=1) stay finite, don't regress well-posed cases | — | finiteness only |
| `orbits.radial.test.mjs` | Near-radial trajectories: `bound` field agrees with `Number.isFinite(rApo)` | — | exact identity |
| `propagator.conservation.test.mjs` | Universal-variable Kepler propagator conserves specific energy ε and angular-momentum vector h, plus the f/g Wronskian | f·ġ − ḟ·g = 1 | ε: 1e-8 rel · h: 1e-8 rel · Wronskian: 1e-9 abs |
| `propagator.parabolic.test.mjs` | Propagator at e≈1 (parabolic) and e>1 (hyperbolic) matches Barker's closed-form equation | Barker's equation | 1e-6 rel (radius) |
| `propagator.roundtrip.test.mjs` | propagate(+Δt) ∘ propagate(−Δt) ≈ identity, across circular/eccentric/parabolic/hyperbolic conics | — | round-trip identity |
| `propagator.vs.numeric.test.mjs` | Analytic propagator step vs a real RK4 integration reference | RK4 reference | circular: 1e-9 rel · eccentric: 1e-4 rel (reference-limited) |
| `cabotage.predicate.test.mjs` | Analytic↔numeric engagement predicate (6 clauses) + boundary look-ahead | — | exact predicate logic |
| `cabotage.continuity.test.mjs` | γ(w) ≈ γ(v) continuous across an integrator↔analytic hand-off (no reattach jump) | — | 1e-12 |
| `cabotage.periapsis.test.mjs` | Regression: no periapsis overshoot on hand-off (**NEVER DELETE/WEAKEN**) | — | regression corpus |
| `cabotage.dtau.test.mjs` | Analytic proper-time integral (dτ) over an analytic coast matches a converged fine-step numeric reference | dτ = dt/γ integrated over the coast | 1e-6 rel |

### C — Gravity

| File | Checks | Reference | Tolerance |
|---|---|---|---|
| `gravity.test.mjs` | Gravitational potential's sign (negative) and monotonicity (decreasing with r) — no numeric comparison against a reference value; weak-field dτ factor converges to 1 at large r (INV-PHYS-06) | Φ = −μ/r (sign/monotonicity only) | dτ-factor→1: 1e-12 abs (not a tolerance on Φ) |
| `gravity.relativistic.test.mjs` | see table A above | a = (1+β²)g⊥ + (1−3β²)g∥ | guard: ratio > 1.5 |

### D — Autopilot (orbital-manoeuvre guidance)

| File | Checks | Reference | Tolerance |
|---|---|---|---|
| `autopilot.circular.test.mjs` | Closed-loop circularization burn converges to the target radius | a ≈ target r, e < 1e-3 | a: 1e-3–2e-3 rel · e: 1e-3 |
| `autopilot.hohmann.test.mjs` | Hohmann transfer converges to the target orbit radius | — | final a within 5e-3 rel of target, e < 2e-3 (5e-3 for the Earth–Moon case) |
| `autopilot.integrator.test.mjs` | Same manoeuvres, but driven through the real `Ship.step` integrator, not an idealized bench | — | same order as above |
| `autopilot.refuse.test.mjs` | Refusal gate returns the correct reason code: relativistic speed, landed/crashed, in atmosphere, unbound starting orbit, insufficient propellant, multi-body domination, sub-safe-altitude target | — | exact reason-code match |
| `autopilot.cancel.test.mjs` | Manoeuvre cancellation via a single monotonic `inputSeq` counter (ADR-7) | — | exact condition |
| `autopilot.invariants.test.mjs` | 500 pseudo-random states: determinism (same input → same output) and totality (every state produces a decision) | — | exact, no tolerance |
| `autopilot.repair.test.mjs` | Regression corpus: 4 defects found by adversarial review that the previously-green gate missed | — | regression corpus |

### E — Epoch / time

| File | Checks | Reference | Tolerance |
|---|---|---|---|
| `epoch.test.mjs` | J2000 mean-anomaly helper — pure function, no assertions on live (date-dependent) body state | — | fixed timestamps |
| `epoch.tt.test.mjs` | J2000.0 epoch constant equals true Terrestrial Time, not the UTC clock value (ADR-4) | J2000.0 = 2000-01-01 12:00:00 TT = 12:00:00 UTC − 64.184s | exact constant |

### F — Engineering structural guards (**not** physical-law checks)

These files exist to keep the *code* honest — layering, single-source-of-truth,
UI/UX policy, i18n, sound framing — not to verify a physics formula against a
textbook reference. Several of them do operate on physically-meaningful
quantities (impact speed, throttle-to-acceleration mapping, fuel/4-force
bookkeeping); where that's the case it's called out explicitly rather than
folded silently into the physics tables above.

| File | Checks |
|---|---|
| `structure.test.mjs` | Static-source-text fitness functions (ТЗ §9) — greps the source for forbidden duplicate-condition patterns; not a runtime behaviour test at all |
| `renderpath.test.mjs` | `resolveRenderPath` truth table (plain/wide/cube render path selection) |
| `cubepolicy.test.mjs` | `cubeAutoStep` auto-demotion policy for the cubemap render path |
| `cubetoggle.test.mjs` | Cube-toggle wiring between `main.js`'s frame loop and `renderPolicy.js` |
| `cockpitpolicy.test.mjs` | `cockpitDetail` LOD policy for the cockpit overlay |
| `orientation.test.mjs` | A body's spin orientation is set as **one** quaternion, not two independently-set Euler components on the same `Object3D` (internal ТЗ item "A6") |
| `soundpolicy.test.mjs` | Engine/impact/UI-click sound decision policy: honest mute conditions, no Doppler (ADR-11, ADR-12) |
| `i18n.storage.test.mjs` | `localStorage` access resilience when storage is entirely inaccessible (private browsing) |
| `controls.throttle.test.mjs` | Throttle-digit-to-felt-acceleration log-ladder calibration is mode-aware and honestly clamped (internally labeled INV-PHYS-11) — *physics-adjacent: this is a UX calibration contract, not a derivation of a physical law* |
| `touchdown.impact.test.mjs` | Impact speed is measured against the **actual** co-rotating ground velocity (body velocity + ω×r), not just body velocity (internally labeled INV-PHYS-12) — *physics-adjacent: the invariant under test is "which reference frame", not a new formula* |
| `ship.refpair.test.mjs` | Atomicity of the `(refBody, refBodyVel)` pair fed into `Ship.step()` within one frame |
| `ship.test.mjs` | Fuel/dτ bookkeeping, transverse 4-force, drag-vs-rest-frame contract — *physics-adjacent: exercises the same formulas as the A/C tables, but as a code contract ("does the function honor its signature"), not an independent from-scratch derivation* |
| `missions.test.mjs` | Student-mission pure predicates: Mars circular-orbit check, Moon landing check, Jupiter-flyby arming state machine |
| `missions.hyperbolic.test.mjs` | Regression: Jupiter-flyby arming threshold uses the canonical bound/unbound classifier, not the ULP-unsafe `e ≥ 1` check (ADR-8) |

## Relevant ADRs

The append-only decision log `ADR.md` documents several of the decisions the
tests above lock in place. Numbers below are the actual `ADR.md` entries —
not the internal `ТЗ` item labels used inside some test-file comments (e.g.
`orientation.test.mjs`'s "A6"), which are a separate numbering scheme and are
not cited here as ADR numbers to avoid conflating the two.

- **ADR-4** — J2000.0 epoch is true Terrestrial Time (TT), not UTC.
- **ADR-7** — Autopilot cancellation is one monotonic counter, one condition, one reader.
- **ADR-8** — bound/unbound classification is by specific orbital energy, everywhere in the project (autopilot, orbit HUD, mission arming), never by `e ≥ 1`.
- **ADR-11** — Sound is framed as "heard from inside the hull": no external events are ever audible, and Doppler is prohibited outright.
- **ADR-12** — `AudioContext` is created lazily, strictly on a real user gesture; sound is off by default.

## What this gate does not claim

- It does not model general relativity (no frame-dragging, no curved-spacetime
  geodesics beyond the weak-field approximation in table A/C) — Newtonian
  gravity plus special-relativistic kinematics, by design (see `README.md`,
  "What's physically real").
- Bodies don't perturb each other's orbits (each rides an unperturbed Kepler
  ellipse) — a stated simplification, not a bug.
- Transverse thrust is reduced by an extra factor of γ relative to
  longitudinal thrust — the honest relativistic 4-force result, documented as
  a known limitation in `README.md`, not something this gate hides.
- A green `tests/run.sh` is a **regression gate**, not a proof of absolute
  correctness: it proves the code still agrees with the reference formulas
  and tolerances above. Any formula this document doesn't list has no
  automated check.
