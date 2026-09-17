import { addDays, easterSunday, nthWeekdayOfMonth, pad2, weekday } from '@/lib/time';

export type EventCategory = 'fed' | 'emploi' | 'inflation' | 'croissance' | 'sentiment' | 'resultats' | 'cme' | 'horaire' | 'perso';

export interface CalEvent {
  id: string;
  date: string;
  /** Heure de publication en heure de New York, 'HH:mm' */
  timeET?: string;
  title: string;
  category: EventCategory;
  /** 1 = mineur · 2 = notable · 3 = majeur */
  impact: 1 | 2 | 3;
  description: string;
  beginnerTip?: string;
  /** Date déduite d'une règle de récurrence (non confirmée) */
  estimated: boolean;
  allDay?: boolean;
  /** Consensus / attendu (Investing) */
  forecast?: string;
  /** Lecture précédente */
  previous?: string;
  /** Résultat publié */
  actual?: string;
  /** Période de référence (ex. Jul) */
  period?: string;
  source?: 'local' | 'investing' | 'forexfactory';
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  fed: 'Réserve fédérale',
  emploi: 'Emploi',
  inflation: 'Inflation',
  croissance: 'Croissance',
  sentiment: 'Sentiment',
  resultats: 'Résultats',
  cme: 'CME · contrats',
  horaire: 'Horaires',
  perso: 'Personnel',
};

/** Réunions FOMC connues (jour de décision = second jour). */
const FOMC_DECISIONS: Record<number, string[]> = {
  2024: ['2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12', '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18'],
  2025: ['2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10'],
  2026: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'],
};

const TIPS = {
  fed: 'Fenêtre la plus volatile de l’année sur NQ. Pas de position 15 min avant la décision ; le vrai mouvement arrive souvent pendant la conférence de presse (14:30 ET). Débutant : observer, ne pas trader.',
  nfp: 'Publication à 8:30 ET (14:30 Paris). Mèches de 100+ points possibles en quelques secondes. Attendre la clôture de la première bougie 5 min avant toute décision.',
  cpi: 'Chiffre d’inflation le plus suivi. Réaction violente à 8:30 ET puis souvent retournement dans l’heure. Réduire la taille ou rester à plat.',
  macro: 'Publication pré-ouverture : le marché intègre la nouvelle avant 9:30 ET. Vérifier le consensus la veille pour comprendre la réaction.',
  ism: 'Publication à 10:00 ET, 30 min après l’ouverture RTH. Un pic de volatilité qui casse souvent l’opening range.',
  claims: 'Impact généralement modéré, sauf surprise. Peut colorer la première heure de cotation européenne.',
  earnings: 'Les mégacaps pèsent >40 % du Nasdaq-100 : leurs résultats (après clôture) font gapper NQ à la réouverture. Prudence sur les positions overnight.',
  expiry: 'Expiration trimestrielle : volumes et manipulations de niveaux autour de 9:30 ET. Vérifier le contrat actif dans NinjaTrader.',
  roll: 'Passer au contrat suivant dans NinjaTrader (Instruments → Rollover). Le volume migre vers le nouveau contrat ; les niveaux se décalent du spread entre les deux échéances.',
  holiday: 'Séance fériée ou écourtée : liquidité faible, spreads élargis, mouvements erratiques. Beaucoup de traders financés ne tradent pas ces jours.',
  dst: 'Pendant ces semaines, New York et Paris ne sont décalés que de 5 h : l’ouverture RTH passe à 14:30 Paris et les publications à 13:30 Paris.',
  sentiment: 'Publication à 10:00 ET. Impact modéré, mais sensible aux anticipations d’inflation des ménages.',
};

function id(...parts: (string | number)[]): string {
  return `ev_${parts.join('_')}`;
}

/** Jour ouvré le plus proche : recule si samedi/dimanche. */
function businessDayOnOrBefore(date: string): string {
  let d = date;
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}

function nthBusinessDay(year: number, month1: number, n: number): string {
  let d = `${year}-${pad2(month1)}-01`;
  let count = 0;
  for (let i = 0; i < 31; i++) {
    const w = weekday(d);
    if (w !== 0 && w !== 6) {
      count++;
      if (count === n) return d;
    }
    d = addDays(d, 1);
  }
  return d;
}

function usHolidays(year: number): { date: string; title: string; closed: boolean }[] {
  const observed = (date: string) => {
    const w = weekday(date);
    if (w === 6) return addDays(date, -1);
    if (w === 0) return addDays(date, 1);
    return date;
  };
  const newYear = `${year}-01-01`;
  const list: { date: string; title: string; closed: boolean }[] = [];
  // Un 1er janvier tombant un samedi n'est pas observé le 31 décembre par les marchés US.
  if (weekday(newYear) !== 6) list.push({ date: observed(newYear), title: 'Nouvel An', closed: true });
  return [
    ...list,
    { date: nthWeekdayOfMonth(year, 1, 1, 3), title: 'Martin Luther King Jr. Day', closed: false },
    { date: nthWeekdayOfMonth(year, 2, 1, 3), title: 'Presidents’ Day', closed: false },
    { date: addDays(easterSunday(year), -2), title: 'Good Friday', closed: true },
    { date: nthWeekdayOfMonth(year, 5, 1, -1), title: 'Memorial Day', closed: false },
    { date: observed(`${year}-06-19`), title: 'Juneteenth', closed: false },
    { date: observed(`${year}-07-04`), title: 'Independence Day', closed: false },
    { date: nthWeekdayOfMonth(year, 9, 1, 1), title: 'Labor Day', closed: false },
    { date: nthWeekdayOfMonth(year, 11, 4, 4), title: 'Thanksgiving', closed: false },
    { date: observed(`${year}-12-25`), title: 'Noël', closed: true },
  ];
}

/** Génère les événements structurels de l'année pour un trader Nasdaq. */
export function generateNasdaqEvents(year: number): CalEvent[] {
  const events: CalEvent[] = [];

  const fomc = FOMC_DECISIONS[year];
  if (fomc) {
    for (const date of fomc) {
      events.push({ id: id('fomc', date), date, timeET: '14:00', title: 'Décision FOMC · taux directeurs', category: 'fed', impact: 3, estimated: false, description: 'Communiqué du comité de politique monétaire puis conférence de presse du président de la Fed à 14:30 ET. Projections économiques (dot plot) en mars, juin, septembre et décembre.', beginnerTip: TIPS.fed });
      const minutes = addDays(date, 21);
      events.push({ id: id('fomc-min', date), date: minutes, timeET: '14:00', title: 'Minutes du FOMC', category: 'fed', impact: 2, estimated: true, description: 'Compte rendu détaillé de la réunion précédente, publié trois semaines après. Peut réévaluer la trajectoire des taux.', beginnerTip: TIPS.macro });
    }
  } else {
    for (const m of [1, 3, 4, 6, 7, 9, 10, 12]) {
      const date = nthWeekdayOfMonth(year, m, 3, m === 1 || m === 12 ? 4 : 3);
      events.push({ id: id('fomc-est', date), date, timeET: '14:00', title: 'Décision FOMC (estimée)', category: 'fed', impact: 3, estimated: true, description: 'Réunion FOMC estimée par récurrence : vérifier le calendrier officiel de la Réserve fédérale.', beginnerTip: TIPS.fed });
    }
  }

  for (let m = 1; m <= 12; m++) {
    const firstFriday = nthWeekdayOfMonth(year, m, 5, 1);
    const nfp = Number(firstFriday.slice(-2)) <= 2 ? nthWeekdayOfMonth(year, m, 5, 2) : firstFriday;
    events.push({ id: id('nfp', nfp), date: nfp, timeET: '08:30', title: 'Rapport emploi US (NFP)', category: 'emploi', impact: 3, estimated: true, description: 'Créations d’emplois non agricoles, taux de chômage et salaires horaires. Publication BLS du premier vendredi du mois (sauf exception).', beginnerTip: TIPS.nfp });

    const cpi = businessDayOnOrBefore(nthWeekdayOfMonth(year, m, 3, 2));
    events.push({ id: id('cpi', cpi), date: cpi, timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, estimated: true, description: 'Indice des prix à la consommation (headline et core). Publié par le BLS autour de la deuxième semaine du mois.', beginnerTip: TIPS.cpi });
    const ppi = addDays(cpi, 1);
    events.push({ id: id('ppi', ppi), date: businessDayOnOrBefore(weekday(ppi) === 6 ? addDays(ppi, 2) : ppi), timeET: '08:30', title: 'Prix à la production (PPI)', category: 'inflation', impact: 2, estimated: true, description: 'Inflation côté producteurs, souvent publiée le lendemain du CPI.', beginnerTip: TIPS.macro });

    const pce = businessDayOnOrBefore(nthWeekdayOfMonth(year, m, 5, -1));
    events.push({ id: id('pce', pce), date: pce, timeET: '08:30', title: 'Inflation PCE · revenus & dépenses', category: 'inflation', impact: 2, estimated: true, description: 'Mesure d’inflation privilégiée par la Fed, publiée en fin de mois avec les revenus et dépenses des ménages.', beginnerTip: TIPS.macro });

    const ism = nthBusinessDay(year, m, 1);
    events.push({ id: id('ism-m', ism), date: ism, timeET: '10:00', title: 'ISM Manufacturier', category: 'croissance', impact: 2, estimated: true, description: 'PMI manufacturier : activité, nouvelles commandes, prix payés. Premier jour ouvré du mois.', beginnerTip: TIPS.ism });
    const isms = nthBusinessDay(year, m, 3);
    events.push({ id: id('ism-s', isms), date: isms, timeET: '10:00', title: 'ISM Services', category: 'croissance', impact: 2, estimated: true, description: 'PMI des services, secteur dominant de l’économie américaine. Troisième jour ouvré du mois.', beginnerTip: TIPS.ism });

    const retail = businessDayOnOrBefore(`${year}-${pad2(m)}-16`);
    events.push({ id: id('retail', retail), date: retail, timeET: '08:30', title: 'Ventes au détail', category: 'croissance', impact: 2, estimated: true, description: 'Consommation des ménages, publiée vers le milieu du mois.', beginnerTip: TIPS.macro });

    const mich1 = nthWeekdayOfMonth(year, m, 5, 2);
    events.push({ id: id('mich-p', mich1), date: mich1, timeET: '10:00', title: 'Confiance Michigan (préliminaire)', category: 'sentiment', impact: 1, estimated: true, description: 'Sentiment des consommateurs et anticipations d’inflation à 1 an / 5 ans.', beginnerTip: TIPS.sentiment });
    const conf = nthWeekdayOfMonth(year, m, 2, -1);
    events.push({ id: id('conf', conf), date: conf, timeET: '10:00', title: 'Confiance des consommateurs (Conference Board)', category: 'sentiment', impact: 1, estimated: true, description: 'Indice de confiance publié le dernier mardi du mois.', beginnerTip: TIPS.sentiment });

    if ([1, 4, 7, 10].includes(m)) {
      const gdp = businessDayOnOrBefore(nthWeekdayOfMonth(year, m, 4, -1));
      events.push({ id: id('gdp', gdp), date: gdp, timeET: '08:30', title: 'PIB US (première estimation)', category: 'croissance', impact: 2, estimated: true, description: 'Croissance trimestrielle annualisée, première lecture, fin de mois suivant le trimestre.', beginnerTip: TIPS.macro });
      const mega = nthWeekdayOfMonth(year, m, 3, 4);
      events.push({ id: id('mega', mega), date: mega, title: 'Fenêtre résultats mégacaps (MSFT · GOOGL · META · AAPL · AMZN)', category: 'resultats', impact: 3, estimated: true, allDay: true, description: 'Semaine où la majorité des poids lourds du Nasdaq-100 publient, après la clôture. Gaps fréquents à la réouverture Globex 18:00 ET.', beginnerTip: TIPS.earnings });
    }
    if ([2, 5, 8, 11].includes(m)) {
      const nvda = nthWeekdayOfMonth(year, m, 3, 4);
      events.push({ id: id('nvda', nvda), date: nvda, timeET: '16:20', title: 'Résultats NVIDIA (fenêtre estimée)', category: 'resultats', impact: 3, estimated: true, description: 'Premier poids du Nasdaq-100 par capitalisation : publication après clôture, réaction immédiate sur NQ en Globex.', beginnerTip: TIPS.earnings });
    }

    const thirdFriday = nthWeekdayOfMonth(year, m, 5, 3);
    if ([3, 6, 9, 12].includes(m)) {
      events.push({ id: id('expiry', thirdFriday), date: thirdFriday, timeET: '09:30', title: `Expiration trimestrielle NQ (${['H', 'M', 'U', 'Z'][[3, 6, 9, 12].indexOf(m)]}${String(year).slice(-1)}) · Quad witching`, category: 'cme', impact: 3, estimated: false, description: 'Règlement final du contrat E-mini Nasdaq-100 à l’ouverture (prix spécial d’ouverture). Expiration simultanée des options et futures sur indices.', beginnerTip: TIPS.expiry });
      const roll = addDays(thirdFriday, -8);
      events.push({ id: id('roll', roll), date: roll, title: 'Rollover NQ / MNQ → contrat suivant', category: 'cme', impact: 2, estimated: false, allDay: true, description: 'Jour de bascule conventionnel (jeudi précédant la semaine d’expiration) : le volume migre vers l’échéance suivante.', beginnerTip: TIPS.roll });
    } else {
      events.push({ id: id('opex', thirdFriday), date: thirdFriday, timeET: '16:00', title: 'Expiration mensuelle des options', category: 'cme', impact: 1, estimated: false, description: 'Troisième vendredi : expiration des options sur indices et actions, flux de couverture en fin de séance.', beginnerTip: TIPS.macro });
    }
  }

  for (const h of usHolidays(year)) {
    events.push({ id: id('hol', h.date), date: h.date, title: h.closed ? `${h.title} · CME fermé` : `${h.title} · séance écourtée (clôture 13:00 ET)`, category: 'horaire', impact: 2, estimated: false, allDay: true, description: h.closed ? 'Marchés américains fermés. Pas de séance RTH ; Globex fermé ou très partiel.' : 'Jour férié américain : les futures sur indices cotent avec une clôture anticipée vers 13:00 ET. Vérifier les horaires publiés par le CME.', beginnerTip: TIPS.holiday });
  }
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);
  events.push({ id: id('bf', thanksgiving), date: addDays(thanksgiving, 1), title: 'Lendemain de Thanksgiving · clôture 13:15 ET', category: 'horaire', impact: 1, estimated: false, allDay: true, description: 'Séance écourtée, volumes très faibles.', beginnerTip: TIPS.holiday });

  const usDstStart = nthWeekdayOfMonth(year, 3, 0, 2);
  const euDstStart = nthWeekdayOfMonth(year, 3, 0, -1);
  const euDstEnd = nthWeekdayOfMonth(year, 10, 0, -1);
  const usDstEnd = nthWeekdayOfMonth(year, 11, 0, 1);
  events.push({ id: id('dst1', usDstStart), date: usDstStart, title: 'New York passe à l’heure d’été · décalage Paris 5 h', category: 'horaire', impact: 2, estimated: false, allDay: true, description: `Jusqu’au ${euDstStart}, ouverture RTH à 14:30 Paris, publications 8:30 ET à 13:30 Paris.`, beginnerTip: TIPS.dst });
  events.push({ id: id('dst2', euDstStart), date: euDstStart, title: 'Europe passe à l’heure d’été · décalage Paris 6 h', category: 'horaire', impact: 1, estimated: false, allDay: true, description: 'Retour au décalage habituel : ouverture RTH à 15:30 Paris.', beginnerTip: TIPS.dst });
  events.push({ id: id('dst3', euDstEnd), date: euDstEnd, title: 'Europe repasse à l’heure d’hiver · décalage Paris 5 h', category: 'horaire', impact: 2, estimated: false, allDay: true, description: `Jusqu’au ${usDstEnd}, ouverture RTH à 14:30 Paris.`, beginnerTip: TIPS.dst });
  events.push({ id: id('dst4', usDstEnd), date: usDstEnd, title: 'New York repasse à l’heure d’hiver · décalage Paris 6 h', category: 'horaire', impact: 1, estimated: false, allDay: true, description: 'Retour au décalage habituel : ouverture RTH à 15:30 Paris.', beginnerTip: TIPS.dst });

  events.sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? ''));
  return events;
}

/** Repères horaires fixes d'une séance Nasdaq (heure de New York). */
export const SESSION_MARKERS: { timeET: string; label: string; note: string }[] = [
  { timeET: '18:00', label: 'Ouverture Globex', note: 'Reprise de la cotation pour la journée de trading suivante.' },
  { timeET: '02:00', label: 'Ouverture Europe', note: 'Arrivée des volumes européens (Eurex, Londres à 03:00 ET).' },
  { timeET: '08:30', label: 'Publications macro', note: 'Créneau standard des statistiques américaines (NFP, CPI, PIB…).' },
  { timeET: '09:30', label: 'Ouverture RTH', note: 'Ouverture officielle du cash Nasdaq : volume et volatilité maximaux.' },
  { timeET: '10:00', label: 'Publications 10:00', note: 'ISM, confiance, ventes de logements…' },
  { timeET: '11:30', label: 'Pause déjeuner', note: 'Baisse de participation jusqu’à ~13:30 ET ; ranges fréquents.' },
  { timeET: '15:50', label: 'Clôture cash (MOC)', note: 'Flux de rééquilibrage market-on-close.' },
  { timeET: '16:00', label: 'Clôture RTH', note: 'Fin de la séance cash ; règlement de la journée.' },
  { timeET: '17:00', label: 'Fermeture Globex', note: 'Pause quotidienne d’une heure (maintenance).' },
];
