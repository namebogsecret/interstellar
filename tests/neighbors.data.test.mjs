// Data contract for js/data/neighbors.js: 50 nearest stars / brown dwarfs.
import assert from 'node:assert/strict';
import { NEIGHBORS } from '../js/data/neighbors.js';
import { STARS } from '../js/data/stars.js';
import { GROUPS, spectralGroup } from '../js/physics/neighbors.js';

assert.equal(NEIGHBORS.length, 50, 'exactly 50 entries');

const ids = new Set(NEIGHBORS.map((s) => s.id));
assert.equal(ids.size, 50, 'unique ids');

for (const s of NEIGHBORS) {
  assert.ok(typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id), 'id slug ' + s.id);
  assert.ok(typeof s.name === 'string' && s.name.length > 0, 'name ' + s.id);
  assert.ok(typeof s.ru === 'string', 'ru is a string (maybe empty) ' + s.id);
  assert.ok(typeof s.system === 'string' && s.system.length > 0, 'system ' + s.id);
  assert.ok(Number.isFinite(s.ly) && s.ly > 0, 'ly > 0 finite ' + s.id);
  assert.ok(s.ly > 4 && s.ly < 16, 'ly within the 50-nearest range ' + s.id);
  const g = spectralGroup(s.spectral);
  assert.ok(g !== null && GROUPS.includes(g), 'spectral class parses: ' + s.id + ' ' + s.spectral);
}

// Sorted by distance: never decreasing; strictly increasing between different systems;
// a system's components are contiguous (Proxima belongs to the Alpha Centauri system and is 2.3% nearer).
for (let i = 1; i < NEIGHBORS.length; i++) {
  const p = NEIGHBORS[i - 1], c = NEIGHBORS[i];
  assert.ok(c.ly >= p.ly, `order ${p.id} -> ${c.id}`);
  if (c.system !== p.system) assert.ok(c.ly > p.ly, `strict between systems ${p.id} -> ${c.id}`);
  else assert.ok((c.ly - p.ly) / p.ly <= 0.03, `same-system components within 3% ${c.id}`);
}
const seenSystems = [];
for (const s of NEIGHBORS) {
  if (seenSystems[seenSystems.length - 1] !== s.system) {
    assert.ok(!seenSystems.includes(s.system), 'system contiguous: ' + s.system);
    seenSystems.push(s.system);
  }
}

// Not the Sun.
assert.ok(!NEIGHBORS.some((s) => /^sun$|^sol$/i.test(s.name)), 'Sun excluded');

// Every stars.js entry is covered via `ref`, distances agree within 2%.
for (const st of STARS) {
  const m = NEIGHBORS.filter((s) => s.ref === st.name);
  assert.ok(m.length >= 1, 'stars.js entry present in neighbors: ' + st.name);
  for (const s of m) {
    const rel = Math.abs(s.ly - st.ly) / st.ly;
    assert.ok(rel <= 0.02, `${s.id} vs stars.js ${st.name}: ${s.ly} vs ${st.ly}`);
  }
}
// every ref points to a real stars.js entry
for (const s of NEIGHBORS) if (s.ref !== null) assert.ok(STARS.some((x) => x.name === s.ref), 'ref exists: ' + s.id);
// Proxima is the closest and has the exact stars.js distance.
assert.equal(NEIGHBORS[0].id, 'proxima');
assert.equal(NEIGHBORS[0].ly, STARS.find((x) => x.name === 'Proxima Centauri').ly);

// Spot checks of spectral groups (white dwarfs, brown dwarfs, Sun-like).
const grp = (id) => spectralGroup(NEIGHBORS.find((s) => s.id === id).spectral);
assert.equal(grp('sirius-b'), 'D'); assert.equal(grp('procyon-b'), 'D'); assert.equal(grp('van-maanen'), 'D');
assert.equal(grp('alpha-cen-a'), 'G'); assert.equal(grp('sirius-a'), 'A'); assert.equal(grp('procyon-a'), 'F');
assert.equal(grp('luhman16-a'), 'L'); assert.equal(grp('eps-ind-bb'), 'T'); assert.equal(grp('kapteyn'), 'M');
console.log('neighbors.data.test: OK (' + NEIGHBORS.length + ' stars)');
