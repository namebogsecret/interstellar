// Tiny i18n layer: a string dictionary + localized number/unit formatters +
// localized body names. Static DOM text uses data-i18n / data-i18n-html
// attributes; dynamic strings go through t(key, vars).
import { C, AU, YEAR } from './physics/constants.js';

export const NAMES = {
  ru: {
    Sun: 'Солнце', Mercury: 'Меркурий', Venus: 'Венера', Earth: 'Земля', Moon: 'Луна',
    Mars: 'Марс', Phobos: 'Фобос', Deimos: 'Деймос', Jupiter: 'Юпитер', Io: 'Ио',
    Europa: 'Европа', Ganymede: 'Ганимед', Callisto: 'Каллисто', Saturn: 'Сатурн',
    Titan: 'Титан', Uranus: 'Уран', Neptune: 'Нептун', Triton: 'Тритон',
  },
  en: {},
};

const DICT = {
  en: {
    // --- start screen ---
    'start.sub': 'Relativistic first-person flight · real solar system',
    'start.intro': `You start in <b>orbit around Earth</b>. Space has no air and no
      "down". Your ship coasts on its own — fire the engine and it keeps going
      until you fire the other way. To slow down you turn around and thrust, or
      just press <b>X</b> to stop. Gravity is real: drift too close and slow to a
      planet and you'll fall toward it.`,
    'start.controls': `
      <div class="cline"><b>Move the mouse</b> — look around / aim the nose of the ship.</div>
      <div class="cline"><b>W</b> — fire engine forward (speed up). &nbsp; <b>S</b> — fire backward (slow down / reverse).</div>
      <div class="cline"><b>A · D</b> — slide left / right. &nbsp; <b>R · F</b> — slide up / down.</div>
      <div class="cline"><b>1…9</b> — set engine power, log scale (1≈1 g … 9≈1000 g in arcade; realistic clamps to the ship's thrust limit ≈3–15 g, <b>0</b> = engine off). &nbsp; <b>[ · ]</b> — trim power down / up. &nbsp; <b>Q · E</b> — tilt (roll).</div>
      <div class="cline"><b>X</b> — <b>STOP</b>: cancel all drifting and stop spinning (your "brake"). &nbsp; <b>K</b> — circularize your orbit around the nearest body.</div>
      <div class="cline"><b>Tab</b> — pick somewhere to go (Sun / planet / moon). &nbsp; <b>G</b> — instantly jump next to it.</div>
      <div class="cline"><b>.</b> / <b>,</b> — speed up / slow down time (to watch planets move or cross huge distances). &nbsp; <b>P</b> — pause.</div>
      <div class="cline"><b>M</b> — switch unlimited ↔ realistic limited fuel. &nbsp; <b>⌫ Backspace</b> — start over at Earth.</div>`,
    'start.tip': `<b>Never flown before? Try this:</b> press <b>Tab</b> until the
      target says the Moon, then press <b>G</b> to jump beside it. Or aim at Earth,
      hold <b>W</b>, and watch the clocks: near light speed your ship-clock ticks
      slower than the system clock — that's real physics.`,
    'start.launch': '▶ Launch (click to capture the mouse)',

    // --- HUD labels ---
    'hud.speed': 'SPEED', 'hud.gamma': 'γ (time-stretch)', 'hud.dilation': 'TIME DILATION',
    'hud.accel': 'FELT G-FORCE', 'hud.mode': 'MODE', 'hud.throttle': 'ENGINE POWER',
    'hud.fuel': 'FUEL', 'hud.ref': 'NEAREST BODY', 'hud.alt': 'ALTITUDE', 'hud.atmo': 'AIR',
    'nav.target': 'TARGET', 'nav.distance': 'DISTANCE', 'nav.eta': 'TIME TO REACH',
    'nav.simtime': 'WORLD TIME', 'nav.shiptime': 'YOUR TIME', 'nav.warp': 'TIME SPEED', 'nav.fps': 'FPS',
    'nav.periapsis': 'PERIAPSIS', 'nav.apoapsis': 'APOAPSIS', 'nav.closespeed': 'CLOSING SPEED',
    'nav.closedist': 'CLOSEST APPROACH', 'nav.closeeta': 'TIME TO CLOSEST',
    'nav.impact': 'impact', 'nav.escape': 'escape', 'nav.receding': 'receding',

    // --- dynamic ---
    'mode.arcade': 'ARCADE · unlimited fuel', 'mode.realistic': 'REALISTIC · limited fuel',
    'val.infinite': 'unlimited',
    'dyn.dilation': '1 s for you = {g} s for the world',
    'dyn.atmoIn': '{rho} kg/m³ (in the air)', 'dyn.vacuum': 'vacuum (no air)',
    'dyn.dvleft': '· speed budget {v}',
    'st.coasting': 'COASTING (engine off)', 'st.burning': 'ENGINE ON · {g} g',
    'st.atmo': 'FLYING THROUGH AIR', 'st.ref': 'near {name}',
    'st.landed': 'LANDED on {name} · press W / Space to take off',
    'st.crashed': 'CRASHED on {name} · press W / Space to take off',
    'st.warpHeld': 'time auto-slowed (close to a body / engine on)',
    'ev.online': 'Systems online · orbiting Earth. Click to start.',
    'ev.mode': 'Fuel: {m}', 'ev.target': 'Target: {name}', 'ev.jumped': 'Jumped to {name}',
    'ev.warp': 'Time speed {x}×', 'ev.drift': 'Stopped — matched {name}', 'ev.stopped': 'Stopped',
    'ev.reset': 'Reset to Earth', 'ev.orbits': 'Orbit lines {s}', 'ev.labels': 'Labels {s}',
    'ev.bloom': 'Glow {s}', 'ev.relfx': 'Relativistic optics {s}', 'ev.liftoff': 'Lift-off from {name}',
    'ev.pause': 'Paused', 'ev.resume': 'Resumed', 'ev.circularize': 'Circularized around {name}',
    'ev.touchdown': '🛬 Touchdown on {name} · {spd} — press W / Space to take off',
    'ev.crash': '💥 CRASHED into {name} at {spd} — press W / Space to take off, ⌫ to reset',
    'ev.bloomAuto': 'Glow turned off (slow frame-rate) — press B to force on',
    'ev.enterAtmo': 'Entering {name}’s atmosphere', 'ev.leftAtmo': 'Left {name}’s atmosphere',
    'w.on': 'on', 'w.off': 'off',
    // --- system map (V) ---
    'map.title': 'SYSTEM MAP', 'map.target': 'Target: {name}',
    'map.legend': 'Yellow ring = target · triangle = ship · arrow = velocity',
    'map.hint': 'Scroll to zoom · V to close',
    // --- target list (T) ---
    'tlist.title': 'SELECT TARGET',
    'tlist.hint': 'Click a row or press 1-9 · Esc / T to close',
    'help.html': `<b>CONTROLS</b> &nbsp;·&nbsp; <span>X</span> = STOP (brake) &nbsp;·&nbsp; <span>H</span> full help
      <div class="keys"><span>Mouse</span> look &nbsp; <span>W/S</span> forward/back &nbsp; <span>A D R F</span> slide &nbsp; <span>Q/E</span> roll &nbsp; <span>1–9/0</span> power (log, 1≈1g…9≈1000g arcade; realistic ≈3–15g) &nbsp; <span>[ ]</span> trim &nbsp; <span>Tab</span> target &nbsp; <span>G</span> jump &nbsp; <span>,/.</span> time &nbsp; <span>P</span> pause &nbsp; <span>K</span> circularize &nbsp; <span>M</span> fuel &nbsp; <span>⌫</span> reset &nbsp; <span>O/L/B/C</span> orbits/labels/glow/relativity</div>`,
    // units
    'u.m': ' m', 'u.km': ' km', 'u.AU': ' AU', 'u.ly': ' ly', 'u.ms': ' m/s', 'u.kms': ' km/s',
    'u.s': ' s', 'u.min': ' min', 'u.h': ' h', 'u.d': ' d', 'u.yr': ' yr',
  },

  ru: {
    'start.sub': 'Релятивистский полёт от первого лица · настоящая Солнечная система',
    'start.intro': `Вы начинаете на <b>орбите вокруг Земли</b>. В космосе нет воздуха
      и нет «низа». Корабль летит сам по инерции — дали тягу, и он летит, пока вы
      не дадите тягу в другую сторону. Чтобы затормозить — развернитесь и дайте
      тягу, или просто нажмите <b>X</b> (стоп). Гравитация настоящая: подлетите
      слишком близко и медленно к планете — упадёте на неё.`,
    'start.controls': `
      <div class="cline"><b>Двигайте мышью</b> — осмотреться / навести нос корабля.</div>
      <div class="cline"><b>W</b> — двигатель вперёд (разгон). &nbsp; <b>S</b> — двигатель назад (торможение / задний ход).</div>
      <div class="cline"><b>A · D</b> — сместиться влево / вправо. &nbsp; <b>R · F</b> — вверх / вниз.</div>
      <div class="cline"><b>1…9</b> — мощность двигателя, логарифмическая шкала (1≈1 g … 9≈1000 g в аркаде; в реализме упирается в предел тяги корабля ≈3–15 g, <b>0</b> = выключен). &nbsp; <b>[ · ]</b> — подстройка мощности вниз / вверх. &nbsp; <b>Q · E</b> — крен (наклон вбок).</div>
      <div class="cline"><b>X</b> — <b>СТОП</b>: погасить весь дрейф и вращение (это ваш «тормоз»). &nbsp; <b>K</b> — выйти на круговую орбиту вокруг ближайшего тела.</div>
      <div class="cline"><b>Tab</b> — выбрать, куда лететь (Солнце / планета / луна). &nbsp; <b>G</b> — мгновенно перенестись к ней.</div>
      <div class="cline"><b>.</b> / <b>,</b> — ускорить / замедлить время (смотреть, как движутся планеты, или покрывать огромные расстояния). &nbsp; <b>P</b> — пауза.</div>
      <div class="cline"><b>M</b> — переключить бесконечное ↔ реальное ограниченное топливо. &nbsp; <b>⌫ Backspace</b> — начать заново у Земли.</div>`,
    'start.tip': `<b>Никогда не летали? Попробуйте так:</b> нажимайте <b>Tab</b>, пока
      цель не станет «Луна», затем <b>G</b> — перенесётесь к ней. Или наведитесь на
      Землю, держите <b>W</b> и следите за часами: у скорости света ваши часы идут
      медленнее «мировых» — это настоящая физика.`,
    'start.launch': '▶ Старт (клик — захватить мышь)',

    'hud.speed': 'СКОРОСТЬ', 'hud.gamma': 'γ (растяжение времени)', 'hud.dilation': 'ЗАМЕДЛЕНИЕ ВРЕМЕНИ',
    'hud.accel': 'ПЕРЕГРУЗКА', 'hud.mode': 'РЕЖИМ', 'hud.throttle': 'МОЩНОСТЬ',
    'hud.fuel': 'ТОПЛИВО', 'hud.ref': 'БЛИЖАЙШЕЕ ТЕЛО', 'hud.alt': 'ВЫСОТА', 'hud.atmo': 'ВОЗДУХ',
    'nav.target': 'ЦЕЛЬ', 'nav.distance': 'РАССТОЯНИЕ', 'nav.eta': 'ВРЕМЯ В ПУТИ',
    'nav.simtime': 'ВРЕМЯ МИРА', 'nav.shiptime': 'ВАШЕ ВРЕМЯ', 'nav.warp': 'СКОРОСТЬ ВРЕМЕНИ', 'nav.fps': 'FPS',
    'nav.periapsis': 'ПЕРИГЕЙ', 'nav.apoapsis': 'АПОГЕЙ', 'nav.closespeed': 'СКОРОСТЬ СБЛИЖЕНИЯ',
    'nav.closedist': 'МИН. СБЛИЖЕНИЕ', 'nav.closeeta': 'ВРЕМЯ ДО СБЛИЖЕНИЯ',
    'nav.impact': 'падение', 'nav.escape': 'уход', 'nav.receding': 'удаляется',

    'mode.arcade': 'АРКАДА · бесконечное топливо', 'mode.realistic': 'РЕАЛИЗМ · ограниченное топливо',
    'val.infinite': 'бесконечно',
    'dyn.dilation': '1 с у вас = {g} с в мире',
    'dyn.atmoIn': '{rho} кг/м³ (в воздухе)', 'dyn.vacuum': 'вакуум (воздуха нет)',
    'dyn.dvleft': '· запас скорости {v}',
    'st.coasting': 'ПОЛЁТ ПО ИНЕРЦИИ (двигатель выкл.)', 'st.burning': 'ДВИГАТЕЛЬ ВКЛ. · {g} g',
    'st.atmo': 'ПОЛЁТ В ВОЗДУХЕ', 'st.ref': 'рядом {name}',
    'st.landed': 'ПОСАДКА на {name} · нажмите W / Space для взлёта',
    'st.crashed': 'КРУШЕНИЕ на {name} · нажмите W / Space для взлёта',
    'st.warpHeld': 'время авто-замедлено (близко к телу / двигатель вкл.)',
    'ev.online': 'Системы в норме · орбита Земли. Кликните, чтобы начать.',
    'ev.mode': 'Топливо: {m}', 'ev.target': 'Цель: {name}', 'ev.jumped': 'Перенос к {name}',
    'ev.warp': 'Скорость времени {x}×', 'ev.drift': 'Стоп — уравнялись с {name}', 'ev.stopped': 'Стоп',
    'ev.reset': 'Сброс к Земле', 'ev.orbits': 'Линии орбит {s}', 'ev.labels': 'Подписи {s}',
    'ev.bloom': 'Свечение {s}', 'ev.relfx': 'Релятивистская оптика {s}', 'ev.liftoff': 'Взлёт с {name}',
    'ev.pause': 'Пауза', 'ev.resume': 'Продолжено', 'ev.circularize': 'Орбита скруглена вокруг {name}',
    'ev.touchdown': '🛬 Посадка на {name} · {spd} — нажмите W / Space для взлёта',
    'ev.crash': '💥 КРУШЕНИЕ о {name} на {spd} — нажмите W / Space для взлёта, ⌫ для сброса',
    'ev.bloomAuto': 'Свечение выключено (низкий FPS) — нажмите B, чтобы вернуть',
    'ev.enterAtmo': 'Вход в атмосферу: {name}', 'ev.leftAtmo': 'Покинули атмосферу: {name}',
    'w.on': 'вкл.', 'w.off': 'выкл.',
    // --- карта системы (V) ---
    'map.title': 'КАРТА СИСТЕМЫ', 'map.target': 'Цель: {name}',
    'map.legend': 'Жёлтое кольцо = цель · треугольник = корабль · стрелка = скорость',
    'map.hint': 'Колесо мыши — зум · V — закрыть',
    // --- список целей (T) ---
    'tlist.title': 'ВЫБОР ЦЕЛИ',
    'tlist.hint': 'Клик по строке или 1-9 · Esc / T — закрыть',
    'help.html': `<b>УПРАВЛЕНИЕ</b> &nbsp;·&nbsp; <span>X</span> = СТОП (тормоз) &nbsp;·&nbsp; <span>H</span> вся справка
      <div class="keys"><span>Мышь</span> обзор &nbsp; <span>W/S</span> вперёд/назад &nbsp; <span>A D R F</span> сдвиг &nbsp; <span>Q/E</span> крен &nbsp; <span>1–9/0</span> мощность (лог., 1≈1g…9≈1000g аркада; реализм ≈3–15g) &nbsp; <span>[ ]</span> подстройка &nbsp; <span>Tab</span> цель &nbsp; <span>G</span> прыжок &nbsp; <span>,/.</span> время &nbsp; <span>P</span> пауза &nbsp; <span>K</span> круговая орбита &nbsp; <span>M</span> топливо &nbsp; <span>⌫</span> сброс &nbsp; <span>O/L/B/C</span> орбиты/подписи/свечение/релятивизм</div>`,
    'u.m': ' м', 'u.km': ' км', 'u.AU': ' а.е.', 'u.ly': ' св.лет', 'u.ms': ' м/с', 'u.kms': ' км/с',
    'u.s': ' с', 'u.min': ' мин', 'u.h': ' ч', 'u.d': ' дн', 'u.yr': ' лет',
  },
};

let lang = localStorage.getItem('iss_lang') || (navigator.language || 'en').slice(0, 2);
if (!DICT[lang]) lang = 'en';

export function getLang() { return lang; }
export function bodyName(n) { return (NAMES[lang] && NAMES[lang][n]) || n; }

export function t(key, vars) {
  let s = (DICT[lang] && DICT[lang][key]);
  if (s == null) s = DICT.en[key] != null ? DICT.en[key] : key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

export function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-lang]').forEach((el) => el.classList.toggle('active', el.dataset.lang === lang));
}

export function setLang(l) {
  if (!DICT[l]) return;
  lang = l; localStorage.setItem('iss_lang', l); applyStatic();
}

// ---- localized formatters (shared by HUD + overlay) ----
export function fmtDist(m) {
  const a = Math.abs(m);
  if (a < 1e3) return m.toFixed(0) + t('u.m');
  if (a < 0.01 * AU) return (m / 1e3).toFixed(0) + t('u.km');
  if (a < 1000 * AU) return (m / AU).toFixed(3) + t('u.AU');
  return (m / (C * YEAR)).toExponential(2) + t('u.ly');
}
export function fmtSpeed(v) {
  const a = Math.abs(v);
  if (a < 1e3) return v.toFixed(1) + t('u.ms');
  if (a < 1e6) return (v / 1e3).toFixed(1) + t('u.kms');
  return (v / C * 100).toFixed(4) + ' %c';
}
export function fmtTime(s) {
  const a = Math.abs(s);
  if (a < 120) return s.toFixed(1) + t('u.s');
  if (a < 7200) return (s / 60).toFixed(1) + t('u.min');
  if (a < 2 * 86400) return (s / 3600).toFixed(2) + t('u.h');
  if (a < 2 * YEAR) return (s / 86400).toFixed(2) + t('u.d');
  return (s / YEAR).toFixed(3) + t('u.yr');
}
