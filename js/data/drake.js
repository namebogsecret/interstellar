// Drake-equation parameter metadata, presets and sources.
// HONESTY NOTE: R*, fp and (partly) ne are measured by astronomy. fl, fi, fc and L are NOT measured -- there is
// a single data point (Earth) -- so every range for them below is a subjective assumption, not an estimate with
// error bars. Citations are given as authors / year / title / venue from memory; URLs only where the arXiv
// identifier is certain. Numeric ranges of a preset are the page's own log-uniform encoding of the cited
// position, not literal numbers copied from the papers unless the `note` says so.
import { KEYS } from '../physics/drake.js';

export const SOURCES = {
  drake1961: { cite: 'Drake, F. (1961). Green Bank meeting on extraterrestrial intelligence (NRAO); the original estimate of the equation.' },
  sdo2018: { cite: 'Sandberg, A., Drexler, E., Ord, T. (2018). Dissolving the Fermi Paradox. arXiv:1806.02404.', url: 'https://arxiv.org/abs/1806.02404' },
  petigura2013: { cite: 'Petigura, E. A., Howard, A. W., Marcy, G. W. (2013). Prevalence of Earth-size planets orbiting Sun-like stars. PNAS 110, 19273.', url: 'https://arxiv.org/abs/1311.6806' },
  bryson2021: { cite: 'Bryson, S. et al. (2021). The Occurrence of Rocky Habitable Zone Planets around Solar-like Stars from Kepler Data. AJ 161, 36.' },
  kopparapu2013: { cite: 'Kopparapu, R. K. et al. (2013). Habitable zones around main-sequence stars: new estimates. ApJ 765, 131.', url: 'https://arxiv.org/abs/1301.6674' },
  cassan2012: { cite: 'Cassan, A. et al. (2012). One or more bound planets per Milky Way star from microlensing observations. Nature 481, 167.', url: 'https://arxiv.org/abs/1202.0903' },
  lineweaver2001: { cite: 'Lineweaver, C. H. (2001). An estimate of the age distribution of terrestrial planets in the Universe. Icarus 151, 307.' },
  gowanlock2011: { cite: 'Gowanlock, M. G., Patton, D. R., McConnell, S. M. (2011). A model of habitability within the Milky Way Galaxy. Astrobiology 11, 855.' },
  westby2020: { cite: 'Westby, T., Conselice, C. J. (2020). The Astrobiological Copernican Weak and Strong Limits for Intelligent Life. ApJ 896, 58.' },
  frank2016: { cite: 'Frank, A., Sullivan, W. T. (2016). A New Empirical Constraint on the Prevalence of Technological Species in the Universe. Astrobiology 16, 359.' },
  licquia2015: { cite: 'Licquia, T. C., Newman, J. A. (2015). Improved estimates of the Milky Way\'s stellar mass and star formation rate from hierarchical Bayesian meta-analysis. ApJ 806, 96.' },
};

// Slider domain in log10 and display unit for each parameter.
export const PARAM_META = {
  R: { lo: -1, hi: 2, unit: { en: 'stars/yr', ru: 'звёзд/год' },
    label: { en: 'R* — star formation rate', ru: 'R* — темп звездообразования' },
    hint: { en: 'New stars born in the Galaxy per year. Measured by astronomy.', ru: 'Сколько новых звёзд рождается в Галактике за год. Измеряется астрономией.' } },
  fp: { lo: -2, hi: 0, unit: { en: 'fraction', ru: 'доля' },
    label: { en: 'fp — stars with planets', ru: 'fp — звёзды с планетами' },
    hint: { en: 'Fraction of stars that have planets. Measured (microlensing, Kepler).', ru: 'Доля звёзд, у которых есть планеты. Измеряется (микролинзирование, Kepler).' } },
  ne: { lo: -2, hi: 1, unit: { en: 'planets/star', ru: 'планет/звезда' },
    label: { en: 'ne — habitable planets per such star', ru: 'ne — пригодных планет на такую звезду' },
    hint: { en: 'Planets in the habitable zone per planet-bearing star. Partly measured (Kepler η⊕).', ru: 'Планет в зоне обитаемости на звезду с планетами. Частично измерено (η⊕ по Kepler).' } },
  fl: { lo: -30, hi: 0, unit: { en: 'fraction', ru: 'доля' },
    label: { en: 'fl — life arises', ru: 'fl — жизнь возникает' },
    hint: { en: 'Fraction of habitable planets where life starts. NOT measured: one data point.', ru: 'Доля пригодных планет, где возникает жизнь. НЕ измерено: одна точка данных.' } },
  fi: { lo: -12, hi: 0, unit: { en: 'fraction', ru: 'доля' },
    label: { en: 'fi — intelligence evolves', ru: 'fi — появляется разум' },
    hint: { en: 'Fraction of living worlds that develop intelligence. NOT measured.', ru: 'Доля населённых миров, где развивается разум. НЕ измерено.' } },
  fc: { lo: -6, hi: 0, unit: { en: 'fraction', ru: 'доля' },
    label: { en: 'fc — they emit detectable signals', ru: 'fc — подают заметные сигналы' },
    hint: { en: 'Fraction of intelligent species that produce detectable signals. NOT measured.', ru: 'Доля разумных видов, дающих заметные сигналы. НЕ измерено.' } },
  L: { lo: 0, hi: 10, unit: { en: 'years', ru: 'лет' },
    label: { en: 'L — how long they stay detectable', ru: 'L — сколько лет они заметны' },
    hint: { en: 'Years a civilisation keeps emitting detectable signals. NOT measured.', ru: 'Сколько лет цивилизация остаётся заметной. НЕ измерено.' } },
};

const r = (min, max, ...src) => ({ min, max, dist: 'log', src });

// basis: how well the range is grounded. 'measured' | 'model' | 'assumption'.
export const PRESETS = [
  {
    id: 'pessimist',
    name: { en: 'Pessimist', ru: 'Пессимист' },
    note: { en: 'Low end of every range. The lower end of fl·fi·fc is set near the Frank & Sullivan threshold (about 1e-24 per habitable planet): below it we are likely the only technological species ever.',
      ru: 'Нижний край каждого диапазона. Нижний край fl·fi·fc выставлен около порога Фрэнка и Салливана (порядка 1e-24 на пригодную планету): ниже него мы, вероятно, единственный технологический вид за всю историю.' },
    params: {
      R: { ...r(1, 3, 'licquia2015', 'drake1961'), basis: 'measured' },
      fp: { ...r(0.1, 0.5, 'cassan2012', 'lineweaver2001', 'gowanlock2011'), basis: 'model' },
      ne: { ...r(0.05, 0.3, 'petigura2013', 'bryson2021', 'kopparapu2013'), basis: 'measured' },
      fl: { ...r(1e-15, 1e-5, 'frank2016', 'sdo2018'), basis: 'assumption' },
      fi: { ...r(1e-6, 1e-2, 'frank2016', 'sdo2018'), basis: 'assumption' },
      fc: { ...r(1e-3, 1e-1, 'frank2016', 'sdo2018'), basis: 'assumption' },
      L: { ...r(100, 1e4, 'westby2020', 'drake1961'), basis: 'assumption' },
    },
  },
  {
    id: 'optimist',
    name: { en: 'Optimist', ru: 'Оптимист' },
    note: { en: 'High end of every range: life and intelligence are common, civilisations are long-lived.',
      ru: 'Верхний край каждого диапазона: жизнь и разум обычны, цивилизации долговечны.' },
    params: {
      R: { ...r(2, 10, 'licquia2015', 'sdo2018'), basis: 'measured' },
      fp: { ...r(0.5, 1, 'cassan2012'), basis: 'measured' },
      ne: { ...r(0.4, 1, 'bryson2021', 'petigura2013', 'kopparapu2013'), basis: 'measured' },
      fl: { ...r(0.1, 1, 'drake1961'), basis: 'assumption' },
      fi: { ...r(0.1, 1, 'drake1961'), basis: 'assumption' },
      fc: { ...r(0.1, 1, 'drake1961'), basis: 'assumption' },
      L: { ...r(1e4, 1e7, 'westby2020', 'drake1961'), basis: 'assumption' },
    },
  },
  {
    id: 'drake1961',
    name: { en: 'Drake 1961', ru: 'Классика Дрейка 1961' },
    note: { en: 'The values commonly tabulated for the Green Bank meeting (R* = 1/yr, fl = fi = 1, L from 1e3 to 1e8 years), recalled from memory.',
      ru: 'Значения, обычно приводимые для встречи в Грин-Бэнке (R* = 1/год, fl = fi = 1, L от 1e3 до 1e8 лет); приведены по памяти.' },
    params: {
      R: { ...r(1, 1, 'drake1961'), basis: 'assumption' },
      fp: { ...r(0.2, 0.5, 'drake1961'), basis: 'assumption' },
      ne: { ...r(1, 5, 'drake1961'), basis: 'assumption' },
      fl: { ...r(1, 1, 'drake1961'), basis: 'assumption' },
      fi: { ...r(1, 1, 'drake1961'), basis: 'assumption' },
      fc: { ...r(0.1, 0.2, 'drake1961'), basis: 'assumption' },
      L: { ...r(1e3, 1e8, 'drake1961'), basis: 'assumption' },
    },
  },
  {
    id: 'sdo2018',
    name: { en: 'Sandberg–Drexler–Ord 2018', ru: 'Сандберг–Дрекслер–Орд 2018' },
    note: { en: 'Approximate reconstruction in log-uniform form of their wide priors (the paper uses broader, partly log-normal distributions for fl). Key point: when the unmeasured factors are given their honest uncertainty, the spread of N is huge and a lot of probability lies at N < 1.',
      ru: 'Приближённая реконструкция в лог-равномерном виде их широких априорных распределений (в статье для fl используются более широкие, отчасти лог-нормальные распределения). Главное: если неизмеренным множителям дать честный разброс, N растянуто на много порядков, и значительная вероятность приходится на N < 1.' },
    params: {
      R: { ...r(1, 100, 'sdo2018'), basis: 'model' },
      fp: { ...r(0.1, 1, 'sdo2018'), basis: 'model' },
      ne: { ...r(0.1, 1, 'sdo2018'), basis: 'model' },
      fl: { ...r(1e-30, 1, 'sdo2018'), basis: 'assumption' },
      fi: { ...r(1e-3, 1, 'sdo2018'), basis: 'assumption' },
      fc: { ...r(1e-2, 1, 'sdo2018'), basis: 'assumption' },
      L: { ...r(100, 1e10, 'sdo2018'), basis: 'assumption' },
    },
  },
];

export function presetParams(preset) {
  const out = {};
  for (const k of KEYS) out[k] = { min: preset.params[k].min, max: preset.params[k].max, dist: preset.params[k].dist };
  return out;
}
