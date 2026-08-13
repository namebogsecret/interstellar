import * as THREE from 'three';
import { EffectComposer } from '../../lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../lib/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../lib/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../../lib/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from '../../lib/jsm/shaders/CopyShader.js';
import { createRelativisticPass, SOURCE_FOV, CUBE_FACE_SIZE } from './relativisticPass.js';
import { resolveRenderPath } from './renderPolicy.js';

// Renderer tuned for weak hardware: log depth buffer (essential for the
// metre-to-trillion-metre range), capped pixel ratio, filmic tone mapping for
// a much nicer response to the bright Sun and lit planet faces.
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

export function createScene(textureLoader, milkyWayUrl) {
  const scene = new THREE.Scene();

  // Deep-space starfield: equirectangular Milky Way at infinity (cheap) …
  textureLoader.load(milkyWayUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
    scene.backgroundIntensity = 0.6;
  });

  // … plus crisp procedural stars (varied size + colour) for depth/sparkle.
  const stars = makeStarfield(6000);
  scene.add(stars);

  // Faint fill so the night sides of bodies aren't pure black.
  scene.add(new THREE.AmbientLight(0x223344, 0.05));

  // The Sun is the only real light source.
  const sunLight = new THREE.PointLight(0xfff4e2, 3.2, 0, 0.0); // no distance falloff
  scene.add(sunLight);

  return { scene, sunLight, stars };
}

// A sphere of points at "infinity" (centred on the origin = the camera, since
// the renderer uses a floating origin). Translating never moves them; only
// rotation does — exactly how a real sky behaves.
function makeStarfield(count) {
  const R = 9e12;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Uniform on a sphere.
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
    const x = Math.sin(phi) * Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
    pos[i * 3] = x * R; pos[i * 3 + 1] = y * R; pos[i * 3 + 2] = z * R;
    // Stellar colours: mostly white, some blue/orange, a few red.
    const t = Math.random();
    const hue = t < 0.6 ? 0.6 : t < 0.85 ? 0.08 : 0.0;
    const sat = t < 0.6 ? 0.05 : 0.35;
    c.setHSL(hue, sat, 0.6 + Math.random() * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// Near plane is tiny (cockpit scale); far plane spans the solar system. The log
// depth buffer keeps z-fighting away across that range.
export function createCamera() {
  return new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 1e14);
}

// Selective bloom for the Sun / bright faces. Half-internal-res keeps it light.
export function createBloom(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  // Source scene is rendered through a WIDER fov than the display camera so
  // that, once the aberration shader's sign is correct, forward-looking
  // display pixels (which map to REST-frame angles wider than the display
  // FOV) have something to sample instead of clamping at the screen edge.
  // Parented to the main camera so it inherits its world transform for free —
  // main.js already calls camera.updateMatrixWorld() every frame, which
  // propagates to children with no extra per-frame sync needed here.
  const sourceCamera = new THREE.PerspectiveCamera(SOURCE_FOV, camera.aspect, 0.05, 1e14);
  camera.add(sourceCamera);
  // Base RenderPass always constructs in the SAFE 60°-framed state (display
  // `camera`, not the wide sourceCamera): ground truth for which camera it
  // actually uses each frame is set exclusively by applyRenderPath() below,
  // including on the very first frame, never here (ГРАБЛИ #2).
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Both relativistic passes are created up front — an extra idle ShaderPass
  // is nearly free (its ShaderMaterial doesn't compile until first rendered,
  // and EffectComposer pings between two RTs regardless of pass count; see
  // EffectComposer.render() `continue` on a disabled pass above). Rebuilding
  // composer.passes at runtime is rejected by design: the pass order
  // (relativistic strictly BEFORE bloom, so blueshifted/beamed bright stars
  // ahead also pick up the glow) is a silent invariant that must never be
  // mutated in place. Which of the two is live (Pass defaults to enabled) is
  // decided exclusively by applyRenderPath below, which the caller invokes
  // before the very first render — see its own comment for why that keeps
  // this a single source of truth instead of a second one here.
  const relPass = createRelativisticPass(window.innerWidth, window.innerHeight, false);
  composer.addPass(relPass);
  const cubePass = createRelativisticPass(window.innerWidth, window.innerHeight, true);
  composer.addPass(cubePass);
  // Cube path GPU resources (1024² HalfFloat render target ≈ 50MB VRAM + a
  // CubeCamera at the floating origin) are LAZY — allocated by
  // ensureCubeResources() only when the cube path is actually requested, and
  // freed by releaseCubeResources() the moment it isn't, so weak hardware
  // never pays for them unasked.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.7,   // strength
    0.5,   // radius
    0.85,  // threshold — only genuinely bright pixels bloom
  );
  composer.addPass(bloom);
  // Final copy-to-screen so the last array pass is ALWAYS enabled — lets us
  // toggle bloom/relativistic via `.enabled` without a black screen (the
  // EffectComposer "disabled last pass" gotcha).
  const copy = new ShaderPass(CopyShader);
  composer.addPass(copy);
  // Stashed on the composer (rather than widening this function's return
  // contract) so handleResize below can keep sourceCamera's aspect in sync,
  // and so applyRenderPath/ensureCubeResources/releaseCubeResources below
  // (main.js's only entry points into this wiring) can reach every piece
  // without their own signature changes. cubeCamera/cubeRT start null — see
  // ensureCubeResources.
  composer.sourceCamera = sourceCamera;
  composer.renderPass = renderPass;
  composer.relPass = relPass;
  composer.cubePass = cubePass;
  composer.cubeCamera = null;
  composer.cubeRT = null;
  return { composer, bloom };
}

export function handleResize(renderer, camera, composer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (composer?.sourceCamera) {
      composer.sourceCamera.aspect = camera.aspect;
      composer.sourceCamera.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer?.setSize(window.innerWidth, window.innerHeight);
  });
}

// ── Render-path wiring (js/render/renderPolicy.js owns the pure decision) ──
//
// applyRenderPath is the SINGLE place in the codebase that assigns the base
// render pass's camera and toggles which relativistic pass is live (see the
// structural fitness-function grep in this repo's dev-gate — ГРАБЛИ #2: two
// independent "which camera/pass is live" decisions is exactly how the FOV
// regression happened before). Callers (main.js) never assign those fields
// directly; only the three statements in the function body below do.
export function applyRenderPath(composer, camera, flags) {
  const r = resolveRenderPath(flags);
  composer.relPass.enabled = r.relEnabled;
  composer.cubePass.enabled = r.cubeEnabled;
  composer.renderPass.camera = r.useSourceCamera ? composer.sourceCamera : camera;
  return r.path;
}

// Lazily allocates the cube path's GPU resources (1024² HalfFloat render
// target + CubeCamera) and wires them into composer.cubePass. Idempotent —
// safe to call every frame the cube path is wanted; a second call while
// resources already exist is a no-op that still returns true. Allocation is
// wrapped in try/catch because a ~50MB render-target alloc can fail silently
// on constrained GPUs (no guaranteed exception, sometimes just a lost
// context) — callers must check the return value, not assume success.
export function ensureCubeResources(composer) {
  if (composer.cubeCamera) return true;
  try {
    const cubeRT = new THREE.WebGLCubeRenderTarget(CUBE_FACE_SIZE, { type: THREE.HalfFloatType });
    const cubeCamera = new THREE.CubeCamera(0.05, 1e14, cubeRT);   // matches display near/far
    cubeCamera.position.set(0, 0, 0);                              // floating origin
    composer.cubePass.uniforms.uCube.value = cubeRT.texture;
    composer.cubeRT = cubeRT;
    composer.cubeCamera = cubeCamera;
    return true;
  } catch {
    return false;
  }
}

// Idempotent inverse of ensureCubeResources — frees the render target and
// drops the references so a weak-hardware demotion (or the user turning the
// toggle back off) actually gives the VRAM back rather than leaking it.
export function releaseCubeResources(composer) {
  if (!composer.cubeCamera) return;
  composer.cubeRT?.dispose();
  composer.cubeRT = null;
  composer.cubeCamera = null;
  composer.cubePass.uniforms.uCube.value = null;
}
