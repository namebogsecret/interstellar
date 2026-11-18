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
