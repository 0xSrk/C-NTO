import { COVERAGE_ESTIMATE_NOTE } from '@/engine/calendarCoverage';
import { tr } from '@/i18n';

/**
 * Titres et notes du calendrier dans la langue du desk. Tirés du Calendrier (OROS5.4) : le Calendrier, le châssis, le
 * design et le Bot les lisent ici, sans importer un module. Le français est la clé ; un rappel saisi, ou le titre qu'une
 * source étrangère écrit dans sa langue (la BEA), reste tel quel.
 */

/** Titres du calendrier moteur (`src/engine/calendar.ts`) et des sources embarquées, en anglais et en espagnol. */
const EVENT_TITLE: Record<string, [string, string]> = {
  'Nouvel An': ['New Year', 'Año Nuevo'],
  Noël: ['Christmas', 'Navidad'],
  'Décision FOMC · taux directeurs': ['FOMC decision · policy rates', 'Decisión FOMC · tipos oficiales'],
  'Minutes du FOMC': ['FOMC minutes', 'Actas del FOMC'],
  'Décision FOMC (estimée)': ['FOMC decision (estimated)', 'Decisión FOMC (estimada)'],
  'Rapport emploi US (NFP)': ['US employment report (NFP)', 'Informe de empleo US (NFP)'],
  'Inflation CPI': ['CPI inflation', 'Inflación CPI'],
  'Prix à la production (PPI)': ['Producer prices (PPI)', 'Precios a la producción (PPI)'],
  'Inflation PCE · revenus & dépenses': ['PCE inflation · income & spending', 'Inflación PCE · ingresos y gasto'],
  'ISM Manufacturier': ['ISM Manufacturing', 'ISM Manufacturero'],
  'ISM Services': ['ISM Services', 'ISM Servicios'],
  'Ventes au détail': ['Retail sales', 'Ventas minoristas'],
  'Confiance Michigan (préliminaire)': ['Michigan sentiment (preliminary)', 'Confianza Michigan (preliminar)'],
  'Confiance des consommateurs (Conference Board)': ['Consumer confidence (Conference Board)', 'Confianza del consumidor (Conference Board)'],
  'PIB US (première estimation)': ['US GDP (advance estimate)', 'PIB US (primera estimación)'],
  'Fenêtre résultats mégacaps (MSFT · GOOGL · META · AAPL · AMZN)': ['Megacap earnings window (MSFT · GOOGL · META · AAPL · AMZN)', 'Ventana de resultados megacaps (MSFT · GOOGL · META · AAPL · AMZN)'],
  'Résultats NVIDIA (fenêtre estimée)': ['NVIDIA earnings (estimated window)', 'Resultados NVIDIA (ventana estimada)'],
  'Rollover NQ / MNQ → contrat suivant': ['NQ / MNQ rollover → next contract', 'Rollover NQ / MNQ → contrato siguiente'],
  'Expiration mensuelle des options': ['Monthly options expiration', 'Vencimiento mensual de opciones'],
  'Lendemain de Thanksgiving · clôture 13:15 ET': ['Day after Thanksgiving · close 13:15 ET', 'Día después de Thanksgiving · cierre 13:15 ET'],
  'New York passe à l’heure d’été · décalage Paris 5 h': ['New York switches to daylight time · Paris offset 5 h', 'Nueva York pasa al horario de verano · desfase París 5 h'],
  'Europe passe à l’heure d’été · décalage Paris 6 h': ['Europe switches to daylight time · Paris offset 6 h', 'Europa pasa al horario de verano · desfase París 6 h'],
  'Europe repasse à l’heure d’hiver · décalage Paris 5 h': ['Europe returns to standard time · Paris offset 5 h', 'Europa vuelve al horario de invierno · desfase París 5 h'],
  'New York repasse à l’heure d’hiver · décalage Paris 6 h': ['New York returns to standard time · Paris offset 6 h', 'Nueva York vuelve al horario de invierno · desfase París 6 h'],
  // Sources de l'instantané embarqué (electron/calendar) : titres écrits en français par le desk.
  'Stocks pétrole EIA': ['EIA crude oil inventories', 'Inventarios de petróleo EIA'],
  'Décision de politique monétaire BCE': ['ECB monetary policy decision', 'Decisión de política monetaria del BCE'],
};

/** Un titre dans les trois langues du desk : français (la clé), anglais, espagnol. */
export type TitleLanguages = readonly [fr: string, en: string, es: string];

/** Un jour férié : traduit s'il l'est, sinon son nom propre, le même dans les trois langues. */
function holiday(name: string): TitleLanguages {
  const row = EVENT_TITLE[name];
  return row ? [name, row[0], row[1]] : [name, name, name];
}

/** Les trois langues d'un titre du calendrier, ou `null` pour un titre que le desk n'a pas écrit (rappel, source étrangère). */
export function eventTitleLanguages(title: string): TitleLanguages | null {
  const expiry = /^Expiration trimestrielle ([A-Z0-9]+) \((.+)\)$/.exec(title);
  if (expiry) return [title, `Quarterly expiration ${expiry[1]} (${expiry[2]})`, `Vencimiento trimestral ${expiry[1]} (${expiry[2]})`];
  const roll = /^Rollover ([A-Z0-9]+) → contrat suivant$/.exec(title);
  if (roll) return [title, `Rollover ${roll[1]} → next contract`, `Rollover ${roll[1]} → contrato siguiente`];
  // Le Trésor : « Adjudication » et le nom du titre tel que le Trésor l'écrit (52-Week Bill, 10-Year Note…).
  const auction = /^Adjudication (.+)$/.exec(title);
  if (auction?.[1]) return [title, `${auction[1]} auction`, `Subasta ${auction[1]}`];
  const closed = /^(.+) · CME fermé$/.exec(title);
  if (closed?.[1]) {
    const [fr, en, es] = holiday(closed[1]);
    return [`${fr} · CME fermé`, `${en} · CME closed`, `${es} · CME cerrado`];
  }
  const early = /^(.+) · séance écourtée \(clôture 13:00 ET\)$/.exec(title);
  if (early?.[1]) {
    const [fr, en, es] = holiday(early[1]);
    return [`${fr} · séance écourtée (clôture 13:00 ET)`, `${en} · shortened session (close 13:00 ET)`, `${es} · sesión corta (cierre 13:00 ET)`];
  }
  const short = /^(.+) · séance écourtée$/.exec(title);
  if (short?.[1]) {
    const [fr, en, es] = holiday(short[1]);
    return [`${fr} · séance écourtée`, `${en} · shortened session`, `${es} · sesión corta`];
  }
  const row = EVENT_TITLE[title];
  return row ? [title, row[0], row[1]] : null;
}

/** Titres du calendrier, affichés dans la langue active. Les rappels saisis restent tels quels. */
export function trEventTitle(title: string): string {
  const row = eventTitleLanguages(title);
  return row ? tr(row[0], row[1], row[2]) : title;
}

/** Notes du calendrier moteur, en anglais et en espagnol ; le français est la clé. */
const EVENT_DESC: Record<string, [string, string]> = {
  [COVERAGE_ESTIMATE_NOTE]: [
    'Date estimated by rule: the desk does not know the official BLS calendar for this release. It may fall on another day; check bls.gov.',
    'Fecha estimada por regla: el desk no conoce el calendario oficial del BLS para esta publicación. Puede caer otro día; compruebe bls.gov.',
  ],
  'Communiqué du comité de politique monétaire puis conférence de presse du président de la Fed à 14:30 ET. Projections économiques (dot plot) en mars, juin, septembre et décembre.': ['Policy statement, then the Fed chair press conference at 14:30 ET. Economic projections (dot plot) in March, June, September, and December.', 'Comunicado del comité de política monetaria y luego rueda de prensa del presidente de la Fed a las 14:30 ET. Proyecciones económicas (dot plot) en marzo, junio, septiembre y diciembre.'],
  'Compte rendu détaillé de la réunion précédente, publié trois semaines après. Peut réévaluer la trajectoire des taux.': ['Detailed account of the previous meeting, released three weeks later. Can reprice the rate path.', 'Acta detallada de la reunión anterior, publicada tres semanas después. Puede reevaluar la trayectoria de tipos.'],
  'Réunion FOMC estimée par récurrence : vérifier le calendrier officiel de la Réserve fédérale.': ['FOMC meeting estimated by recurrence: check the Federal Reserve’s official calendar.', 'Reunión FOMC estimada por recurrencia: compruebe el calendario oficial de la Reserva Federal.'],
  'Créations d’emplois non agricoles, taux de chômage et salaires horaires. Date de publication BLS (Employment Situation, 8:30 ET).': ['Nonfarm payrolls, unemployment rate, and hourly earnings. BLS release date (Employment Situation, 8:30 ET).', 'Creación de empleo no agrícola, tasa de desempleo y salarios por hora. Fecha BLS (Employment Situation, 8:30 ET).'],
  'Date estimée hors calendrier BLS publié. Vérifier bls.gov avant un blackout : l’impact est plafonné tant que la date n’est pas confirmée.': ['Estimated date outside the published BLS calendar. Check bls.gov before a blackout: impact is capped until the date is confirmed.', 'Fecha estimada fuera del calendario BLS publicado. Compruebe bls.gov antes de un blackout: el impacto queda limitado hasta confirmar la fecha.'],
  'Indice des prix à la consommation (headline et core). Publié par le BLS autour de la deuxième semaine du mois.': ['Consumer price index (headline and core). Released by the BLS around the second week of the month.', 'Índice de precios al consumo (general y subyacente). Publicado por el BLS alrededor de la segunda semana del mes.'],
  'Inflation côté producteurs, souvent publiée le lendemain du CPI.': ['Producer-side inflation, often released the day after CPI.', 'Inflación del lado productor, a menudo publicada al día siguiente del CPI.'],
  'Mesure d’inflation privilégiée par la Fed, publiée en fin de mois avec les revenus et dépenses des ménages.': ['The Fed’s preferred inflation gauge, released at month-end with household income and spending.', 'Medida de inflación preferida por la Fed, publicada a fin de mes con ingresos y gasto de los hogares.'],
  'PMI manufacturier : activité, nouvelles commandes, prix payés. Premier jour ouvré du mois.': ['Manufacturing PMI: activity, new orders, prices paid. First business day of the month.', 'PMI manufacturero: actividad, nuevos pedidos, precios pagados. Primer día laborable del mes.'],
  'PMI des services, secteur dominant de l’économie américaine. Troisième jour ouvré du mois.': ['Services PMI, the dominant sector of the US economy. Third business day of the month.', 'PMI de servicios, sector dominante de la economía estadounidense. Tercer día laborable del mes.'],
  'Consommation des ménages, publiée vers le milieu du mois.': ['Household spending, released around mid-month.', 'Consumo de los hogares, publicado hacia mediados de mes.'],
  'Sentiment des consommateurs et anticipations d’inflation à 1 an / 5 ans.': ['Consumer sentiment and 1-year / 5-year inflation expectations.', 'Sentimiento del consumidor y expectativas de inflación a 1 año / 5 años.'],
  'Indice de confiance publié le dernier mardi du mois.': ['Confidence index released on the last Tuesday of the month.', 'Índice de confianza publicado el último martes del mes.'],
  'Croissance trimestrielle annualisée, première lecture, fin de mois suivant le trimestre.': ['Annualized quarterly growth, advance reading, at the end of the month after the quarter.', 'Crecimiento trimestral anualizado, primera lectura, a fin del mes siguiente al trimestre.'],
  'Semaine où la majorité des poids lourds du Nasdaq-100 publient, après la clôture. Gaps fréquents à la réouverture Globex 18:00 ET.': ['Week when most Nasdaq-100 heavyweights report, after the close. Gaps are common at the 18:00 ET Globex reopen.', 'Semana en la que publica la mayoría de los pesos pesados del Nasdaq-100, tras el cierre. Gaps frecuentes en la reapertura Globex de las 18:00 ET.'],
  'Premier poids du Nasdaq-100 par capitalisation : publication après clôture, réaction immédiate sur NQ en Globex.': ['Largest Nasdaq-100 weight by market cap: after-close release, immediate NQ reaction in Globex.', 'Mayor peso del Nasdaq-100 por capitalización: publicación tras el cierre, reacción inmediata en NQ en Globex.'],
  'Règlement final du contrat E-mini Nasdaq-100 à l’ouverture (prix spécial d’ouverture). Expiration simultanée des options et futures sur indices.': ['Final settlement of the E-mini Nasdaq-100 at the open (special opening price). Simultaneous expiration of index options and futures.', 'Liquidación final del E-mini Nasdaq-100 en la apertura (precio especial de apertura). Vencimiento simultáneo de opciones y futuros sobre índices.'],
  'Jour de bascule conventionnel (jeudi précédant la semaine d’expiration) : le volume migre vers l’échéance suivante.': ['Conventional roll day (Thursday before expiration week): volume migrates to the next expiry.', 'Día de cambio convencional (jueves anterior a la semana de vencimiento): el volumen migra al vencimiento siguiente.'],
  'Troisième vendredi : expiration des options sur indices et actions, flux de couverture en fin de séance.': ['Third Friday: index and equity options expire, hedging flows into the close.', 'Tercer viernes: vencen las opciones sobre índices y acciones, flujos de cobertura al cierre.'],
  'Marchés américains fermés. Pas de séance RTH ; Globex fermé ou très partiel.': ['US markets closed. No RTH session; Globex closed or very thin.', 'Mercados estadounidenses cerrados. Sin sesión RTH; Globex cerrado o muy parcial.'],
  'Good Friday : les futures sur indices cotent en séance écourtée, pas une journée fermée. L’horaire exact dépend du produit — vérifier le calendrier CME. Un NFP peut tomber le même jour.': ['Good Friday: index futures trade a shortened session, not a closed day. Exact hours depend on the product — check the CME calendar. An NFP can fall the same day.', 'Good Friday: los futuros sobre índices cotizan en sesión corta, no es un día cerrado. El horario exacto depende del producto — compruebe el calendario CME. Un NFP puede caer el mismo día.'],
  'Jour férié américain : les futures sur indices cotent avec une clôture anticipée vers 13:00 ET. Vérifier les horaires publiés par le CME.': ['US holiday: index futures trade with an early close around 13:00 ET. Check the hours published by the CME.', 'Festivo estadounidense: los futuros sobre índices cotizan con cierre anticipado hacia las 13:00 ET. Compruebe los horarios publicados por el CME.'],
  'Séance écourtée, volumes très faibles.': ['Shortened session, very light volume.', 'Sesión corta, volúmenes muy bajos.'],
  'Retour au décalage habituel : ouverture RTH à 15:30 Paris.': ['Back to the usual offset: RTH open at 15:30 Paris.', 'Vuelta al desfase habitual: apertura RTH a las 15:30 París.'],
};

/** Notes du calendrier moteur, affichées dans la langue active. */
export function trEventDesc(desc: string): string {
  if (desc.startsWith('Publication ')) {
    return desc;
  }
  if (desc.includes('Attendu ') || desc.includes('Préc. ') || desc.includes('Publié ')) {
    return desc
      .replaceAll('Attendu ', tr('Attendu ', 'Expected ', 'Esperado '))
      .replaceAll('Préc. ', tr('Préc. ', 'Prev. ', 'Ant. '))
      .replaceAll('Publié ', tr('Publié ', 'Actual ', 'Publicado '));
  }
  const untilBoth = /^Jusqu’au ([^,]+), ouverture RTH à 14:30 Paris, publications 8:30 ET à 13:30 Paris\.$/.exec(desc);
  if (untilBoth?.[1]) {
    return tr(desc, `Until ${untilBoth[1]}, RTH opens at 14:30 Paris, 8:30 ET releases at 13:30 Paris.`, `Hasta el ${untilBoth[1]}, apertura RTH a las 14:30 París, publicaciones 8:30 ET a las 13:30 París.`);
  }
  const untilOpen = /^Jusqu’au ([^,]+), ouverture RTH à 14:30 Paris\.$/.exec(desc);
  if (untilOpen?.[1]) return tr(desc, `Until ${untilOpen[1]}, RTH opens at 14:30 Paris.`, `Hasta el ${untilOpen[1]}, apertura RTH a las 14:30 París.`);
  const row = EVENT_DESC[desc];
  return row ? tr(desc, row[0], row[1]) : desc;
}
