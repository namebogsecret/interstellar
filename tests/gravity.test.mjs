// Gravitational potential + weak-field time-dilation contract (gravity.js).
import * as THREE from 'three';
import { gravitationalPotential } from '../js/physics/gravity.js';
import { C2 } from '../js/physics/constants.js';
import { BODIES } from '../js/data/bodies.js';
import { approxAbs } from './helpers.mjs';
import assert from 'node:assert/strict';

const Earth = BODIES.find((b) => b.name === 'Earth');
assert.ok(Earth && Earth.GM, 'Earth must exist with GM');
const earthPos = new THREE.Vector3(0, 0, 0);
const bodies = [Earth];
const positions = new Map([[Earth.name, earthPos]]);

const surface = new THREE.Vector3(Earth.radius, 0, 0);
const far10 = new THREE.Vector3(10 * Earth.radius, 0, 0);
const huge = new THREE.Vector3(1e15, 0, 0);

// Φ < 0 wherever mass is present.
const phiSurf = gravitationalPotential(surface, bodies, positions);
assert.ok(phiSurf < 0, `Φ at surface must be negative, got ${phiSurf}`);

// |Φ| decreases with distance.
const phiFar = gravitationalPotential(far10, bodies, positions);
assert.ok(Math.abs(phiSurf) > Math.abs(phiFar),
  `|Φ| at surface (${Math.abs(phiSurf)}) must exceed |Φ| at 10× r (${Math.abs(phiFar)})`);

// dτ-factor = √(max(0, 1 + 2Φ/c² − β²)); at surface with v=0 it is < 1.
const factorSurf = Math.sqrt(Math.max(0, 1 + 2 * phiSurf / C2 - 0));
assert.ok(factorSurf < 1, `dτ factor at Earth surface (v=0) must be < 1, got ${factorSurf}`);

// At huge r with v=0 the factor → 1.
const phiHuge = gravitationalPotential(huge, bodies, positions);
const factorHuge = Math.sqrt(Math.max(0, 1 + 2 * phiHuge / C2 - 0));
approxAbs(factorHuge, 1, 1e-12, 'dτ factor → 1 far from all mass (v=0)');

console.log('gravity.test.mjs OK');
