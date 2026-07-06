import * as THREE from 'three';
import { EffectComposer } from '../../lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../lib/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../lib/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../../lib/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from '../../lib/jsm/shaders/CopyShader.js';
import { createRelativisticPass, SOURCE_FOV, CUBEMAP_ABERRATION, CUBE_FACE_SIZE } from './relativisticPass.js';

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
  // In cube mode the base RenderPass renders through the DISPLAY (60°) camera:
  // the relativistic pass replaces every pixel by cube-sampling, and a plain
  // 60° base means even if the pass were bypassed we get correct framing, never
  // a 90° stretch (ГРАБЛИ #2). In the default extended-FOV path it renders the
  // wide sourceCamera as before (main.js swaps to `camera` when relFx is off).
  const renderPass = new RenderPass(scene, CUBEMAP_ABERRATION ? camera : sourceCamera);
  composer.addPass(renderPass);
  // Relativistic aberration + Doppler, BEFORE bloom so blueshifted/beamed
  // bright stars ahead also pick up the glow.
  const relativistic = createRelativisticPass(window.innerWidth, window.innerHeight, CUBEMAP_ABERRATION);
  composer.addPass(relativistic);
  // Cube path resources: a resolution-independent 6-face render target + a
  // CubeCamera at the floating origin (= the ship). Rendered each frame by
  // main.js ONLY when relFx is on. Left null in the default extended-FOV path.
  let cubeCamera = null, cubeRT = null;
  if (CUBEMAP_ABERRATION) {
    cubeRT = new THREE.WebGLCubeRenderTarget(CUBE_FACE_SIZE, { type: THREE.HalfFloatType });
    cubeCamera = new THREE.CubeCamera(0.05, 1e14, cubeRT);   // matches display near/far
    cubeCamera.position.set(0, 0, 0);                        // floating origin
    relativistic.uniforms.uCube.value = cubeRT.texture;      // stable ref, set once
  }
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
  // contract) so handleResize below can keep sourceCamera's aspect in sync
  // without needing its own signature change. renderPass is stashed the same
  // way so main.js can swap its camera between sourceCamera (relFx on, wide
  // FOV for aberration headroom) and the display camera (relFx off, correct
  // 60° framing) whenever the relativistic pass is toggled.
  composer.sourceCamera = sourceCamera;
  composer.renderPass = renderPass;
  // main.js checks composer.cubeCamera truthiness to pick the render path.
  composer.cubeCamera = cubeCamera;
  composer.cubeRT = cubeRT;
  return { composer, bloom, relativistic };
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
