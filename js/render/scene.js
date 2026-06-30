import * as THREE from 'three';
import { EffectComposer } from '../../lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../lib/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../lib/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../../lib/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from '../../lib/jsm/shaders/CopyShader.js';
import { createRelativisticPass } from './relativisticPass.js';

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
  composer.addPass(new RenderPass(scene, camera));
  // Relativistic aberration + Doppler, BEFORE bloom so blueshifted/beamed
  // bright stars ahead also pick up the glow.
  const relativistic = createRelativisticPass(window.innerWidth, window.innerHeight);
  composer.addPass(relativistic);
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
  return { composer, bloom, relativistic };
}

export function handleResize(renderer, camera, composer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer?.setSize(window.innerWidth, window.innerHeight);
  });
}
