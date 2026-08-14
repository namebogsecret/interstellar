# Interstellar — Relativistic Solar-System Flight (first person)

A browser/WebGL first-person spaceflight simulator of the **real** solar system:
true relative sizes of the Sun, planets and major moons, real NASA-derived
textures, Keplerian orbital motion, axial rotation, full N-body gravity on the
ship, atmospheric drag, and **special-relativistic** flight — time dilation,
the Lorentz factor, and a hard light-speed ceiling all computed live.

Built to run on modest hardware (no GPU required — works under software WebGL)
and with **no build step / no npm**: it's plain ES-module JavaScript + a vendored
copy of Three.js.

**Language:** English / Русский — toggle (EN · RU) top-centre of the screen, or
on the start card. The whole UI, the briefing, planet names and units all switch
live; your choice is remembered. There's a plain-language "how to fly" briefing
on launch (re-open anytime with **H**) written for people who've never flown.

## Run

```bash
~/interstellar/run.sh          # serves on :8123 and opens Firefox
# or pick a port:  ~/interstellar/run.sh 8200
```

(ES modules can't load over `file://`, so a tiny local web server is used.)

## Controls

| Input | Action |
|---|---|
| **Click** | capture mouse (pointer lock) |
| **Mouse** | pitch / yaw |
| **X** | **STOP** — cancel drift (match the body you're near) + stop rotation |
| **Q / E** | roll |
| **H** | show the briefing / help again |
| **W A S D** | thrust forward / strafe |
| **R / F** | thrust up / down · **Space** forward boost |
| **0–9** | set throttle (0 %–100 %) · **Shift/Ctrl** trim throttle |
| **Tab / Shift-Tab** | cycle target body |
| **G** | fast-travel next to the current target (convenience) |
| **, / .** | time-speed down / up (×5 steps, 1× … ~5×10⁷×) |
| **M** | toggle fuel model (arcade ↔ realistic) |
| **O / L / B** | toggle orbit lines / labels / bloom glow |
| **C** | toggle relativistic optics (aberration + Doppler) |
| **U** | toggle cubemap aberration (full-sphere relativistic view, no frame-edge clamp) — off by default, costs ~6–7× the frame's geometry; auto-disables itself on a slow machine |
| **N** | **autopilot** — fly a Newtonian orbit-insertion burn for you (circularize at your current radius) · **Shift+N** — Hohmann transfer to your target's orbit radius. Touching the flight controls cancels it; **N** again cancels it yourself. |
| **I** | toggle cockpit frame (a simple procedural cabin — struts, dashboard) — off by default; may auto-simplify on a slow machine |
| **Z** | toggle engine/impact sound (procedural, no audio files) — off by default |
| **⌫ Backspace** | reset to Earth |

**On a phone / tablet** (touch screens) an on-screen layout appears automatically:
a left thumb-stick (move), drag-anywhere to look, and right-hand buttons for
up/down thrust, **STOP**, target, fast-travel, time-speed and help.

## How flying works (read this first)

This is a **Newtonian** spaceflight model, like real spacecraft — *not* a plane.

- You **start in a stable orbit around Earth**, so you won't just fall.
- Thrust (**W**) speeds you up; you then **coast forever** until you thrust the
  other way. To slow down, turn 180° and burn — or just press **X** to cancel
  your drift (it matches the velocity of whatever planet/moon you're near).
- Gravity is real: get slow and close to a planet and you'll fall toward it.

**Landing & crashing aren't game-over.** Touch a surface slowly (< 50 m/s
relative to the ground) and you **land**; faster and you **crash** — but either
way you just sit on the surface, and pressing **W / Space** **lifts you off
again**. Press **⌫** to reset to Earth orbit anytime.

## Two flight models (press **M**)

- **Arcade — infinite fuel.** Set any proper acceleration (up to ~1000 g).
  Burn as long as you like; you'll approach but never reach *c*.
- **Realistic — finite propellant.** A fusion-class engine (exhaust velocity
  10 % *c*, ~30 MN thrust). The ship loses mass as it burns, so the
  (relativistic) Tsiolkovsky rocket equation emerges naturally — the HUD shows
  remaining propellant and Δv budget.

In both models the HUD shows your speed (incl. %c), Lorentz **γ**, the live
time-dilation ratio, the felt g-load, the dominant gravity body, your altitude,
and the local atmospheric density.

## Knowing what's going on (the clarity layer)

- **Body labels** float next to each Sun/planet/moon with its live distance;
  the current target is highlighted in amber.
- **Target reticle** rings the selected body; when it's off-screen or behind
  you, an **edge arrow** points the way. **Tab** cycles targets.
- **Prograde / retrograde markers** (green ⊕ / blue ⊗) show which way you're
  actually moving vs. where you're pointing.
- **Orbit lines** draw every planet's and moon's real ellipse so the layout of
  the system is legible at a glance (toggle **O**).
- **Time speed auto-slows near a body.** As you approach (or close in fast on)
  a planet/moon, the maximum time-speed drops smoothly with proximity, so you
  never warp straight through a world. You keep full control up to that moving
  ceiling, and it climbs back automatically as you pull away — the HUD shows the
  effective speed, a ⤵, and the speed you asked for. Steps are ×5 for fine
  control.
- A live **status line** names what you're doing right now — *COASTING*,
  *BURNING · N g*, *ATMOSPHERIC FLIGHT*, plus a note when time-warp is being
  held at 1× for a burn or close approach — and a transient **event log**
  announces things like entering an atmosphere or switching flight model.

## Autopilot (press N / Shift+N)

A genuine closed-loop guidance system, not a scripted cutscene: every frame it
looks at your actual position and velocity and re-aims a real thrust vector at
the orbit it's trying to reach — the same `throttle` + thrust-direction
controls you'd use yourself, checked against the same orbit maths the HUD
already uses.

- **N** — circularize at your current radius.
- **Shift+N** — Hohmann transfer to your current target's orbit radius (pick
  a target with **Tab**, e.g. the Moon, then Shift+N from Earth orbit).

The HUD's AUTOPILOT line tracks it: waiting for the right point in the orbit
to burn, burning with a live Δv countdown, a trim pass or two to tighten up,
or why it stopped. Touching the flight controls (thrust, roll, look, reset,
throttle, **K**, **X**) cancels it immediately — opening a panel, changing
time-speed, or pausing does not. Press **N** again any time to call it off
yourself.

### What it won't do

Said plainly, so it doesn't over-promise:

- **Relativistic speeds** (β > 1%, roughly 3,000 km/s) — refuses; the
  guidance law is Newtonian and stops being honest above that.
- **Inside an atmosphere, or below a body's safe altitude** — refuses; it
  doesn't fly through air.
- **Landed or crashed** — refuses; it won't take off for you.
- **Strong multi-body regions** — needs the reference body to out-pull
  everything else by 10× to engage, 5× to keep going; a real three-body tug
  ends the manoeuvre with an honest failure, not a silently wrong answer.
- **An escaping (unbound) starting orbit**, for a transfer — you need to be
  captured first.
- **A target radius under the destination's safe altitude, or not a real
  number** — refuses rather than aiming at nonsense.
- **Not enough propellant** in realistic mode (it wants a 10% margin over its
  own Δv estimate), or no engine at all — refuses up front, or gives up
  honestly mid-burn if the tank runs dry.
- **Plane changes and rendezvous** — it only changes speed within your
  *current* orbital plane, and it targets a radius, not a meeting with a
  moving body; no inclination changes, no phasing.
- **Aerobraking, gravity assists, multi-burn or low-thrust spiral
  transfers** — every manoeuvre is one clean impulsive burn (plus a couple of
  automatic trim passes).
- If it can't converge within its own budget of trim passes or time, it
  stops and says so instead of burning forever.

## Cockpit view (press I)

A simple procedural cabin frame — angled A-pillars, a raked dashboard, lit
trim rails — drawn around the edges of the view so first-person flight feels
like sitting in something instead of a bare camera floating through space.
It's cosmetic geometry only: drawn after everything else, co-moving with the
ship, and it never touches the physics or the relativistic optics in the
centre of the screen. Off by default; auto-simplifies (and can turn itself
off) on a slow machine.

## Sound (press Z)

Procedural engine hum and hull-borne impact/click sounds, synthesized live
with the Web Audio API — no audio files. The framing is deliberate: you're
hearing the *inside of a pressurized hull*, the way a submarine crew hears
their own engines and nothing of the ocean. Concretely that means no sound
from anything outside the ship, no Doppler shift ever (the engine is rigidly
attached to you, so its pitch never tracks your speed, however fast you're
going), and the hum mutes itself honestly during time-warp and while paused
rather than lying about what it would sound like. Off by default; needs a
real click or keypress before the browser will let audio start, per the
usual autoplay rules.

## Looking good (the visual layer)

ACES filmic tone mapping, a layered Sun corona with **UnrealBloom** glow,
**Fresnel atmosphere** shells (limb-brightened air glow), drifting clouds on
Earth, Saturn's textured rings, and a Milky-Way background plus 6 000 coloured
procedural stars. Bloom **auto-disables if the frame-rate drops** (and can be
forced back on with **B**), so the eye-candy never costs you playability on a
weak GPU.

**Relativistic optics** (toggle **C**) — at speed the view is transformed by
special-relativistic **aberration** (the forward sky bunches toward your
direction of travel), **Doppler** colour-shift (blueshift ahead, redshift
behind) and **beaming** (the forward field brightens). It uses the exact SR
formulae in a screen-space pass and eases in only above ~0.003 c, so ordinary
orbital flight is untouched — then blooms dramatically as you burn toward *c*.

## What's physically real

- **Sizes & distances** — true to scale (e.g. the Sun is 109× Earth's radius;
  Neptune sits at 30 AU). Handled with a *floating-origin* renderer + a
  logarithmic depth buffer so metre-scale cockpit detail and trillion-metre
  distances coexist without z-fighting or precision loss.
- **Orbits** — analytic Kepler propagation (real *a, e, i*, periods); planets
  and moons ride exact rails and are not perturbed (cheap and stable).
- **Rotation** — real sidereal spin periods and axial tilts (Venus & Uranus
  spin retrograde; Uranus lies on its side).
- **Gravity** — every massive body pulls the ship (Newtonian point masses,
  clamped at the surface). The dominant source becomes your "reference body".
- **Relativity** — integrated in specific-momentum form `w = γv`, so
  `γ = √(1+|w|²/c²)`, `v = w/γ`, `dτ = dt/γ`. Verified numerically: a sustained
  ~1000 g burn yields γ≈13 at 0.997 c with the ship clock lagging 4× — exactly
  the analytic result.
- **Atmosphere** — exponential-density drag model (per-planet scale height &
  surface density) that switches on when you dip into a planet's atmosphere.
  This is the groundwork for the planned **landing** mode.

> Note: gravity is Newtonian (no general relativity / frame-dragging), and
> bodies don't perturb each other — appropriate simplifications for a real-time
> sim. The *kinematics* of motion near light speed are fully special-relativistic.

## Known limitations

- **Transverse thrust** — the sim models the honest relativistic 4-force: a
  commanded felt acceleration applied perpendicular to your velocity produces
  `dw/dt` reduced by a further factor of γ versus the longitudinal case.
  Longitudinal thrust is exact throughout (the verified 1000 g → γ≈13 burn
  above is unaffected).
- **Aberration** (toggle **C**) is rendered by reprojecting a wider-FOV (90°)
  source image; at high β a forward pixel can map beyond that source frustum
  and gets clamped, showing as a mild smear near the forward rim. Full
  forward-hemisphere aberration would need a cubemap source — noted as future
  work rather than solved here.

## Because the distances are real…

…planets are genuinely tiny specks across interplanetary space. Two aids keep it
playable without faking the scale:
- sub-pixel bodies are drawn as star-like **point markers** so you can find them;
- **Tab** to pick a target, then **G** to fast-travel beside it (a deliberate
  convenience teleport — turn it off in `controls.js` for purist play).

To actually *fly* there relativistically: aim at the target, throttle up, and
watch γ climb and your ship clock fall behind. At a steady 1 g, the inner system
is hours of ship-time; the outer planets, days.

## Project layout

```
index.html              # shell + HUD + import map (three -> lib/)
run.sh                  # serve + open browser
css/style.css           # HUD styling
lib/three.module.js     # vendored Three.js r160
assets/textures/        # CC-BY 4.0 planet/Sun/ring/Milky-Way maps (Solar System Scope)
js/
  main.js               # bootstrap, time-warp substepping, floating-origin loop
  data/bodies.js        # REAL astronomical data (radii, GM, orbital elements)
  physics/
    constants.js        # c, G, AU, …
    orbits.js           # Kepler propagation + spin
    gravity.js          # N-body accel + dominant body
    relativity.js       # γ, velocity↔momentum, Doppler, Tsiolkovsky
    ship.js             # ship state, two fuel models, drag, integrator
  render/
    scene.js            # renderer (log-depth), camera, lights, starfield, composer
    bodies.js           # meshes, textures, clouds, atmospheres, rings, markers
    controls.js         # pointer-lock 6-DOF flight controls (keyboard + mouse)
    touch.js            # on-screen joystick + buttons for phones/tablets
    relativisticPass.js # SR aberration + Doppler + beaming post-process
    cockpit.js          # procedural cabin frame overlay (key I, off by default)
    hud.js              # HUD readouts
  audio/
    soundPolicy.js      # pure sound-parameter policy (no Web Audio/DOM)
    audio.js            # thin Web Audio layer (procedural synthesis, key Z)
```

## Tuning for weaker / stronger machines

- Lower `renderer.setPixelRatio` cap in `render/scene.js`.
- Reduce sphere segment counts in `render/bodies.js` (`seg`).
- Swap the 2K textures in `assets/textures/` for 1K (re-download from
  solarsystemscope.com) to cut memory/VRAM.

## Roadmap (designed-for)

- **Landing**: terrain collision + surface frame + touchdown detection (the
  atmosphere/altitude/reference-body plumbing is already in place).

## Credits

Textures © [Solar System Scope](https://www.solarsystemscope.com/textures/),
CC-BY 4.0. Rendering by [Three.js](https://threejs.org) (MIT).
