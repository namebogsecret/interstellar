// Relativistic view post-process: special-relativistic aberration + Doppler
// colour shift + relativistic beaming ("headlight" effect), computed in
// screen space from the ship's velocity.
//
// It is a screen-space APPROXIMATION (we re-sample the already-rendered frame
// rather than re-tracing the scene), but it uses the exact SR formulae:
//   - aberration (inverse):   cosθ = (cosθ' − β) / (1 − β·cosθ')
//       maps each on-screen direction θ' (ship frame) back to the rest-frame
//       direction θ we actually rendered, so the forward sky bunches up.
//   - Doppler factor:         D = √(1−β²) / (1 − β·cosθ')
//       D>1 ahead (blueshift + brighten), D<1 behind (redshift + dim).
//   - beaming:                received intensity ∝ D^n  (searchlight effect)
//
// The whole effect eases in only above ~0.003c and is pixel-perfect pass-through
// at rest, so normal orbital flight is untouched — it blooms into a dramatic
// "вау" exactly when a student burns hard toward light speed.
import * as THREE from 'three';
import { ShaderPass } from '../../lib/jsm/postprocessing/ShaderPass.js';

// Field of view (deg) used to render the SOURCE scene that feeds this pass.
// Wider than the display FOV so forward-looking display pixels — which, once
// aberration is applied with the correct sign, map to REST-frame angles wider
// than the display FOV — have something to sample instead of clamping at the
// screen edge.
//
// Documented limitation: this wider-FOV source (90°) covers moderate β + the
// central field; at high β a displayed pixel can map to a rest angle beyond
// the 90° source frustum (β=0.5 corner → ~77°), where sampling clamps (mild
// forward-rim smear). Full forward-hemisphere aberration needs a cubemap
// (out of scope). SOURCE_FOV is the single tuning knob: 75°=crisper/less
// headroom, 90°=default, 110°=softer/more headroom.
export const SOURCE_FOV = 90;

const RelativisticShader = {
  name: 'RelativisticShader',
  uniforms: {
    tDiffuse:     { value: null },
    uBeta:        { value: 0.0 },                       // |v|/c
    uDir:         { value: new THREE.Vector3(0, 0, -1) }, // unit velocity dir, VIEW space
    uViewTanHalf: { value: Math.tan(0.5 * 60 * Math.PI / 180) },  // display camera fov
    uSrcTanHalf:  { value: Math.tan(0.5 * SOURCE_FOV * Math.PI / 180) }, // source camera fov
    uAspect:      { value: 1.0 },
    uStrength:    { value: 1.0 },                        // master toggle 0..1
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uBeta;
    uniform vec3  uDir;
    uniform float uViewTanHalf;
    uniform float uSrcTanHalf;
    uniform float uAspect;
    uniform float uStrength;
    varying vec2 vUv;

    // Project a view-space ray (forward = -z) into the WIDE source texture's
    // UV space (source camera uses uSrcTanHalf, not the display's uViewTanHalf).
    vec2 projectToSourceUV(vec3 r) {
      vec2 proj = vec2(-r.x / r.z / (uSrcTanHalf * uAspect), -r.y / r.z / uSrcTanHalf);
      return clamp(proj * 0.5 + 0.5, 0.0, 1.0);
    }

    void main() {
      // Display-frame ray for this pixel (camera looks down -z), built from
      // the DISPLAY fov — this is θ' (ship / observed frame).
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 ray = normalize(vec3(ndc.x * uViewTanHalf * uAspect, ndc.y * uViewTanHalf, -1.0));

      // Where this display direction lands in the WIDE source texture at rest
      // (no aberration) — used both for the pass-through and as the ineffective
      // (eff=0) baseline of the mix below.
      vec2 uvRestDir = ray.z < -1e-4 ? projectToSourceUV(ray) : vUv;

      vec4 orig = texture2D(tDiffuse, uvRestDir);

      // Ease the effect in just above orbital speeds; off => exact pass-through.
      float eff = uStrength * smoothstep(0.003, 0.05, uBeta);
      if (eff < 1e-4) { gl_FragColor = orig; return; }
      float beta = clamp(uBeta, 0.0, 0.999999);

      float cp = dot(ray, uDir);                       // cos θ' (observed / ship frame)

      // Inverse aberration -> rest-frame direction we actually rendered.
      // mirror of aberratedCos() in js/physics/relativity.js — keep identical
      float cT = (cp - beta) / (1.0 - beta * cp);      // cos θ (rest frame)
      vec3 perp = ray - cp * uDir;
      float pl = length(perp);
      vec3 perpHat = pl > 1e-6 ? perp / pl : vec3(0.0);
      float sT = sqrt(max(0.0, 1.0 - cT * cT));
      vec3 rayRest = cT * uDir + sT * perpHat;

      // Re-project the aberrated rest-frame ray into the same wide source UV
      // space, then blend against the un-aberrated baseline by effect strength.
      vec2 uvAberr = rayRest.z < -1e-4 ? projectToSourceUV(rayRest) : uvRestDir;
      vec2 sampleUv = mix(uvRestDir, uvAberr, eff);
      vec3 col = texture2D(tDiffuse, sampleUv).rgb;

      // Doppler factor along the observed line of sight.
      float D = sqrt(max(1e-6, 1.0 - beta * beta)) / max(1e-3, 1.0 - beta * cp);

      // Colour-temperature tint: blueshift -> blue, redshift -> red.
      float s = clamp(D - 1.0, -0.85, 0.85);
      vec3 tint = vec3(1.0 - 0.55 * max(s, 0.0) + 0.65 * max(-s, 0.0),
                       1.0 - 0.15 * abs(s),
                       1.0 + 0.65 * max(s, 0.0) - 0.55 * max(-s, 0.0));

      // Relativistic beaming (searchlight): brighten ahead, dim behind. Use a
      // gentler power than the bolometric D^4 so the forward field doesn't
      // blow out to pure white on a school projector.
      float beam = clamp(pow(D, 2.2), 0.15, 8.0);

      vec3 shifted = col * tint * beam;
      gl_FragColor = vec4(mix(orig.rgb, shifted, eff), orig.a);
    }`,
};

export function createRelativisticPass(width, height) {
  const pass = new ShaderPass(RelativisticShader);
  pass.uniforms.uAspect.value = width / height;
  return pass;
}

// Per-frame update: feed the ship's coordinate velocity (m/s), the inverse
// camera quaternion (world -> view), the camera, and the master strength.
const _vhat = new THREE.Vector3();
export function updateRelativisticPass(pass, velocity, qInv, camera, strength) {
  const u = pass.uniforms;
  const speed = velocity.length();
  u.uBeta.value = speed / 299792458;
  u.uStrength.value = strength;
  u.uViewTanHalf.value = Math.tan(0.5 * camera.fov * Math.PI / 180);
  u.uSrcTanHalf.value = Math.tan(0.5 * SOURCE_FOV * Math.PI / 180);
  u.uAspect.value = camera.aspect;
  if (speed > 1) {
    _vhat.copy(velocity).multiplyScalar(1 / speed).applyQuaternion(qInv);
    u.uDir.value.copy(_vhat);
  }
}
