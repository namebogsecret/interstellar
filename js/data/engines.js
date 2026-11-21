// Engine and route data for engines.html. All SI (m, s, kg, N); distances from the Sun in metres.
// Every entry carries `sources` ([{title, url}], https). Figures are the published ones, rounded as the
// sources round them; the "typical stage" tank/propellant masses are illustrative round numbers, not
// a specific vehicle (stated on the page).
import { AU, LY, G0 } from '../physics/constants.js';

const wiki = (title, slug) => ({ title: 'Wikipedia: ' + title, url: 'https://en.wikipedia.org/wiki/' + slug });

// Order matters: compareEngines returns rows in exactly this order.
export const ENGINES = [
  {
    id: 'chemical', kind: 'rocket',
    name: { en: 'Chemical (LOX/LH2, RL10B-2)', ru: 'Химический (LOX/LH2, RL10B-2)' },
    isp: 465, F: 110e3, engineMass: 301, propMass: 20000, tankMass: 2500,
    sources: [wiki('RL10', 'RL10')],
  },
  {
    id: 'ion', kind: 'rocket',
    name: { en: 'Ion (NASA NEXT-C, xenon)', ru: 'Ионный (NASA NEXT-C, ксенон)' },
    // engineMass = whole propulsion system (thruster + PPU + solar arrays), 1500 kg
    isp: 4170, F: 0.237, engineMass: 1500, propMass: 800, tankMass: 80,
    sources: [wiki('NEXT (ion thruster)', 'NEXT_(ion_thruster)')],
  },
  {
    id: 'ntr', kind: 'rocket',
    name: { en: 'Nuclear-thermal (NERVA)', ru: 'Ядерно-тепловой (NERVA)' },
    isp: 841, F: 246.663e3, engineMass: 18144, propMass: 40000, tankMass: 6000,
    sources: [wiki('NERVA', 'NERVA')],
  },
  {
    id: 'orion', kind: 'rocket',
    name: { en: 'Nuclear pulse (Orion, Dyson 1968)', ru: 'Ядерный импульсный (Орион, Дайсон 1968)' },
    // Dyson's 1968 "momentum-limited" interstellar Orion (Wikipedia, Project Orion): 100 m pusher, empty mass 100 000 t,
    // 300 000 one-megaton bombs, departure mass 400 000 t, mean acceleration 1 g, top speed 10 000 km/s (3.3% c), 133 yr to Alpha Centauri.
    // isp is DERIVED, not quoted: one burn from 400 000 t to 100 000 t (ratio 4) giving 10 000 km/s -> ve = 10 000/ln 4 = 7 213 km/s.
    // F = 1 g x 400 000 t = 3.923e9 N. The 100 000 t empty mass is split 80 000 t engine+pusher / 20 000 t structure+tanks (ASSUMPTION; source gives only the sum).
    // The real thrust is pulsed (~1 bomb/s class); it is averaged to a constant thrust here (assumption stated on the page).
    isp: (1e7 / Math.log(4)) / G0, F: 1 * G0 * 400e6, engineMass: 80e6, propMass: 300e6, tankMass: 20e6,
    sources: [wiki('Project Orion (nuclear propulsion)', 'Project_Orion_(nuclear_propulsion)'),
      wiki('Nuclear pulse propulsion', 'Nuclear_pulse_propulsion')],
  },
  {
    id: 'fusion', kind: 'rocket',
    name: { en: 'Fusion (Daedalus, stage 1)', ru: 'Термоядерный (Дедал, 1-я ступень)' },
    // ve 10 600 km/s -> isp = ve/g0; dry stage 1 690 t total (source gives no split: 190 t engine / 1500 t structure+tanks is an ASSUMPTION; at k=1 only the sum matters, at k!=1 the result depends on it -- flagged on the page)
    isp: 10.6e6 / G0, F: 7.54e6, engineMass: 190e3, propMass: 46e6, tankMass: 1.5e6,
    sources: [wiki('Project Daedalus', 'Project_Daedalus')],
  },
  {
    id: 'sail', kind: 'sail',
    name: { en: 'Solar sail (500 x 500 m)', ru: 'Солнечный парус (500 x 500 м)' },
    area: 250000, arealDensity: 0.010,
    sources: [wiki('Solar sail', 'Solar_sail'),
      wiki('Advanced Composite Solar Sail System (ACS3)', 'Advanced_Composite_Solar_Sail_System')],
  },
  {
    // Beam-driven light sail (Breakthrough Starshot class). Flown by js/physics/lasersail.js launch(); carries no propellant.
    // Power/area = the mission builder's defaults. Sail areal density is lasersail.js's 1 g/m^2 (AREAL_DENSITY), NOT the solar sail's 0.010 kg/m^2.
    id: 'laser', kind: 'laser',
    name: { en: 'Laser sail (100 GW, 16 m²)', ru: 'Лазерный парус (100 ГВт, 16 м²)' },
    laserPower: 100e9, laserArea: 16,
    sources: [wiki('Breakthrough Starshot', 'Breakthrough_Starshot'),
      { title: 'Parkin 2018, The Starshot system model (arXiv:1805.01306)', url: 'https://arxiv.org/abs/1805.01306' }],
  },
];

export const SAIL_EFF = 0.9;

const PLANETS = { sources: [{ title: 'NASA Planetary Fact Sheet', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/' },
  wiki('Hohmann transfer orbit', 'Hohmann_transfer_orbit')] };

// All routes start from Earth's orbit, r0 = 1 AU.
const planet = (id, en, ru, rToAU) => ({
  id, name: { en, ru }, r0: AU, rTo: rToAU * AU, D: (rToAU - 1) * AU, hohmann: true, sources: PLANETS.sources,
});

export const ROUTES = [
  planet('mars', 'Mars (1.524 AU)', 'Марс (1,524 а.е.)', 1.524),
  planet('jupiter', 'Jupiter (5.203 AU)', 'Юпитер (5,203 а.е.)', 5.203),
  planet('pluto', 'Pluto (39.48 AU)', 'Плутон (39,48 а.е.)', 39.48),
  {
    id: 'sgl', name: { en: 'Solar gravitational lens focus (550 AU)', ru: 'Фокус солнечной гравлинзы (550 а.е.)' },
    r0: AU, rTo: null, D: 550 * AU, hohmann: false,
    sources: [wiki('Solar gravitational lens', 'Solar_gravitational_lens')],
  },
  {
    id: 'alphacen', name: { en: 'Alpha Centauri A/B (≈4.37 ly; Proxima: 4.24)', ru: 'α Центавра A/B (≈4,37 св. года; Проксима 4,24)' },
    r0: AU, rTo: null, D: 4.37 * LY, hohmann: false,
    sources: [wiki('Alpha Centauri', 'Alpha_Centauri')],
  },
  {
    // Gaia DR3 parallax 768.07 mas -> 1/p = 1.3020 pc = 4.2465 ly (SIMBAD lists the same Gaia value)
    id: 'proxima', name: { en: 'Proxima Centauri (4.2465 ly)', ru: 'Проксима Центавра (4,2465 св. года)' },
    r0: AU, rTo: null, D: 4.2465 * LY, hohmann: false,
    sources: [{ title: 'SIMBAD: Proxima Cen (Gaia DR3 parallax)', url: 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=Proxima+Cen' },
      wiki('Proxima Centauri', 'Proxima_Centauri')],
  },
];
