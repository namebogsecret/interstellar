// The 50 nearest known individual stars and brown dwarfs (Sun excluded), by distance, light-years.
// HONESTY NOTE: compiled by hand from memory of the RECONS 10-pc census and the Wikipedia list
// "List of nearest stars and brown dwarfs" (parallaxes: Gaia DR3 / Hipparcos / ground-based, epoch
// ~J2016); NOT cross-checked against the live catalogue. The cutoff is ~14 ly (last entry: van
// Maanen's Star); the last positions may differ from an authoritative list. Distances are rounded
// to the precision those lists give (about 0.01 ly), uncertainty roughly 0.1-1%.
// Components of one system share the system distance, so the order is non-decreasing (ties only
// inside a system, kept in catalogue order). Spectral types are literature types (RECONS / SIMBAD).
// Less certain values: Luhman 16 (6.50), WISE 0855-0714 (7.43, Y4), SCR 1845-6357 A/B (12.57),
// UGPS 0722-0540 (13.4, T9), DENIS 1048-3956 (13.2), AX Microscopii (12.95), and the sub-types of
// EZ Aquarii B/C (group M is certain, "M5Ve" is approximate); Kapteyn's Star is "sdM1".
// POSITIONS (ra, dec, vmag; added for porthole.html): J2000 equatorial coordinates in degrees and apparent
// visual magnitude V, ALSO recalled from memory / the same reference lists (SIMBAD / Wikipedia style values),
// NOT checked against the live catalogue. Right ascension is rounded to ~0.001 deg, declination likewise; proper
// motion is ignored (epoch J2000, error up to ~0.1 deg for Barnard's Star and a few others over the epoch gap).
// Components of one system share (or nearly share) the position; wide pairs (61 Cyg, Eps Indi B) differ by < 0.2 deg.
// vmag = null for brown dwarfs with no usable V (Luhman 16, WISE 0855, Eps Indi Ba/Bb, SCR 1845 B, UGPS 0722);
// V of very faint M/L dwarfs (SCR 1845 A, DENIS 1048) is approximate. Good enough for a sky picture, not astrometry.
// Fields: id, name, ru ('' if none), ly, ra, dec, vmag, spectral, system, ref = matching js/data/stars.js name
// (that list is by system; null = star not in stars.js).
export const NEIGHBORS = [
  { id: 'proxima', name: 'Proxima Centauri', ru: 'Проксима Центавра', ly: 4.2465, ra: 217.429, dec: -62.68, vmag: 11.13, spectral: 'M5.5Ve', system: 'Alpha Centauri', ref: 'Proxima Centauri' },
  { id: 'alpha-cen-a', name: 'Alpha Centauri A', ru: 'Альфа Центавра A', ly: 4.344, ra: 219.902, dec: -60.834, vmag: 0.01, spectral: 'G2V', system: 'Alpha Centauri', ref: 'Alpha Centauri A/B' },
  { id: 'alpha-cen-b', name: 'Alpha Centauri B', ru: 'Альфа Центавра B', ly: 4.344, ra: 219.896, dec: -60.838, vmag: 1.33, spectral: 'K1V', system: 'Alpha Centauri', ref: 'Alpha Centauri A/B' },
  { id: 'barnard', name: "Barnard's Star", ru: 'Звезда Барнарда', ly: 5.963, ra: 269.452, dec: 4.693, vmag: 9.51, spectral: 'M4Ve', system: "Barnard's Star", ref: "Barnard's Star" },
  { id: 'luhman16-a', name: 'Luhman 16 A', ru: 'Лухман 16 A', ly: 6.5, ra: 162.328, dec: -53.319, vmag: null, spectral: 'L7.5', system: 'Luhman 16', ref: null },
  { id: 'luhman16-b', name: 'Luhman 16 B', ru: 'Лухман 16 B', ly: 6.5, ra: 162.328, dec: -53.319, vmag: null, spectral: 'T0.5', system: 'Luhman 16', ref: null },
  { id: 'wise0855', name: 'WISE 0855-0714', ru: '', ly: 7.43, ra: 133.795, dec: -7.245, vmag: null, spectral: 'Y4', system: 'WISE 0855-0714', ref: null },
  { id: 'wolf359', name: 'Wolf 359', ru: 'Вольф 359', ly: 7.86, ra: 164.121, dec: 7.015, vmag: 13.54, spectral: 'M6.5Ve', system: 'Wolf 359', ref: 'Wolf 359' },
  { id: 'lalande21185', name: 'Lalande 21185', ru: 'Лаланд 21185', ly: 8.31, ra: 165.834, dec: 35.97, vmag: 7.52, spectral: 'M2V', system: 'Lalande 21185', ref: 'Lalande 21185' },
  { id: 'sirius-a', name: 'Sirius A', ru: 'Сириус A', ly: 8.6, ra: 101.287, dec: -16.716, vmag: -1.46, spectral: 'A1V', system: 'Sirius', ref: 'Sirius A/B' },
  { id: 'sirius-b', name: 'Sirius B', ru: 'Сириус B', ly: 8.6, ra: 101.287, dec: -16.716, vmag: 8.44, spectral: 'DA2', system: 'Sirius', ref: 'Sirius A/B' },
  { id: 'bl-ceti', name: 'BL Ceti (Luyten 726-8 A)', ru: 'BL Кита', ly: 8.73, ra: 24.756, dec: -17.95, vmag: 12.54, spectral: 'M5.5Ve', system: 'Luyten 726-8', ref: 'Luyten 726-8' },
  { id: 'uv-ceti', name: 'UV Ceti (Luyten 726-8 B)', ru: 'UV Кита', ly: 8.73, ra: 24.756, dec: -17.95, vmag: 13.02, spectral: 'M6Ve', system: 'Luyten 726-8', ref: 'Luyten 726-8' },
  { id: 'ross154', name: 'Ross 154', ru: 'Росс 154', ly: 9.69, ra: 282.456, dec: -23.837, vmag: 10.44, spectral: 'M3.5Ve', system: 'Ross 154', ref: 'Ross 154' },
  { id: 'ross248', name: 'Ross 248', ru: 'Росс 248', ly: 10.3, ra: 355.479, dec: 44.176, vmag: 12.29, spectral: 'M6Ve', system: 'Ross 248', ref: 'Ross 248' },
  { id: 'eps-eri', name: 'Epsilon Eridani', ru: 'Эпсилон Эридана', ly: 10.47, ra: 53.233, dec: -9.458, vmag: 3.73, spectral: 'K2V', system: 'Epsilon Eridani', ref: 'Epsilon Eridani' },
  { id: 'lacaille9352', name: 'Lacaille 9352', ru: 'Лакайль 9352', ly: 10.72, ra: 346.467, dec: -35.853, vmag: 7.34, spectral: 'M0.5V', system: 'Lacaille 9352', ref: null },
  { id: 'ross128', name: 'Ross 128', ru: 'Росс 128', ly: 11.01, ra: 176.935, dec: 0.801, vmag: 11.13, spectral: 'M4V', system: 'Ross 128', ref: null },
  { id: 'ez-aqr-a', name: 'EZ Aquarii A', ru: 'EZ Водолея A', ly: 11.11, ra: 339.639, dec: -15.297, vmag: 13.33, spectral: 'M5Ve', system: 'EZ Aquarii', ref: 'EZ Aquarii' },
  { id: 'ez-aqr-b', name: 'EZ Aquarii B', ru: 'EZ Водолея B', ly: 11.11, ra: 339.639, dec: -15.297, vmag: 13.27, spectral: 'M5Ve', system: 'EZ Aquarii', ref: 'EZ Aquarii' },
  { id: 'ez-aqr-c', name: 'EZ Aquarii C', ru: 'EZ Водолея C', ly: 11.11, ra: 339.639, dec: -15.297, vmag: 14.03, spectral: 'M5Ve', system: 'EZ Aquarii', ref: 'EZ Aquarii' },
  { id: '61cyg-a', name: '61 Cygni A', ru: '61 Лебедя A', ly: 11.4, ra: 316.725, dec: 38.749, vmag: 5.2, spectral: 'K5V', system: '61 Cygni', ref: '61 Cygni' },
  { id: '61cyg-b', name: '61 Cygni B', ru: '61 Лебедя B', ly: 11.4, ra: 316.73, dec: 38.742, vmag: 6.05, spectral: 'K7V', system: '61 Cygni', ref: '61 Cygni' },
  { id: 'procyon-a', name: 'Procyon A', ru: 'Процион A', ly: 11.46, ra: 114.825, dec: 5.225, vmag: 0.34, spectral: 'F5IV-V', system: 'Procyon', ref: 'Procyon A/B' },
  { id: 'procyon-b', name: 'Procyon B', ru: 'Процион B', ly: 11.46, ra: 114.825, dec: 5.225, vmag: 10.7, spectral: 'DQZ', system: 'Procyon', ref: 'Procyon A/B' },
  { id: 'struve2398-a', name: 'Struve 2398 A', ru: 'Струве 2398 A', ly: 11.5, ra: 280.695, dec: 59.63, vmag: 8.9, spectral: 'M3V', system: 'Struve 2398', ref: 'Struve 2398' },
  { id: 'struve2398-b', name: 'Struve 2398 B', ru: 'Струве 2398 B', ly: 11.5, ra: 280.695, dec: 59.63, vmag: 9.69, spectral: 'M3.5V', system: 'Struve 2398', ref: 'Struve 2398' },
  { id: 'groombridge34-a', name: 'Groombridge 34 A', ru: 'Грумбридж 34 A', ly: 11.62, ra: 4.595, dec: 44.023, vmag: 8.08, spectral: 'M1.5V', system: 'Groombridge 34', ref: 'Groombridge 34' },
  { id: 'groombridge34-b', name: 'Groombridge 34 B', ru: 'Грумбридж 34 B', ly: 11.62, ra: 4.595, dec: 44.023, vmag: 11.06, spectral: 'M3.5V', system: 'Groombridge 34', ref: 'Groombridge 34' },
  { id: 'dx-cnc', name: 'DX Cancri', ru: 'DX Рака', ly: 11.68, ra: 127.206, dec: 26.776, vmag: 14.78, spectral: 'M6.5V', system: 'DX Cancri', ref: 'DX Cancri' },
  { id: 'eps-ind-a', name: 'Epsilon Indi A', ru: 'Эпсилон Индейца A', ly: 11.87, ra: 330.84, dec: -56.786, vmag: 4.69, spectral: 'K5V', system: 'Epsilon Indi', ref: 'Epsilon Indi' },
  { id: 'eps-ind-ba', name: 'Epsilon Indi Ba', ru: 'Эпсилон Индейца Ba', ly: 11.87, ra: 331.044, dec: -56.786, vmag: null, spectral: 'T1', system: 'Epsilon Indi', ref: null },
  { id: 'eps-ind-bb', name: 'Epsilon Indi Bb', ru: 'Эпсилон Индейца Bb', ly: 11.87, ra: 331.044, dec: -56.786, vmag: null, spectral: 'T6', system: 'Epsilon Indi', ref: null },
  { id: 'tau-ceti', name: 'Tau Ceti', ru: 'Тау Кита', ly: 11.9, ra: 26.017, dec: -15.937, vmag: 3.5, spectral: 'G8V', system: 'Tau Ceti', ref: 'Tau Ceti' },
  { id: 'gj1061', name: 'Gliese 1061', ru: 'Глизе 1061', ly: 11.99, ra: 53.999, dec: -44.512, vmag: 13.03, spectral: 'M5.5V', system: 'Gliese 1061', ref: 'Gliese 1061' },
  { id: 'yz-ceti', name: 'YZ Ceti', ru: 'YZ Кита', ly: 12.11, ra: 18.128, dec: -16.996, vmag: 12.02, spectral: 'M4.5V', system: 'YZ Ceti', ref: null },
  { id: 'luyten-star', name: "Luyten's Star (GJ 273)", ru: 'Звезда Лейтена', ly: 12.35, ra: 111.851, dec: 5.225, vmag: 9.86, spectral: 'M3.5V', system: "Luyten's Star", ref: null },
  { id: 'teegarden', name: "Teegarden's Star", ru: 'Звезда Тигардена', ly: 12.5, ra: 43.254, dec: 16.878, vmag: 15.14, spectral: 'M7V', system: "Teegarden's Star", ref: null },
  { id: 'scr1845-a', name: 'SCR 1845-6357 A', ru: '', ly: 12.57, ra: 281.272, dec: -63.959, vmag: 17.4, spectral: 'M8.5V', system: 'SCR 1845-6357', ref: null },
  { id: 'scr1845-b', name: 'SCR 1845-6357 B', ru: '', ly: 12.57, ra: 281.272, dec: -63.959, vmag: null, spectral: 'T6', system: 'SCR 1845-6357', ref: null },
  { id: 'kapteyn', name: "Kapteyn's Star", ru: 'Звезда Каптейна', ly: 12.83, ra: 77.919, dec: -45.019, vmag: 8.85, spectral: 'sdM1', system: "Kapteyn's Star", ref: null },
  { id: 'ax-mic', name: 'AX Microscopii (Lacaille 8760)', ru: 'AX Микроскопа', ly: 12.95, ra: 319.314, dec: -38.867, vmag: 6.67, spectral: 'M0V', system: 'AX Microscopii', ref: null },
  { id: 'kruger60-a', name: 'Kruger 60 A', ru: 'Крюгер 60 A', ly: 13.07, ra: 336.998, dec: 57.696, vmag: 9.79, spectral: 'M3V', system: 'Kruger 60', ref: null },
  { id: 'kruger60-b', name: 'Kruger 60 B', ru: 'Крюгер 60 B', ly: 13.07, ra: 336.998, dec: 57.696, vmag: 11.41, spectral: 'M4V', system: 'Kruger 60', ref: null },
  { id: 'den1048', name: 'DENIS 1048-3956', ru: '', ly: 13.2, ra: 162.061, dec: -39.936, vmag: 17.4, spectral: 'M8.5V', system: 'DENIS 1048-3956', ref: null },
  { id: 'ross614-a', name: 'Ross 614 A', ru: 'Росс 614 A', ly: 13.35, ra: 97.348, dec: -2.805, vmag: 11.15, spectral: 'M4.5V', system: 'Ross 614', ref: null },
  { id: 'ross614-b', name: 'Ross 614 B', ru: 'Росс 614 B', ly: 13.35, ra: 97.348, dec: -2.805, vmag: 14.23, spectral: 'M5.5V', system: 'Ross 614', ref: null },
  { id: 'ugps0722', name: 'UGPS 0722-0540', ru: '', ly: 13.4, ra: 110.614, dec: -5.678, vmag: null, spectral: 'T9', system: 'UGPS 0722-0540', ref: null },
  { id: 'wolf1061', name: 'Wolf 1061', ru: 'Вольф 1061', ly: 14.05, ra: 247.575, dec: -12.664, vmag: 10.07, spectral: 'M3V', system: 'Wolf 1061', ref: null },
  { id: 'van-maanen', name: "van Maanen's Star", ru: 'Звезда ван Маанена', ly: 14.07, ra: 12.291, dec: 5.389, vmag: 12.37, spectral: 'DZ7', system: "van Maanen's Star", ref: null },
];
