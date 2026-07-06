// Node ESM resolver hook: map the bare `three` specifier (resolved in the
// browser via an import map) to the vendored r160 build, so physics modules
// import unchanged under `node --loader tests/three-loader.mjs ...`.
// THREE's math classes (Vector3/Quaternion/...) are pure JS and run in Node.
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const THREE_URL = pathToFileURL(path.join(here, '..', 'lib', 'three.module.js')).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: THREE_URL, shortCircuit: true };
  return next(spec, ctx);
}
