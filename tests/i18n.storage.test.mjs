import assert from 'node:assert/strict';
import { getLang, t } from '../js/i18n.js';

// Node has neither `localStorage` nor a browser `navigator` global — this is
// exactly the "storage entirely inaccessible" case (private-mode browsers
// throw on *access*, not just on write). Import succeeding at all IS the test.
const lang = getLang();
assert.ok(lang === 'en' || lang === 'ru', `getLang() fell back to a known lang, got ${lang}`);
assert.equal(typeof t('hud.speed'), 'string');
assert.ok(t('hud.speed').length > 0);
console.log('i18n.storage.test.mjs OK');
