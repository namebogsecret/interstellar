// Чистая модель данных страницы «Насколько это точно» (accuracy.html).
// Без DOM: те же функции используются страницей и тестом tests/accuracy-page.test.mjs.
// Источник данных — validation/results/results.json (пишет validation/run.sh).

export const FLOOR = 1e-17; // нижняя граница лог-шкалы: точный ноль рисуем здесь

export const CASE_GROUPS = [
  { id: 'A', en: 'Hyperbolic motion (constant proper acceleration)', ru: 'Гиперболическое движение (постоянное собственное ускорение)' },
  { id: 'B', en: 'Twin paradox and inertial flight', ru: 'Парадокс близнецов и инерциальный полёт' },
  { id: 'C', en: 'Redshift: Doppler and gravitational', ru: 'Красное смещение: Доплер и гравитационное' },
];

export function groupOf(caseName) { return String(caseName).charAt(0); }

export function parseResults(json) {
  if (!Array.isArray(json) || json.length === 0) throw new Error('results: пустой или не массив');
  return json.map((r, i) => {
    if (!r || typeof r.case !== 'string' || typeof r.quantity !== 'string') throw new Error('results[' + i + ']: нет case/quantity');
    if (!['PASS', 'FAIL', 'NOT_COVERED'].includes(r.status)) throw new Error('results[' + i + ']: неизвестный status ' + r.status);
    return { ...r, group: groupOf(r.case) };
  });
}

export function summarize(rows) {
  const s = { total: rows.length, pass: 0, fail: 0, notCovered: 0, maxRelErr: 0, minHeadroom: Infinity };
  for (const r of rows) {
    if (r.status === 'PASS') s.pass++;
    else if (r.status === 'FAIL') s.fail++;
    else s.notCovered++;
    if (r.tolerance_kind === 'rel' && r.status !== 'NOT_COVERED') {
      s.maxRelErr = Math.max(s.maxRelErr, r.rel_err);
      const h = headroom(r);
      if (h !== null) s.minHeadroom = Math.min(s.minHeadroom, h);
    }
  }
  if (s.minHeadroom === Infinity) s.minHeadroom = null;
  return s;
}

// Запас допуска: во сколько раз tolerance больше фактической невязки (∞ при нулевой невязке → null).
export function headroom(r) {
  if (r.tolerance_kind !== 'rel' || !(r.rel_err > 0)) return null;
  return r.tolerance / r.rel_err;
}

// Строки для графика невязок: только относительные допуски (порядок сходимости — не невязка).
export function chartRows(rows) {
  return rows
    .filter((r) => r.tolerance_kind === 'rel' && r.status !== 'NOT_COVERED')
    .map((r) => ({
      label: r.case + ' · ' + r.quantity,
      group: r.group,
      err: Math.max(r.rel_err, FLOOR),
      tol: r.tolerance,
      exact: !(r.rel_err > 0),
      ok: r.rel_err <= r.tolerance,
    }));
}

export function fmtSci(x) {
  if (x === null || x === undefined) return '—';
  if (x === 0) return '0';
  const [m, e] = x.toExponential(2).split('e');
  return m + '·10' + sup(parseInt(e, 10));
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sup(n) { return String(n).split('').map((c) => SUP[c]).join(''); }
