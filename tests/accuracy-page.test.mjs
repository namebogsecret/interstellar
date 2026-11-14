// Тест данных страницы «Насколько это точно»: модель js/accuracy/model.js на реальном
// validation/results/results.json + согласованность страницы с данными.
// Запуск через tests/run.sh (physics gate).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseResults, summarize, chartRows, headroom, fmtSci, CASE_GROUPS, FLOOR } from '../js/accuracy/model.js';

const json = JSON.parse(readFileSync(new URL('../validation/results/results.json', import.meta.url), 'utf8'));
const rows = parseResults(json);
const s = summarize(rows);

// 1. Данные целы и сходятся: ни одного FAIL, все PASS в допуске.
assert.equal(s.fail, 0, 'в results.json есть FAIL');
assert.equal(s.total, rows.length);
assert.equal(s.pass + s.notCovered, s.total);
assert.ok(s.pass >= 30, 'ожидается ≥30 проверок, есть ' + s.pass);
for (const r of rows.filter((r) => r.status === 'PASS')) {
  if (r.tolerance_kind === 'rel') assert.ok(r.rel_err <= r.tolerance, r.case + '/' + r.quantity + ': невязка выше допуска');
  if (r.tolerance_kind === 'min') assert.ok(r.simulated >= r.tolerance, r.case + ': порядок сходимости ниже допуска');
}

// 2. «Не покрыто» показывается честно, и без чисел.
const nc = rows.filter((r) => r.status === 'NOT_COVERED');
assert.ok(nc.length >= 2);
for (const r of nc) assert.ok(r.note && r.note.length > 10, r.case + ': нет пояснения, почему не покрыто');
assert.ok(rows.some((r) => r.case.startsWith('C2_')) && rows.some((r) => r.case.startsWith('C4_')));

// 3. Все кейсы относятся к известным группам страницы.
const gids = CASE_GROUPS.map((g) => g.id);
for (const r of rows) assert.ok(gids.includes(r.group), 'кейс вне групп: ' + r.case);

// 4. График: только относительные допуски, лог-шкала не ломается на нулях.
const ch = chartRows(rows);
assert.equal(ch.length, rows.filter((r) => r.tolerance_kind === 'rel' && r.status === 'PASS').length);
for (const c of ch) {
  assert.ok(c.err >= FLOOR && Number.isFinite(Math.log10(c.err)));
  assert.ok(c.ok && c.err <= c.tol);
}
assert.ok(ch.some((c) => c.exact), 'ожидались точные нули (Доплер β=0.1)');

// 5. Запас допуска и сводка.
assert.ok(Math.abs(headroom({ tolerance_kind: 'rel', rel_err: 1e-6, tolerance: 1e-3 }) - 1000) < 1e-6);
assert.equal(headroom({ tolerance_kind: 'rel', rel_err: 0, tolerance: 1e-3 }), null);
assert.ok(s.minHeadroom >= 1 && s.minHeadroom < 1e6, 'запас допуска: ' + s.minHeadroom);
assert.ok(s.maxRelErr < 1e-3);

// 6. Форматирование.
assert.equal(fmtSci(0), '0');
assert.equal(fmtSci(null), '—');
assert.equal(fmtSci(1.234e-5), '1.23·10⁻⁵');

// 7. Модель отвергает мусор.
assert.throws(() => parseResults([]));
assert.throws(() => parseResults([{ case: 'A', quantity: 'x', status: 'MAYBE' }]));

// 8. Страница читает те же данные и не прячет дисклеймер о непокрытом.
const html = readFileSync(new URL('../accuracy.html', import.meta.url), 'utf8');
assert.ok(html.includes('validation/results/results.json'));
assert.ok(html.includes('js/accuracy/model.js'));
assert.ok(html.includes('NOT_COVERED') || html.includes('not covered'));
assert.ok(readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8').includes('/accuracy.html'));

console.log('accuracy-page: OK (' + s.pass + ' PASS, ' + s.notCovered + ' not covered)');
