// The 50 nearest known individual stars and brown dwarfs (Sun excluded), by distance, light-years.
// SOURCE: compiled from the RECONS 10-pc census and the Wikipedia "List of nearest stars and brown
// dwarfs" (parallax distances, Gaia DR3 / Hipparcos / ground-based; epoch ~J2016). Distances are
// rounded to the precision those lists give (0.01 ly, a few better), uncertainty roughly 0.1-1%.
// Components of one system share the system distance, so the order is non-decreasing (ties only
// inside a system, kept in catalogue order). Spectral types are literature types (RECONS / SIMBAD).
// NOT guaranteed complete: faint objects near the ~15 ly cutoff may be missing; the Y dwarf
// WISE 0855-0714 (7.4 ly) is left out because the page has no Y group. Values less certain than
// the rest: Gliese 674 (14.85 vs GJ 687 14.84, order at the cutoff), DENIS 1048-3956 (13.2),
// Luhman 16 (6.50), EZ Aquarii A (companions B/C omitted), Kapteyn's Star (sdM1).
// Fields: id, name, ru ('' if none), ly, spectral, system, ref = matching js/data/stars.js name
// (that list is by system; null = star not in stars.js).
export const NEIGHBORS = [
  { id: 'proxima', name: 'Proxima Centauri', ru: 'Проксима Центавра', ly: 4.2465, spectral: 'M5.5Ve', system: 'Alpha Centauri', ref: 'Proxima Centauri' },
  { id: 'alpha-cen-a', name: 'Alpha Centauri A', ru: 'Альфа Центавра A', ly: 4.344, spectral: 'G2V', system: 'Alpha Centauri', ref: 'Alpha Centauri A/B' },
  { id: 'alpha-cen-b', name: 'Alpha Centauri B', ru: 'Альфа Центавра B', ly: 4.344, spectral: 'K1V', system: 'Alpha Centauri', ref: 'Alpha Centauri A/B' },
  { id: 'barnard', name: "Barnard's Star", ru: 'Звезда Барнарда', ly: 5.963, spectral: 'M4Ve', system: "Barnard's Star", ref: "Barnard's Star" },
  { id: 'luhman16-a', name: 'Luhman 16 A', ru: 'Лухман 16 A', ly: 6.5, spectral: 'L7.5', system: 'Luhman 16', ref: null },
  { id: 'luhman16-b', name: 'Luhman 16 B', ru: 'Лухман 16 B', ly: 6.5, spectral: 'T0.5', system: 'Luhman 16', ref: null },
  { id: 'wolf359', name: 'Wolf 359', ru: 'Вольф 359', ly: 7.86, spectral: 'M6.5Ve', system: 'Wolf 359', ref: 'Wolf 359' },
  { id: 'lalande21185', name: 'Lalande 21185', ru: 'Лаланд 21185', ly: 8.31, spectral: 'M2V', system: 'Lalande 21185', ref: 'Lalande 21185' },
  { id: 'sirius-a', name: 'Sirius A', ru: 'Сириус A', ly: 8.6, spectral: 'A1V', system: 'Sirius', ref: 'Sirius A/B' },
  { id: 'sirius-b', name: 'Sirius B', ru: 'Сириус B', ly: 8.6, spectral: 'DA2', system: 'Sirius', ref: 'Sirius A/B' },
  { id: 'bl-ceti', name: 'BL Ceti (Luyten 726-8 A)', ru: 'BL Кита', ly: 8.73, spectral: 'M5.5Ve', system: 'Luyten 726-8', ref: 'Luyten 726-8' },
  { id: 'uv-ceti', name: 'UV Ceti (Luyten 726-8 B)', ru: 'UV Кита', ly: 8.73, spectral: 'M6Ve', system: 'Luyten 726-8', ref: 'Luyten 726-8' },
  { id: 'ross154', name: 'Ross 154', ru: 'Росс 154', ly: 9.69, spectral: 'M3.5Ve', system: 'Ross 154', ref: 'Ross 154' },
  { id: 'ross248', name: 'Ross 248', ru: 'Росс 248', ly: 10.3, spectral: 'M5.5Ve', system: 'Ross 248', ref: 'Ross 248' },
  { id: 'eps-eri', name: 'Epsilon Eridani', ru: 'Эпсилон Эридана', ly: 10.47, spectral: 'K2V', system: 'Epsilon Eridani', ref: 'Epsilon Eridani' },
  { id: 'lacaille9352', name: 'Lacaille 9352', ru: 'Лакайль 9352', ly: 10.72, spectral: 'M0.5V', system: 'Lacaille 9352', ref: null },
  { id: 'ross128', name: 'Ross 128', ru: 'Росс 128', ly: 11.01, spectral: 'M4V', system: 'Ross 128', ref: null },
  { id: 'ez-aqr-a', name: 'EZ Aquarii A', ru: 'EZ Водолея A', ly: 11.11, spectral: 'M5Ve', system: 'EZ Aquarii', ref: 'EZ Aquarii' },
  { id: '61cyg-a', name: '61 Cygni A', ru: '61 Лебедя A', ly: 11.4, spectral: 'K5V', system: '61 Cygni', ref: '61 Cygni' },
  { id: '61cyg-b', name: '61 Cygni B', ru: '61 Лебедя B', ly: 11.4, spectral: 'K7V', system: '61 Cygni', ref: '61 Cygni' },
  { id: 'procyon-a', name: 'Procyon A', ru: 'Процион A', ly: 11.46, spectral: 'F5IV-V', system: 'Procyon', ref: 'Procyon A/B' },
  { id: 'procyon-b', name: 'Procyon B', ru: 'Процион B', ly: 11.46, spectral: 'DQZ', system: 'Procyon', ref: 'Procyon A/B' },
  { id: 'struve2398-a', name: 'Struve 2398 A', ru: 'Струве 2398 A', ly: 11.5, spectral: 'M3V', system: 'Struve 2398', ref: 'Struve 2398' },
  { id: 'struve2398-b', name: 'Struve 2398 B', ru: 'Струве 2398 B', ly: 11.5, spectral: 'M3.5V', system: 'Struve 2398', ref: 'Struve 2398' },
  { id: 'groombridge34-a', name: 'Groombridge 34 A', ru: 'Гроомбридж 34 A', ly: 11.62, spectral: 'M1.5V', system: 'Groombridge 34', ref: 'Groombridge 34' },
  { id: 'groombridge34-b', name: 'Groombridge 34 B', ru: 'Гроомбридж 34 B', ly: 11.62, spectral: 'M3.5V', system: 'Groombridge 34', ref: 'Groombridge 34' },
  { id: 'dx-cnc', name: 'DX Cancri', ru: 'DX Рака', ly: 11.68, spectral: 'M6.5V', system: 'DX Cancri', ref: 'DX Cancri' },
  { id: 'eps-ind-a', name: 'Epsilon Indi A', ru: 'Эпсилон Индейца A', ly: 11.87, spectral: 'K5V', system: 'Epsilon Indi', ref: 'Epsilon Indi' },
  { id: 'eps-ind-ba', name: 'Epsilon Indi Ba', ru: 'Эпсилон Индейца Ba', ly: 11.87, spectral: 'T1', system: 'Epsilon Indi', ref: null },
  { id: 'eps-ind-bb', name: 'Epsilon Indi Bb', ru: 'Эпсилон Индейца Bb', ly: 11.87, spectral: 'T6', system: 'Epsilon Indi', ref: null },
  { id: 'tau-ceti', name: 'Tau Ceti', ru: 'Тау Кита', ly: 11.9, spectral: 'G8V', system: 'Tau Ceti', ref: 'Tau Ceti' },
  { id: 'gj1061', name: 'Gliese 1061', ru: 'Глизе 1061', ly: 11.99, spectral: 'M5.5V', system: 'Gliese 1061', ref: 'Gliese 1061' },
  { id: 'yz-ceti', name: 'YZ Ceti', ru: 'YZ Кита', ly: 12.11, spectral: 'M4.5V', system: 'YZ Ceti', ref: null },
  { id: 'luyten-star', name: "Luyten's Star (GJ 273)", ru: 'Звезда Лейтена', ly: 12.35, spectral: 'M3.5V', system: "Luyten's Star", ref: null },
  { id: 'teegarden', name: "Teegarden's Star", ru: 'Звезда Тигардена', ly: 12.5, spectral: 'M7V', system: "Teegarden's Star", ref: null },
  { id: 'kapteyn', name: "Kapteyn's Star", ru: 'Звезда Каптейна', ly: 12.83, spectral: 'sdM1', system: "Kapteyn's Star", ref: null },
  { id: 'ax-mic', name: 'AX Microscopii (Lacaille 8760)', ru: 'AX Микроскопа', ly: 12.87, spectral: 'M0V', system: 'AX Microscopii', ref: null },
  { id: 'kruger60-a', name: 'Kruger 60 A', ru: 'Крюгер 60 A', ly: 13.07, spectral: 'M3V', system: 'Kruger 60', ref: null },
  { id: 'kruger60-b', name: 'Kruger 60 B', ru: 'Крюгер 60 B', ly: 13.07, spectral: 'M4V', system: 'Kruger 60', ref: null },
  { id: 'den1048', name: 'DENIS 1048-3956', ru: '', ly: 13.2, spectral: 'M8.5V', system: 'DENIS 1048-3956', ref: null },
  { id: 'ross614-a', name: 'Ross 614 A', ru: 'Росс 614 A', ly: 13.35, spectral: 'M4.5V', system: 'Ross 614', ref: null },
  { id: 'ross614-b', name: 'Ross 614 B', ru: 'Росс 614 B', ly: 13.35, spectral: 'M5.5V', system: 'Ross 614', ref: null },
  { id: 'wolf1061', name: 'Wolf 1061', ru: 'Вольф 1061', ly: 14.05, spectral: 'M3V', system: 'Wolf 1061', ref: null },
  { id: 'van-maanen', name: "van Maanen's Star", ru: 'Звезда ван Маанена', ly: 14.07, spectral: 'DZ7', system: "van Maanen's Star", ref: null },
  { id: 'gj1', name: 'Gliese 1', ru: 'Глизе 1', ly: 14.23, spectral: 'M1.5V', system: 'Gliese 1', ref: null },
  { id: 'wolf424-a', name: 'Wolf 424 A', ru: 'Вольф 424 A', ly: 14.31, spectral: 'M5.5Ve', system: 'Wolf 424', ref: null },
  { id: 'wolf424-b', name: 'Wolf 424 B', ru: 'Вольф 424 B', ly: 14.31, spectral: 'M7Ve', system: 'Wolf 424', ref: null },
  { id: 'tz-ari', name: 'TZ Arietis', ru: 'TZ Овна', ly: 14.58, spectral: 'M4.5V', system: 'TZ Arietis', ref: null },
  { id: 'gj687', name: 'Gliese 687', ru: 'Глизе 687', ly: 14.84, spectral: 'M3V', system: 'Gliese 687', ref: null },
  { id: 'gj674', name: 'Gliese 674', ru: 'Глизе 674', ly: 14.85, spectral: 'M2.5V', system: 'Gliese 674', ref: null },
];
