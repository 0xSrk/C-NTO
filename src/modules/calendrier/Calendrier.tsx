import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { IconChevron, IconPlus } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Modal } from '@/design/Modal';
import { Button, Panel, Segmented, Tag, Toggle, cx } from '@/design/primitives';
import { CATEGORY_HELP, generateNasdaqEvents, SESSION_MARKERS, type CalEvent, type EventCategory } from '@/engine/calendar';
import { mergeCalendarEvents, surpriseTone } from '@/engine/macroMerge';
import { intlTag, tr, useI18n } from '@/i18n';
import { fmtUsd, plural, signClass } from '@/lib/format';
import { addDays, dateKeyLocal, ET_ZONE, formatDateFr, formatTimeLocal, parseDateKey, weekday, zonedToUtc } from '@/lib/time';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './calendrier.module.css';

const CAT_COLOR: Record<EventCategory, string> = {
  fed: '#c41e3a',
  emploi: '#e0776c',
  inflation: '#d8b45a',
  croissance: '#8fc7e8',
  sentiment: '#8a8a8a',
  resultats: '#a996e0',
  cme: '#7fcf9a',
  horaire: '#6c6c6c',
  perso: '#ffffff',
};
const CATS = Object.keys(CAT_COLOR) as EventCategory[];
const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'] as const;

function trDow(d: (typeof DOW)[number]): string {
  switch (d) {
    case 'lun':
      return tr('lun', 'Mon', 'lun');
    case 'mar':
      return tr('mar', 'Tue', 'mar');
    case 'mer':
      return tr('mer', 'Wed', 'mié');
    case 'jeu':
      return tr('jeu', 'Thu', 'jue');
    case 'ven':
      return tr('ven', 'Fri', 'vie');
    case 'sam':
      return tr('sam', 'Sat', 'sáb');
    case 'dim':
      return tr('dim', 'Sun', 'dom');
  }
}

function trCatLabel(c: EventCategory): string {
  switch (c) {
    case 'fed':
      return tr('Réserve fédérale', 'Federal Reserve', 'Reserva Federal');
    case 'emploi':
      return tr('Emploi', 'Employment', 'Empleo');
    case 'inflation':
      return tr('Inflation', 'Inflation', 'Inflación');
    case 'croissance':
      return tr('Croissance', 'Growth', 'Crecimiento');
    case 'sentiment':
      return tr('Sentiment', 'Sentiment', 'Sentimiento');
    case 'resultats':
      return tr('Résultats', 'Earnings', 'Resultados');
    case 'cme':
      return tr('CME · contrats', 'CME · contracts', 'CME · contratos');
    case 'horaire':
      return tr('Horaires', 'Schedule', 'Horarios');
    case 'perso':
      return tr('Personnel', 'Personal', 'Personal');
  }
}

function trCatHelp(c: EventCategory): { lead: string; points: string[] } {
  const raw = CATEGORY_HELP[c];
  switch (c) {
    case 'fed':
      return {
        lead: tr('Décisions de la banque centrale américaine (Fed). C’est souvent le moment le plus violent de l’année sur le Nasdaq.', 'Decisions from the US central bank (Fed). Often the most violent moment of the year on the Nasdaq.', 'Decisiones del banco central estadounidense (Fed). Suele ser el momento más violento del año en el Nasdaq.'),
        points: [
          tr('La décision de taux tombe en général à 14:00 ET, la conférence de presse juste après.', 'The rate decision usually lands at 14:00 ET, with the press conference right after.', 'La decisión de tipos suele caer a las 14:00 ET, con la conferencia de prensa justo después.'),
          tr('Débutant : n’ouvrez pas de trade 15 minutes avant. Observez d’abord.', 'Beginner: do not open a trade 15 minutes before. Watch first.', 'Principiante: no abra un trade 15 minutos antes. Observe primero.'),
          tr('Le vrai mouvement arrive souvent pendant la conférence, pas à la seconde de l’annonce.', 'The real move often comes during the conference, not at the announcement second.', 'El movimiento real suele llegar durante la conferencia, no en el segundo del anuncio.'),
        ],
      };
    case 'emploi':
      return {
        lead: tr('Chiffres sur le marché du travail américain (NFP, chômage, ADP…). Ils font réagir le dollar et donc le NQ.', 'US labor-market figures (NFP, unemployment, ADP…). They move the dollar and therefore NQ.', 'Cifras del mercado laboral estadounidense (NFP, desempleo, ADP…). Hacen reaccionar al dólar y por tanto al NQ.'),
        points: [
          tr('Publication typique : 8:30 ET (14:30 Paris en hiver).', 'Typical release: 8:30 ET (14:30 Paris in winter).', 'Publicación típica: 8:30 ET (14:30 París en invierno).'),
          tr('Attendez la clôture de la première bougie 5 minutes avant de décider.', 'Wait for the first 5-minute candle to close before deciding.', 'Espere el cierre de la primera vela de 5 minutos antes de decidir.'),
          tr('Une surprise (beaucoup plus fort ou faible que l’attendu) = mèches très longues.', 'A surprise (much stronger or weaker than expected) = very long wicks.', 'Una sorpresa (mucho más fuerte o débil que lo esperado) = mechas muy largas.'),
        ],
      };
    case 'inflation':
      return {
        lead: tr('Mesure de la hausse des prix (CPI, PPI, PCE). La Fed regarde ça pour ajuster ses taux.', 'Measure of price rises (CPI, PPI, PCE). The Fed watches this to adjust rates.', 'Medida del alza de precios (CPI, PPI, PCE). La Fed lo mira para ajustar sus tipos.'),
        points: [
          tr('Souvent publié à 8:30 ET. Réaction violente puis parfois retournement dans l’heure.', 'Often released at 8:30 ET. Violent reaction then sometimes a reversal within the hour.', 'A menudo publicado a las 8:30 ET. Reacción violenta y a veces giro en la hora.'),
          tr('Comparez le « publié » à l’« attendu » : c’est l’écart qui compte, pas le chiffre seul.', 'Compare “actual” to “expected”: the gap matters, not the figure alone.', 'Compare lo « publicado » con lo « esperado »: cuenta la diferencia, no solo la cifra.'),
          tr('Débutant : réduisez la taille ou restez à plat autour de la publication.', 'Beginner: reduce size or stay flat around the release.', 'Principiante: reduzca el tamaño o quédese plano alrededor de la publicación.'),
        ],
      };
    case 'croissance':
      return {
        lead: tr('Santé de l’économie : PIB, ISM, ventes au détail, production…', 'Health of the economy: GDP, ISM, retail sales, production…', 'Salud de la economía: PIB, ISM, ventas minoristas, producción…'),
        points: [
          tr('ISM / PMI à 10:00 ET : pic de volatilité 30 min après l’ouverture RTH.', 'ISM / PMI at 10:00 ET: volatility spike 30 min after RTH open.', 'ISM / PMI a las 10:00 ET: pico de volatilidad 30 min tras la apertura RTH.'),
          tr('PIB et ventes au détail : plutôt pré-ouverture, le marché digère avant 9:30 ET.', 'GDP and retail sales: more pre-open; the market digests before 9:30 ET.', 'PIB y ventas minoristas: más bien preapertura; el mercado digiere antes de las 9:30 ET.'),
          tr('Utile pour le biais de la journée, rarement un trade « à la seconde ».', 'Useful for the day’s bias, rarely a “to-the-second” trade.', 'Útil para el sesgo del día, rara vez un trade « al segundo ».'),
        ],
      };
    case 'sentiment':
      return {
        lead: tr('Enquêtes d’humeur des ménages ou des entreprises (Michigan, confidence…).', 'Household or business mood surveys (Michigan, confidence…).', 'Encuestas de humor de hogares o empresas (Michigan, confianza…).'),
        points: [
          tr('Impact en général modéré, sauf grosse surprise.', 'Impact usually moderate, except for a big surprise.', 'Impacto en general moderado, salvo gran sorpresa.'),
          tr('Souvent à 10:00 ET — peut colorer la matinée sans tout casser.', 'Often at 10:00 ET — can color the morning without breaking everything.', 'A menudo a las 10:00 ET — puede teñir la mañana sin romperlo todo.'),
          tr('À croiser avec inflation / emploi pour comprendre le contexte.', 'Cross-check with inflation / employment to understand context.', 'Cruce con inflación / empleo para entender el contexto.'),
        ],
      };
    case 'resultats':
      return {
        lead: tr('Publications de résultats des grandes entreprises tech (mégacaps) qui pèsent lourd dans le Nasdaq-100.', 'Earnings releases from big tech (megacaps) that weigh heavily in the Nasdaq-100.', 'Publicaciones de resultados de las grandes tecnológicas (megacaps) que pesan mucho en el Nasdaq-100.'),
        points: [
          tr('Souvent après la clôture : le gap se voit à la réouverture du lendemain.', 'Often after the close: the gap shows at the next day’s reopen.', 'A menudo tras el cierre: el gap se ve en la reapertura del día siguiente.'),
          tr('Une surprise sur Apple, Nvidia, Microsoft… peut déplacer tout le NQ.', 'A surprise on Apple, Nvidia, Microsoft… can move the whole NQ.', 'Una sorpresa en Apple, Nvidia, Microsoft… puede mover todo el NQ.'),
          tr('Prudence sur les positions overnight autour de ces dates.', 'Be careful with overnight positions around these dates.', 'Prudencia con posiciones overnight alrededor de estas fechas.'),
        ],
      };
    case 'cme':
      return {
        lead: tr('Repères liés aux contrats à terme CME (expiration, rollover du contrat NQ).', 'Markers tied to CME futures (expiration, NQ contract rollover).', 'Hitos ligados a los futuros CME (vencimiento, rollover del contrato NQ).'),
        points: [
          tr('Rollover : passer au contrat suivant dans NinjaTrader quand le volume migre.', 'Rollover: switch to the next contract in NinjaTrader when volume migrates.', 'Rollover: pase al contrato siguiente en NinjaTrader cuando migre el volumen.'),
          tr('Expiration trimestrielle : volumes et niveaux parfois « étranges » autour de 9:30 ET.', 'Quarterly expiration: volumes and levels can look “odd” around 9:30 ET.', 'Vencimiento trimestral: volúmenes y niveles a veces « raros » alrededor de las 9:30 ET.'),
          tr('Vérifiez toujours quel contrat (échéance) vous tradez.', 'Always check which contract (expiry) you are trading.', 'Compruebe siempre qué contrato (vencimiento) opera.'),
        ],
      };
    case 'horaire':
      return {
        lead: tr('Jours fériés, séances écourtées, changements d’heure — la liquidité n’est pas normale.', 'Holidays, shortened sessions, clock changes — liquidity is not normal.', 'Festivos, sesiones cortas, cambios de hora — la liquidez no es normal.'),
        points: [
          tr('Spreads élargis, mouvements erratiques : beaucoup de traders financés s’abstiennent.', 'Wider spreads, erratic moves: many funded traders sit out.', 'Spreads más anchos, movimientos erráticos: muchos traders financiados se abstienen.'),
          tr('Pendant le décalage DST, New York et Paris ne sont plus à 6 h d’écart.', 'During DST shift, New York and Paris are no longer 6 h apart.', 'Durante el cambio DST, Nueva York y París ya no están a 6 h de diferencia.'),
          tr('Cochez ces jours pour éviter les mauvaises surprises d’horaire.', 'Mark these days to avoid schedule surprises.', 'Marque estos días para evitar sorpresas de horario.'),
        ],
      };
    case 'perso':
      return {
        lead: tr('Vos propres notes et rappels du jour (coaching, revue, niveaux personnels).', 'Your own notes and reminders for the day (coaching, review, personal levels).', 'Sus propias notas y recordatorios del día (coaching, revisión, niveles personales).'),
        points: [
          tr('Ils n’arrivent pas d’Investing : c’est votre journal de bord.', 'They do not come from Investing: this is your logbook.', 'No llegan de Investing: es su cuaderno de bitácora.'),
          tr('Utilisez-les pour figer une intention avant la séance.', 'Use them to lock an intention before the session.', 'Úselos para fijar una intención antes de la sesión.'),
          tr('Visibles uniquement sur votre machine.', 'Visible only on your machine.', 'Visibles solo en su máquina.'),
        ],
      };
    default:
      return raw;
  }
}

function trMarkerLabel(label: string): string {
  switch (label) {
    case 'Ouverture Globex':
      return tr('Ouverture Globex', 'Globex open', 'Apertura Globex');
    case 'Ouverture Europe':
      return tr('Ouverture Europe', 'Europe open', 'Apertura Europa');
    case 'Publications macro':
      return tr('Publications macro', 'Macro releases', 'Publicaciones macro');
    case 'Ouverture RTH':
      return tr('Ouverture RTH', 'RTH open', 'Apertura RTH');
    case 'Publications 10:00':
      return tr('Publications 10:00', '10:00 releases', 'Publicaciones 10:00');
    case 'Pause déjeuner':
      return tr('Pause déjeuner', 'Lunch pause', 'Pausa almuerzo');
    case 'Clôture cash (MOC)':
      return tr('Clôture cash (MOC)', 'Cash close (MOC)', 'Cierre cash (MOC)');
    case 'Clôture RTH':
      return tr('Clôture RTH', 'RTH close', 'Cierre RTH');
    case 'Fermeture Globex':
      return tr('Fermeture Globex', 'Globex close', 'Cierre Globex');
    default:
      return label;
  }
}

function trMarkerNote(note: string): string {
  switch (note) {
    case 'Reprise de la cotation pour la journée de trading suivante.':
      return tr('Reprise de la cotation pour la journée de trading suivante.', 'Trading resumes for the next trading day.', 'Reanudación de la cotización para la siguiente jornada.');
    case 'Arrivée des volumes européens (Eurex, Londres à 03:00 ET).':
      return tr('Arrivée des volumes européens (Eurex, Londres à 03:00 ET).', 'European volume arrives (Eurex, London at 03:00 ET).', 'Llegada de volúmenes europeos (Eurex, Londres a las 03:00 ET).');
    case 'Créneau standard des statistiques américaines (NFP, CPI, PIB…).':
      return tr('Créneau standard des statistiques américaines (NFP, CPI, PIB…).', 'Standard slot for US statistics (NFP, CPI, GDP…).', 'Franja estándar de estadísticas estadounidenses (NFP, CPI, PIB…).');
    case 'Ouverture officielle du cash Nasdaq : volume et volatilité maximaux.':
      return tr('Ouverture officielle du cash Nasdaq : volume et volatilité maximaux.', 'Official Nasdaq cash open: maximum volume and volatility.', 'Apertura oficial del cash Nasdaq: volumen y volatilidad máximos.');
    case 'ISM, confiance, ventes de logements…':
      return tr('ISM, confiance, ventes de logements…', 'ISM, confidence, housing sales…', 'ISM, confianza, ventas de viviendas…');
    case 'Baisse de participation jusqu’à ~13:30 ET ; ranges fréquents.':
      return tr('Baisse de participation jusqu’à ~13:30 ET ; ranges fréquents.', 'Lower participation until ~13:30 ET; ranges are common.', 'Menor participación hasta ~13:30 ET; rangos frecuentes.');
    case 'Flux de rééquilibrage market-on-close.':
      return tr('Flux de rééquilibrage market-on-close.', 'Market-on-close rebalancing flows.', 'Flujos de reequilibrio market-on-close.');
    case 'Fin de la séance cash ; règlement de la journée.':
      return tr('Fin de la séance cash ; règlement de la journée.', 'End of the cash session; day settlement.', 'Fin de la sesión cash; liquidación del día.');
    case 'Pause quotidienne d’une heure (maintenance).':
      return tr('Pause quotidienne d’une heure (maintenance).', 'Daily one-hour pause (maintenance).', 'Pausa diaria de una hora (mantenimiento).');
    default:
      return note;
  }
}

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
};

const EVENT_DESC: Record<string, [string, string]> = {
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
  'Good Friday : les futures sur indices Nasdaq cotent en séance écourtée, pas une journée fermée. L’horaire exact dépend du produit — vérifier le calendrier CME. Un NFP peut tomber le même jour.': ['Good Friday: Nasdaq index futures trade a shortened session, not a closed day. Exact hours depend on the product — check the CME calendar. An NFP can fall the same day.', 'Good Friday: los futuros sobre índices Nasdaq cotizan en sesión corta, no es un día cerrado. El horario exacto depende del producto — compruebe el calendario CME. Un NFP puede caer el mismo día.'],
  'Jour férié américain : les futures sur indices cotent avec une clôture anticipée vers 13:00 ET. Vérifier les horaires publiés par le CME.': ['US holiday: index futures trade with an early close around 13:00 ET. Check the hours published by the CME.', 'Festivo estadounidense: los futuros sobre índices cotizan con cierre anticipado hacia las 13:00 ET. Compruebe los horarios publicados por el CME.'],
  'Séance écourtée, volumes très faibles.': ['Shortened session, very light volume.', 'Sesión corta, volúmenes muy bajos.'],
  'Retour au décalage habituel : ouverture RTH à 15:30 Paris.': ['Back to the usual offset: RTH open at 15:30 Paris.', 'Vuelta al desfase habitual: apertura RTH a las 15:30 París.'],
};

function holidayLabel(name: string): string {
  const row = EVENT_TITLE[name];
  return row ? tr(name, row[0], row[1]) : name;
}

/** Titres du calendrier moteur, affichés dans la langue active. Les rappels saisis restent tels quels. */
function trEventTitle(title: string): string {
  const expiry = /^Expiration trimestrielle NQ \((.+)\) · Quad witching$/.exec(title);
  if (expiry) return tr(title, `Quarterly NQ expiration (${expiry[1]}) · Quad witching`, `Vencimiento trimestral NQ (${expiry[1]}) · Quad witching`);
  const closed = /^(.+) · CME fermé$/.exec(title);
  if (closed?.[1]) return `${holidayLabel(closed[1])} · ${tr('CME fermé', 'CME closed', 'CME cerrado')}`;
  const early = /^(.+) · séance écourtée \(clôture 13:00 ET\)$/.exec(title);
  if (early?.[1]) return `${holidayLabel(early[1])} · ${tr('séance écourtée (clôture 13:00 ET)', 'shortened session (close 13:00 ET)', 'sesión corta (cierre 13:00 ET)')}`;
  const short = /^(.+) · séance écourtée$/.exec(title);
  if (short?.[1]) return `${holidayLabel(short[1])} · ${tr('séance écourtée', 'shortened session', 'sesión corta')}`;
  const row = EVENT_TITLE[title];
  return row ? tr(title, row[0], row[1]) : title;
}

function trEventDesc(desc: string): string {
  if (desc === 'Publication macro USD (fil Investing / FF).') {
    return tr(desc, 'USD macro release (Investing / FF feed).', 'Publicación macro USD (feed Investing / FF).');
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

function localTime(date: string, timeET?: string): string | null {
  if (!timeET) return null;
  return formatTimeLocal(zonedToUtc(date, timeET, ET_ZONE));
}

function catStyle(c: EventCategory): CSSProperties {
  return { '--cat': CAT_COLOR[c] } as CSSProperties;
}

/** Entrée / Espace déclenchent l'action d'un élément non-bouton rendu focalisable (cellule, ligne de flux). */
function onActivate(run: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    }
  };
}

export default function Calendrier() {
  useI18n((s) => s.locale);
  const today = dateKeyLocal(new Date());
  const settingsView = useSettings((st) => st.settings.calendarView);
  const updateSettings = useSettings((st) => st.update);
  const [view, setView] = useState<'grille' | 'flux'>(settingsView);
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const focusDate = useUi((u) => u.focusDate);
  const [selected, setSelected] = useState<string>(focusDate ?? today);
  const [hidden, setHidden] = useState<Set<EventCategory>>(new Set());
  const [showEstimated, setShowEstimated] = useState(true);
  const [minImpact, setMinImpact] = useState<1 | 2 | 3>(1);
  const [helpCat, setHelpCat] = useState<EventCategory | null>(null);
  const sessions = useJournal((j) => j.sessions);
  const entries = useCalendar((c) => c.entries);
  const toast = useUi((u) => u.toast);
  const releases = useMacro((m) => m.releases);
  const syncing = useMacro((m) => m.syncing);
  const lastSource = useMacro((m) => m.lastSource);
  const lastError = useMacro((m) => m.lastError);
  const loadMacro = useMacro((m) => m.load);
  const syncMacro = useMacro((m) => m.sync);

  useEffect(() => {
    void loadMacro().then(() => syncMacro());
  }, [loadMacro, syncMacro]);

  useEffect(() => {
    if (focusDate) {
      setSelected(focusDate);
      setCursor(focusDate.slice(0, 7));
    }
  }, [focusDate]);

  const changeView = (v: 'grille' | 'flux') => {
    setView(v);
    updateSettings({ calendarView: v });
  };

  const [yearRaw, monthRaw] = cursor.split('-').map(Number);
  const year = yearRaw ?? new Date().getFullYear();
  const month = monthRaw ?? 1;
  const events = useMemo(() => {
    const years = new Set([year - 1, year, year + 1]);
    const local = [...years].flatMap((y) => generateNasdaqEvents(y));
    return mergeCalendarEvents(local, releases);
  }, [year, releases]);

  const visible = useMemo(() => events.filter((e) => !hidden.has(e.category) && (showEstimated || !e.estimated) && e.impact >= minImpact), [events, hidden, showEstimated, minImpact]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of visible) {
      const arr = m.get(e.date);
      if (arr) arr.push(e);
      else m.set(e.date, [e]);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.impact - a.impact || (a.timeET ?? '99').localeCompare(b.timeET ?? '99'));
    return m;
  }, [visible]);
  const sessionByDate = useMemo(() => new Map(sessions.map((x) => [x.date, x])), [sessions]);
  const entriesByDate = useMemo(() => {
    const m = new Map<string, typeof entries>();
    for (const e of entries) {
      const arr = m.get(e.date);
      if (arr) arr.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [entries]);

  const history = useMemo(
    () =>
      releases
        .filter((r) => r.actual != null && r.actual !== '' && r.date <= today)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.timeET ?? '').localeCompare(a.timeET ?? ''))
        .slice(0, 40),
    [releases, today],
  );

  const gridDays = useMemo(() => {
    const first = `${cursor}-01`;
    const offset = (weekday(first) + 6) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const fluxDays = useMemo(() => {
    const start = view === 'flux' ? (cursor === today.slice(0, 7) ? addDays(today, -((weekday(today) + 6) % 7)) : `${cursor}-01`) : today;
    const end = cursor === today.slice(0, 7) ? addDays(start, 41) : addDays(`${cursor}-01`, new Date(year, month, 0).getDate() - 1);
    const days: string[] = [];
    let d = start;
    while (d <= end) {
      if (weekday(d) !== 0 && weekday(d) !== 6) days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [cursor, today, view, year, month]);

  const monthLabel = parseDateKey(`${cursor}-01`).toLocaleDateString(intlTag(), { month: 'long', year: 'numeric' });
  const shift = (n: number) => {
    const d = new Date(year, month - 1 + n, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const sourceLabel = lastSource === 'investing' ? 'Investing.com' : lastSource === 'forexfactory' ? 'Forex Factory' : tr('hors ligne', 'offline', 'sin conexión');

  return (
    <>
      <ModuleHeader
        tab="calendrier"
        actions={
          <>
            <Segmented value={view} onChange={changeView} options={[{ value: 'grille', label: tr('Grille mensuelle', 'Monthly grid', 'Cuadrícula mensual') }, { value: 'flux', label: tr('Flux chronologique', 'Chronological feed', 'Flujo cronológico') }]} />
            <Segmented value={String(minImpact) as '1' | '2' | '3'} onChange={(v) => setMinImpact(Number(v) as 1 | 2 | 3)} options={[{ value: '1', label: tr('Tout', 'All', 'Todo') }, { value: '2', label: tr('Notable +', 'Notable+', 'Notable +') }, { value: '3', label: tr('Majeur', 'Major', 'Mayor') }]} />
            <Toggle on={showEstimated} onChange={setShowEstimated} label={tr('Dates estimées', 'Estimated dates', 'Fechas estimadas')} />
            <Button
              size="sm"
              variant="ghost"
              disabled={syncing}
              onClick={async () => {
                await syncMacro(addDays(`${cursor}-01`, -10), addDays(`${cursor}-28`, 20));
                const st = useMacro.getState();
                if (st.lastError && st.lastSource === 'none') toast(st.lastError, 'warn');
                else toast(tr(`Macro · ${st.lastSource === 'investing' ? 'Investing.com' : st.lastSource === 'forexfactory' ? 'Forex Factory' : '—'} · ${st.releases.length} publications`, `Macro · ${st.lastSource === 'investing' ? 'Investing.com' : st.lastSource === 'forexfactory' ? 'Forex Factory' : '—'} · ${st.releases.length} releases`, `Macro · ${st.lastSource === 'investing' ? 'Investing.com' : st.lastSource === 'forexfactory' ? 'Forex Factory' : '—'} · ${st.releases.length} publicaciones`), 'ok');
              }}
            >
              {syncing ? tr('Sync…', 'Sync…', 'Sync…') : tr('Sync Investing', 'Sync Investing', 'Sync Investing')}
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.layout}>
          <div className={s.main}>
            <div className={s.toolbar}>
              <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label={tr('Mois précédent', 'Previous month', 'Mes anterior')}>
                <IconChevron size={12} style={{ transform: 'rotate(180deg)' }} />
              </Button>
              <span className={s.monthTitle}>{monthLabel}</span>
              <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label={tr('Mois suivant', 'Next month', 'Mes siguiente')}>
                <IconChevron size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCursor(today.slice(0, 7));
                  setSelected(today);
                }}
              >
                {tr('Aujourd’hui', 'Today', 'Hoy')}
              </Button>
              <span className={s.feedStatus} title={lastError ?? undefined}>
                {tr('Fil', 'Feed', 'Feed')} {sourceLabel}
                {lastError ? tr(' · partiel', ' · partial', ' · parcial') : ''}
              </span>
              <div className={s.filters}>
                {CATS.filter((c) => c !== 'perso').map((c) => (
                  <span key={c} className={cx(s.filterChip, !hidden.has(c) && s.on)} style={catStyle(c)}>
                    <button
                      type="button"
                      className={s.filterBtn}
                      onClick={() =>
                        setHidden((h) => {
                          const n = new Set(h);
                          if (n.has(c)) n.delete(c);
                          else n.add(c);
                          return n;
                        })
                      }
                    >
                      <i /> {trCatLabel(c)}
                    </button>
                    <button
                      type="button"
                      className={s.helpDot}
                      aria-label={`${tr('Aide', 'Help', 'Ayuda')} : ${trCatLabel(c)}`}
                      title={tr('Aide débutant', 'Beginner help', 'Ayuda para principiantes')}
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        setHelpCat(c);
                      }}
                    >
                      ?
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {view === 'grille' ? (
              <>
                <div className={cx(s.grid, s.dow)} style={{ flex: 'none' }}>
                  {DOW.map((d) => (
                    <span key={d}>{trDow(d)}</span>
                  ))}
                </div>
                <div className={s.grid}>
                  {gridDays.map((d) => {
                    const evs = byDate.get(d) ?? [];
                    const sess = sessionByDate.get(d);
                    const wd = weekday(d);
                    const holiday = evs.some((e) => e.category === 'horaire' && e.title.includes('CME fermé'));
                    const hasNote = (entriesByDate.get(d) ?? []).length > 0;
                    return (
                      <div
                        key={d}
                        role="button"
                        tabIndex={0}
                        aria-pressed={d === selected}
                        aria-label={formatDateFr(d, { weekday: true })}
                        className={cx(s.day, (wd === 0 || wd === 6) && s.weekend, !d.startsWith(cursor) && s.outside, d === today && s.today, d === selected && s.selected, holiday && s.holiday)}
                        onClick={() => setSelected(d)}
                        onKeyDown={onActivate(() => setSelected(d))}
                      >
                        <div className={s.dayHead}>
                          <span className={s.dayNum}>{Number(d.slice(-2))}</span>
                          {sess && <span className={cx(s.dayPnl, signClass(sess.pnl))}>{fmtUsd(sess.pnl, { sign: true })}</span>}
                        </div>
                        <div className={s.evs}>
                          {evs.slice(0, 3).map((e) => (
                            <div key={e.id} className={cx(s.ev, e.impact === 3 && s.impact3, e.actual && s.evPublished)} style={catStyle(e.category)} title={`${e.timeET ? `${localTime(d, e.timeET)} · ` : ''}${trEventTitle(e.title)}${e.actual ? ` · ${tr('publié', 'actual', 'publicado')} ${e.actual}` : e.forecast ? ` · ${tr('attendu', 'expected', 'esperado')} ${e.forecast}` : ''}`}>
                              <span className={s.evTitle}>
                                {e.actual ? '' : e.estimated ? '≈ ' : ''}
                                {trEventTitle(e.title)}
                              </span>
                              <LinePrint e={e} />
                            </div>
                          ))}
                          {evs.length > 3 && <span className={s.more}>+{evs.length - 3}</span>}
                        </div>
                        {hasNote && <i className={s.noteDot} />}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={s.flux}>
                {fluxDays.map((d) => {
                  const evs = byDate.get(d) ?? [];
                  const sess = sessionByDate.get(d);
                  const perso = entriesByDate.get(d) ?? [];
                  return (
                    <div key={d} className={cx(s.fluxDay, d === selected && s.selected)}>
                      <div className={cx(s.fluxDayHead, d === today && s.today)} role="button" tabIndex={0} aria-pressed={d === selected} onClick={() => setSelected(d)} onKeyDown={onActivate(() => setSelected(d))}>
                        <b>{formatDateFr(d, { weekday: true, short: true })}</b>
                        {sess ? <span className={signClass(sess.pnl)}>{fmtUsd(sess.pnl, { sign: true })} · {plural(sess.tradeCount, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))}</span> : <span>{evs.length ? plural(evs.length, tr('repère', 'marker', 'hito'), tr('repères', 'markers', 'hitos')) : tr('calme', 'quiet', 'calma')}</span>}
                      </div>
                      <div className={s.fluxEvents}>
                        {evs.length === 0 && perso.length === 0 && <div className={s.fluxEmpty}>{tr('Aucun catalyseur programmé.', 'No catalyst scheduled.', 'Ningún catalizador programado.')}</div>}
                        {[...evs]
                          .sort((a, b) => (a.timeET ?? '00:00').localeCompare(b.timeET ?? '00:00'))
                          .map((e) => (
                            <div key={e.id} className={cx(s.fluxEv, e.actual && s.evPublished)} style={catStyle(e.category)} role="button" tabIndex={0} onClick={() => setSelected(d)} onKeyDown={onActivate(() => setSelected(d))}>
                              <div className={s.fluxTime}>
                                {e.timeET ? localTime(d, e.timeET) : tr('journée', 'all day', 'jornada')}
                                {e.timeET && <small>{e.timeET} ET</small>}
                              </div>
                              <div className={cx(s.fluxTitle, e.impact === 3 && s.impact3)} title={trEventTitle(e.title)}>
                                {e.estimated ? '≈ ' : ''}
                                {trEventTitle(e.title)}
                              </div>
                              <LinePrint e={e} detailed />
                              <Impact level={e.impact} category={e.category} />
                            </div>
                          ))}
                        {perso.map((p) => (
                          <div key={p.id} className={s.fluxEv} style={catStyle('perso')} role="button" tabIndex={0} onClick={() => setSelected(d)} onKeyDown={onActivate(() => setSelected(d))}>
                            <div className={s.fluxTime}>{p.time ?? (p.kind === 'note' ? tr('note', 'note', 'nota') : tr('journée', 'all day', 'jornada'))}</div>
                            <div className={s.fluxTitle}>{p.kind === 'note' ? p.body?.slice(0, 90) : p.title}</div>
                            <Tag>{tr('personnel', 'personal', 'personal')}</Tag>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DaySide key={selected} date={selected} events={byDate.get(selected) ?? []} history={history} onSelectDate={setSelected} onHelp={setHelpCat} />
        </div>
      </ModuleContent>

      {helpCat && (
        <Modal title={trCatLabel(helpCat)} sub={tr('Repère débutant', 'Beginner guide', 'Guía para principiantes')} onClose={() => setHelpCat(null)} width={440}>
          <div className={s.helpBody}>
            <p className={s.helpLead}>{trCatHelp(helpCat).lead}</p>
            <ul className={s.helpList}>
              {trCatHelp(helpCat).points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}

function Impact({ level, category }: { level: number; category: EventCategory }) {
  useI18n((s) => s.locale);
  return (
    <span className={s.impactBar} style={catStyle(category)} title={tr(`Impact ${level}/3`, `Impact ${level}/3`, `Impacto ${level}/3`)}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={cx(i <= level && s.on)} />
      ))}
    </span>
  );
}

/** Résultat / attendu sur la ligne — lecture immédiate une fois publié. */
function LinePrint({ e, detailed }: { e: CalEvent; detailed?: boolean }) {
  useI18n((s) => s.locale);
  if (!e.forecast && !e.previous && !e.actual) return null;
  const tone = surpriseTone(e.actual, e.forecast);
  if (e.actual != null && e.actual !== '') {
    return (
      <span className={cx(s.linePrint, s.published, tone && s[tone])} title={e.forecast ? tr(`Attendu ${e.forecast} → Publié ${e.actual}`, `Expected ${e.forecast} → Actual ${e.actual}`, `Esperado ${e.forecast} → Publicado ${e.actual}`) : tr(`Publié ${e.actual}`, `Actual ${e.actual}`, `Publicado ${e.actual}`)}>
        {detailed && e.forecast ? <em>{e.forecast} → </em> : null}
        <b>{e.actual}</b>
      </span>
    );
  }
  if (e.forecast) {
    return (
      <span className={cx(s.linePrint, s.awaiting)} title={tr(`Attendu ${e.forecast}`, `Expected ${e.forecast}`, `Esperado ${e.forecast}`)}>
        ≈{e.forecast}
      </span>
    );
  }
  return null;
}

function Prints({ e }: { e: CalEvent }) {
  useI18n((s) => s.locale);
  if (!e.forecast && !e.previous && !e.actual) return null;
  const tone = surpriseTone(e.actual, e.forecast);
  return (
    <div className={s.prints}>
      <span>
        <em>{tr('Attendu', 'Expected', 'Esperado')}</em> {e.forecast ?? '—'}
      </span>
      <span>
        <em>{tr('Préc.', 'Prev.', 'Ant.')}</em> {e.previous ?? '—'}
      </span>
      <span className={tone ? s[tone] : undefined}>
        <em>{tr('Publié', 'Actual', 'Publicado')}</em> {e.actual ?? '—'}
      </span>
    </div>
  );
}

function DaySide({
  date,
  events,
  history,
  onSelectDate,
  onHelp,
}: {
  date: string;
  events: CalEvent[];
  history: ReturnType<typeof useMacro.getState>['releases'];
  onSelectDate: (d: string) => void;
  onHelp: (c: EventCategory) => void;
}) {
  useI18n((s) => s.locale);
  const sessions = useJournal((j) => j.sessions);
  const entries = useCalendar((c) => c.entries);
  const setDayNote = useCalendar((c) => c.setDayNote);
  const add = useCalendar((c) => c.add);
  const remove = useCalendar((c) => c.remove);
  const setTab = useUi((u) => u.setTab);
  const focusSession = useUi((u) => u.focusSession);
  const toast = useUi((u) => u.toast);
  const sess = sessions.find((x) => x.date === date);
  const dayEntries = entries.filter((e) => e.date === date);
  const noteEntry = dayEntries.find((e) => e.kind === 'note');
  const [note, setNote] = useState(noteEntry?.body ?? '');
  const [noteSaved, setNoteSaved] = useState(false);
  const [evTime, setEvTime] = useState('');
  const [evTitle, setEvTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    setNote(noteEntry?.body ?? '');
  }, [noteEntry?.body, noteEntry?.id]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const body = noteRef.current;
      if (body !== (noteEntry?.body ?? '')) void setDayNote(date, body);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save pending draft on unmount / day change
  }, [date]);

  const queueNoteSave = (value: string) => {
    setNote(value);
    setNoteSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void setDayNote(date, value).then(() => setNoteSaved(true));
    }, 400);
  };

  const flushNote = async (announce: boolean) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await setDayNote(date, note);
    setNoteSaved(true);
    if (announce) toast(tr('Note du jour enregistrée', 'Day note saved', 'Nota del día guardada'), 'ok');
  };

  const addReminder = async (e?: FormEvent) => {
    e?.preventDefault();
    const title = evTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await add({ date, kind: 'event', title, time: evTime || undefined });
      setEvTitle('');
      setEvTime('');
      toast(tr('Rappel ajouté', 'Reminder added', 'Recordatorio añadido'), 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : tr('Impossible d’ajouter le rappel', 'Could not add the reminder', 'No se pudo añadir el recordatorio'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...events].sort((a, b) => (a.timeET ?? '00:00').localeCompare(b.timeET ?? '00:00'));

  return (
    <aside className={s.side}>
      <Panel title={formatDateFr(date, { weekday: true })} sub={plural(events.length, tr('repère', 'marker', 'hito'), tr('repères', 'markers', 'hitos'))} accent tight>
        <div className={s.sideStack}>
          {sess && (
            <div className={s.evCard} style={catStyle('cme')}>
              <div className={s.evCardHead}>
                <b>{tr('Séance', 'Session', 'Sesión')}</b>
                <span className={cx('mono', signClass(sess.pnl))}>{fmtUsd(sess.pnl, { sign: true })}</span>
              </div>
              <div className={s.evDesc}>
                {plural(sess.tradeCount, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))}
                {sess.account ? ` · ${sess.account}` : ''}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  focusSession(sess.id);
                  setTab('visual');
                }}
              >
                {tr('Projeter Visual', 'Project Visual', 'Proyectar Visual')}
              </Button>
            </div>
          )}
          {sorted.length === 0 && !sess && <div className={s.evDesc}>{tr('Aucun catalyseur — conditions « normales ».', 'No catalyst — “normal” conditions.', 'Ningún catalizador — condiciones « normales ».')}</div>}
          {sorted.map((e) => (
            <div key={e.id} className={cx(s.evCard, e.actual && s.evPublished)} style={catStyle(e.category)}>
              <div className={s.evCardHead}>
                <b title={trEventTitle(e.title)}>{trEventTitle(e.title)}</b>
                {e.timeET && (
                  <time>
                    {localTime(date, e.timeET)}
                  </time>
                )}
              </div>
              <div className={s.evMeta}>
                <Impact level={e.impact} category={e.category} />
                <button type="button" className={s.catHelp} onClick={() => onHelp(e.category)} title={`${tr('Aide', 'Help', 'Ayuda')} : ${trCatLabel(e.category)}`}>
                  {trCatLabel(e.category)} <span>?</span>
                </button>
                {e.actual != null && e.actual !== '' && <Tag tone="mint">{tr('publié', 'actual', 'publicado')}</Tag>}
                {e.estimated && <Tag tone="amber">{tr('estimé', 'estimated', 'estimado')}</Tag>}
              </div>
              <Prints e={e} />
              {e.description && !e.actual && !e.forecast && <div className={s.evDesc}>{trEventDesc(e.description)}</div>}
            </div>
          ))}
        </div>
      </Panel>

      <section className={s.sideBlock}>
        <header className={s.sideBlockHead}>
          <h4>{tr('Personnel', 'Personal', 'Personal')}</h4>
          <span>{tr('notes et rappels', 'notes and reminders', 'notas y recordatorios')}</span>
        </header>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => queueNoteSave(e.target.value)}
          onBlur={() => void flushNote(false).catch(() => undefined)}
          placeholder={tr('Biais, niveaux, intention…', 'Bias, levels, intent…', 'Sesgo, niveles, intención…')}
          className={s.noteArea}
        />
        <div className={s.noteActions}>
          <Button size="sm" variant="ghost" onClick={() => void flushNote(true)}>
            {tr('Enregistrer', 'Save', 'Guardar')}
          </Button>
          {noteSaved && <span className={s.noteOk}>OK</span>}
        </div>
        {dayEntries
          .filter((e) => e.kind === 'event')
          .map((e) => (
            <div key={e.id} className={s.persoItem}>
              <time>{e.time ?? '—'}</time>
              <span>{e.title}</span>
              <button type="button" onClick={() => void remove(e.id)} aria-label={tr('Supprimer', 'Delete', 'Eliminar')}>
                ×
              </button>
            </div>
          ))}
        <form className={s.persoForm} onSubmit={(ev) => void addReminder(ev)}>
          <input type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} aria-label={tr('Heure du rappel', 'Reminder time', 'Hora del recordatorio')} />
          <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder={tr('Rappel…', 'Reminder…', 'Recordatorio…')} aria-label={tr('Titre du rappel', 'Reminder title', 'Título del recordatorio')} />
          <Button size="sm" type="submit" title={tr('Ajouter', 'Add', 'Añadir')} aria-label={tr('Ajouter le rappel', 'Add reminder', 'Añadir el recordatorio')} disabled={busy || !evTitle.trim()}>
            <IconPlus size={12} />
          </Button>
        </form>
      </section>

      <section className={s.sideBlock}>
        <header className={s.sideBlockHead}>
          <h4>{tr('Publiés', 'Released', 'Publicados')}</h4>
          <span>{tr('fil macro', 'macro feed', 'feed macro')}</span>
        </header>
        <div className={s.history}>
          {history.length === 0 && <div className={s.evDesc}>{tr('Sync Investing pour l’historique.', 'Sync Investing for history.', 'Sincronice Investing para el historial.')}</div>}
          {history.slice(0, 18).map((r) => {
            const tone = surpriseTone(r.actual, r.forecast);
            return (
              <button key={r.id} type="button" className={s.histRow} onClick={() => onSelectDate(r.date)}>
                <time>{r.date.slice(5)}</time>
                <span className={s.histTitle}>{r.title.replace(/^U\.S\.\s+/i, '')}</span>
                <span className={cx(s.histVals, tone && s[tone])}>
                  {r.forecast ? <em>{r.forecast}→</em> : null}
                  <b>{r.actual}</b>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={s.sideBlock}>
        <header className={s.sideBlockHead}>
          <h4>{tr('Horaires', 'Schedule', 'Horarios')}</h4>
          <span>{tr('poste et New York', 'desk and New York', 'puesto y Nueva York')}</span>
        </header>
        <div className={s.markersCompact}>
          {SESSION_MARKERS.map((m) => (
            <div key={m.timeET} className={s.markerCompact} title={trMarkerNote(m.note)}>
              <b>{localTime(date, m.timeET)}</b>
              <span>{trMarkerLabel(m.label)}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
