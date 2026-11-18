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
    hint: { en: 'Planets in the habitable zone per planet-bearing star. Partly measured (Kepler η⊕, which is per Sun-like star but applied to all stars here).', ru: 'Планет в зоне обитаемости на звезду с планетами. Частично измерено (η⊕ по Kepler — на солнцеподобную звезду, здесь применено ко всем).' } },
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
const cv = (en, ru) => ({ en, ru });

const NE_CAVEAT = {
  en: 'The eta-Earth values of Petigura et al. and Bryson et al. are per Sun-like star; here they are applied to all stars.',
  ru: 'Значения η⊕ у Petigura и др. и Bryson и др. относятся к солнцеподобной звезде; здесь они применены ко всем звёздам.',
};
const FSU = cv('Unmeasured. The Frank & Sullivan threshold (about 1e-24 per habitable planet) is for the observable Universe, not for the Galaxy, so it does not fix this range; the values are our pessimistic assumption.',
  'Не измерено. Порог Фрэнка и Салливана (порядка 1e-24 на пригодную планету) относится к наблюдаемой Вселенной, а не к Галактике, поэтому этот диапазон он не задаёт; значения — наше пессимистичное допущение.');
const SDOC = cv('Approximate log-uniform reconstruction of the prior used in the paper, not its exact distribution.',
  'Приближённая лог-равномерная реконструкция априорного распределения из статьи, а не его точный вид.');

// basis: how well the range is grounded. 'measured' | 'model' | 'assumption'.
export const PRESETS = [
  {
    id: 'pessimist',
    name: { en: 'Pessimist', ru: 'Пессимист' },
    note: { en: 'Low end of every range. Frank & Sullivan (2016) give a threshold of about 1e-24 technological species per habitable planet, but that is for the whole OBSERVABLE UNIVERSE; for a single Galaxy the corresponding threshold is many orders of magnitude higher, so this preset is not a Frank & Sullivan bound for the Milky Way.',
      ru: 'Нижний край каждого диапазона. Фрэнк и Салливан (2016) дают порог порядка 1e-24 технологических видов на пригодную планету, но это для всей НАБЛЮДАЕМОЙ ВСЕЛЕННОЙ; для одной Галактики соответствующий порог на много порядков выше, так что этот пресет не является границей Фрэнка и Салливана для Млечного Пути.' },
    params: {
      R: { ...r(1, 3, 'licquia2015'), basis: 'model', caveat: cv('Licquia & Newman measured the star-formation rate in solar masses per year (1.65 ± 0.19), not stars per year. Conversion to stars/yr assumes a mean stellar mass of about 0.5 solar masses: an assumption.', 'Licquia и Newman измерили темп звездообразования в массах Солнца в год (1,65 ± 0,19), а не звёзд в год. Пересчёт в звёзды/год предполагает среднюю массу звезды около 0,5 массы Солнца — допущение.') },
      fp: { ...r(0.1, 0.5, 'lineweaver2001', 'gowanlock2011'), basis: 'assumption', caveat: cv('Measurements put fp near 1 (Cassan et al. 2012: on average one or more planets per star). The lower range here is our pessimistic assumption, standing in for restricting life to the galactic habitable zone (Lineweaver; Gowanlock et al.), not a number from those papers.', 'Измерения дают fp около 1 (Cassan и др. 2012: в среднем одна и более планет на звезду). Нижний диапазон здесь — наше пессимистичное допущение, заменяющее ограничение жизни галактической зоной обитаемости (Lineweaver; Gowanlock и др.), а не число из этих статей.') },
      ne: { ...r(0.05, 0.3, 'petigura2013', 'bryson2021', 'kopparapu2013'), basis: 'measured', caveat: cv(NE_CAVEAT.en, NE_CAVEAT.ru) },
      fl: { ...r(1e-15, 1e-5, 'frank2016'), basis: 'assumption', caveat: cv(FSU.en, FSU.ru) },
      fi: { ...r(1e-6, 1e-2, 'frank2016'), basis: 'assumption', caveat: cv(FSU.en, FSU.ru) },
      fc: { ...r(1e-3, 1e-1, 'frank2016'), basis: 'assumption', caveat: cv(FSU.en, FSU.ru) },
      L: { ...r(100, 1e4, 'westby2020'), basis: 'assumption', caveat: cv('The lower end (100 years) follows Westby & Conselice 2020, who take L of about 100 years; the upper end is our assumption.', 'Нижний край (100 лет) следует Westby и Conselice 2020, которые берут L около 100 лет; верхний край — наше допущение.') },
    },
  },
  {
    id: 'optimist',
    name: { en: 'Optimist', ru: 'Оптимист' },
    note: { en: 'High end of every range: life and intelligence are common, civilisations are long-lived.',
      ru: 'Верхний край каждого диапазона: жизнь и разум обычны, цивилизации долговечны.' },
    params: {
      R: { ...r(2, 10, 'licquia2015'), basis: 'assumption', caveat: cv('Lower end from the measured star-formation rate (1.65 ± 0.19 solar masses/yr, Licquia & Newman) converted with an assumed mean stellar mass of about 0.5; the upper end of 10 stars/yr is our assumption.', 'Нижний край — от измеренного темпа звездообразования (1,65 ± 0,19 массы Солнца/год, Licquia и Newman) при допущенной средней массе звезды около 0,5; верхний край 10 звёзд/год — наше допущение.') },
      fp: { ...r(0.5, 1, 'cassan2012'), basis: 'measured', caveat: cv('Cassan et al. 2012: on average one or more bound planets per star, so fp is close to 1.', 'Cassan и др. 2012: в среднем одна и более планет на звезду, то есть fp близко к 1.') },
      ne: { ...r(0.4, 1, 'bryson2021', 'petigura2013', 'kopparapu2013'), basis: 'measured', caveat: cv(NE_CAVEAT.en + ' The upper end of 1 is above the published central values (our assumption).', NE_CAVEAT.ru + ' Верхний край 1 выше опубликованных центральных значений (наше допущение).') },
      fl: { ...r(0.1, 1, 'drake1961'), basis: 'assumption' },
      fi: { ...r(0.1, 1, 'drake1961'), basis: 'assumption' },
      fc: { ...r(0.1, 1, 'drake1961'), basis: 'assumption' },
      L: { ...r(1e4, 1e7, 'drake1961'), basis: 'assumption', caveat: cv('Our assumption; Drake 1961 considered L up to 1e8 years. Westby & Conselice 2020 take L of about 100 years, so they do not support this range.', 'Наше допущение; Дрейк в 1961 рассматривал L до 1e8 лет. Westby и Conselice 2020 берут L около 100 лет, так что этот диапазон они не подтверждают.') },
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
      R: { ...r(1, 100, 'sdo2018'), basis: 'model', caveat: SDOC },
      fp: { ...r(0.1, 1, 'sdo2018'), basis: 'model', caveat: SDOC },
      ne: { ...r(0.1, 1, 'sdo2018'), basis: 'model', caveat: SDOC },
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
