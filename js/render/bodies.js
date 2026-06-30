import * as THREE from 'three';
import { MIN_PIXEL_SIZE } from '../physics/constants.js';
import { spinAngle } from '../physics/orbits.js';

// --- Fresnel atmosphere shell: brightens toward the limb (air glow / haze). --
function atmosphereMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 3.0 }, uIntensity: { value: 1.1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 wp = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-wp.xyz);
        gl_Position = projectionMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), uPower);
        gl_FragColor = vec4(uColor * rim * uIntensity, rim);
      }`,
    transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.BackSide, depthWrite: false,
  });
}

// Soft radial glow sprite (used for Sun corona + outer halo).
function glowTexture() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,240,210,0.9)');
  grd.addColorStop(0.5, 'rgba(255,180,90,0.35)');
  grd.addColorStop(1.0, 'rgba(255,120,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let _glowTex = null;

export class BodyView {
  constructor(body, textureLoader) {
    this.body = body;
    this.group = new THREE.Group();
    this.spinGroup = new THREE.Group();
    this.group.add(this.spinGroup);

    const seg = body.name === 'Sun' ? 64 : body.radius > 2e7 ? 56 : body.radius > 3e6 ? 40 : 24;
    const geo = new THREE.SphereGeometry(body.radius, seg, seg / 2);

    let mat;
    if (body.emissive) {
      // Sun: bright basic material so bloom catches it.
      mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      if (body.texture) textureLoader.load(body.texture, (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: body.color, roughness: 0.95, metalness: 0 });
      if (body.texture) textureLoader.load(body.texture, (t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.spinGroup.add(this.mesh);
    this.spinGroup.rotation.z = body.tilt || 0;

    // Sun: layered corona + broad halo so it reads as a star at any distance.
    if (body.emissive) {
      if (!_glowTex) _glowTex = glowTexture();
      const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex, color: 0xffe6b0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      corona.scale.setScalar(body.radius * 3.2);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glowTex, color: 0xffcf80, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(body.radius * 9);
      this.group.add(corona); this.group.add(halo);
      this.glow = corona;
    }

    if (body.clouds) {
      const cgeo = new THREE.SphereGeometry(body.radius * 1.01, seg, seg / 2);
      const cmat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
      textureLoader.load(body.clouds, (t) => { t.colorSpace = THREE.SRGBColorSpace; cmat.map = t; cmat.alphaMap = t; cmat.needsUpdate = true; });
      this.clouds = new THREE.Mesh(cgeo, cmat);
      this.spinGroup.add(this.clouds);
    }

    if (body.atmosphere) {
      const ageo = new THREE.SphereGeometry(body.radius + body.atmosphere.height * 1.6, seg, seg / 2);
      this.atmo = new THREE.Mesh(ageo, atmosphereMaterial(body.atmosphere.color));
      this.group.add(this.atmo);
    }

    if (body.rings) {
      const rgeo = new THREE.RingGeometry(body.rings.inner, body.rings.outer, 160, 1);
      const pos = rgeo.attributes.position, uv = rgeo.attributes.uv;
      const v3 = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v3.fromBufferAttribute(pos, i);
        const u = (v3.length() - body.rings.inner) / (body.rings.outer - body.rings.inner);
        uv.setXY(i, u, 0.5);
      }
      const rmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      textureLoader.load(body.rings.texture, (t) => { t.colorSpace = THREE.SRGBColorSpace; rmat.map = t; rmat.alphaMap = t; rmat.needsUpdate = true; });
      this.rings = new THREE.Mesh(rgeo, rmat);
      this.rings.rotation.x = Math.PI / 2;
      this.spinGroup.add(this.rings);
    }

    // Star-like point marker for when the body is sub-pixel.
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const mmat = new THREE.PointsMaterial({ color: body.color, size: 4, sizeAttenuation: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending });
    this.marker = new THREE.Points(mgeo, mmat);
    this.group.add(this.marker);
  }

  update(relPos, t, camera) {
    this.group.position.copy(relPos);
    this.spinGroup.rotation.y = spinAngle(this.body, t);
    if (this.clouds) this.clouds.rotation.y = spinAngle(this.body, t) * 0.9;

    const dist = relPos.length();
    const fov = camera.fov * Math.PI / 180;
    const pxPerRad = window.innerHeight / fov;
    const apparentPx = (this.body.radius / Math.max(dist, 1)) * pxPerRad;
    const tiny = apparentPx < MIN_PIXEL_SIZE;
    this.mesh.visible = !tiny;
    if (this.atmo) this.atmo.visible = !tiny;
    if (this.clouds) this.clouds.visible = !tiny;
    if (this.rings) this.rings.visible = !tiny;
    this.marker.visible = tiny && this.body.name !== 'Sun';
    this.apparentPx = apparentPx;
    this.dist = dist;
  }
}
