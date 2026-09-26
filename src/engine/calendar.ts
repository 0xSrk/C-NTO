import { listInstruments } from '@/engine/instruments';
import { addDays, easterSunday, nthWeekdayOfMonth, pad2, weekday } from '@/lib/time';

export type EventCategory =
  | 'fed'
  | 'banque-centrale'
  | 'emploi'
  | 'inflation'
  | 'croissance'
  | 'sentiment'
  | 'resultats'
  | 'energie'
  | 'adjudication'
  | 'cme'
  | 'horaire'
  | 'perso';

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
  /** Consensus, seulement si une source autorisée le fournit. */
  forecast?: string;
  /** Lecture précédente */
  previous?: string;
  /** Résultat publié */
  actual?: string;
  /** Période de référence (ex. Jul) */
  period?: string;
  source?: 'local' | 'bls' | 'bea' | 'fed' | 'ecb' | 'cme' | 'eia' | 'treasury' | 'fred' | 'forexfactory' | 'user' | 'bundle';
  /** Institution d'origine d'une ligne embarquée. */
  origin?: 'bls' | 'bea' | 'fed' | 'ecb' | 'eia' | 'treasury';
  /** Vide = tous les instruments. */
  instruments?: string[];
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  fed: 'Réserve fédérale',
  'banque-centrale': 'Banque centrale',
  emploi: 'Emploi',
  inflation: 'Inflation',
  croissance: 'Croissance',
  sentiment: 'Sentiment',
  resultats: 'Résultats',
  energie: 'Énergie',
  adjudication: 'Adjudication',
  cme: 'CME · contrats',
  horaire: 'Horaires',
  perso: 'Personnel',
};

/** Aide courte débutant — pastille « ? » des filtres calendrier. */
export const CATEGORY_HELP: Record<EventCategory, { lead: string; points: string[] }> = {
  fed: {
    lead: 'Décisions de la banque centrale américaine (Fed). C’est souvent le moment le plus violent de l’année sur les indices.',
    points: [
      'La décision de taux tombe en général à 14:00 ET, la conférence de presse juste après.',
      'Débutant : n’ouvrez pas de trade 15 minutes avant. Observez d’abord.',
      'Le vrai mouvement arrive souvent pendant la conférence, pas à la seconde de l’annonce.',
    ],
  },
  'banque-centrale': {
    lead: 'Décisions de taux des banques centrales (Fed, BCE). Elles concernent tous les indices, pas un seul contrat.',
    points: [
      'Fed : communiqué en général à 14:00 ET, conférence juste après.',
      'BCE : le jour 2 de la réunion, suivi de la conférence. L’heure n’est pas sur le calendrier officiel.',
      'Débutant : pas de position 15 minutes avant. Observer d’abord.',
    ],
  },
  emploi: {
    lead: 'Chiffres sur le marché du travail américain (NFP, chômage). Ils font réagir le dollar et les indices.',
    points: [
      'Publication typique : 8:30 ET (14:30 Paris en hiver).',
      'Attendez la clôture de la première bougie 5 minutes avant de décider.',
      'Une surprise (beaucoup plus fort ou faible que l’attendu) = mèches très longues.',
    ],
  },
  inflation: {
    lead: 'Mesure de la hausse des prix (CPI, PPI, PCE). La Fed regarde ça pour ajuster ses taux.',
    points: [
      'Souvent publié à 8:30 ET. Réaction violente puis parfois retournement dans l’heure.',
      'Comparez le « publié » à l’« attendu » : c’est l’écart qui compte, pas le chiffre seul.',
      'Débutant : réduisez la taille ou restez à plat autour de la publication.',
    ],
  },
  croissance: {
    lead: 'Santé de l’économie : PIB, ISM, ventes au détail, production…',
    points: [
      'ISM / PMI à 10:00 ET : pic de volatilité 30 min après l’ouverture RTH.',
      'PIB et ventes au détail : plutôt pré-ouverture, le marché digère avant 9:30 ET.',
      'Utile pour le biais de la journée, rarement un trade « à la seconde ».',
    ],
  },
  sentiment: {
    lead: 'Enquêtes d’humeur des ménages ou des entreprises (Michigan, confidence…).',
    points: [
      'Impact en général modéré, sauf grosse surprise.',
      'Souvent à 10:00 ET — peut colorer la matinée sans tout casser.',
      'À croiser avec inflation / emploi pour comprendre le contexte.',
    ],
  },
  resultats: {
    lead: 'Publications de résultats des grandes entreprises tech (mégacaps) qui pèsent lourd dans le Nasdaq-100.',
    points: [
      'Souvent après la clôture : le gap se voit à la réouverture du lendemain.',
      'Une surprise sur Apple, Nvidia, Microsoft… peut déplacer tout le Nasdaq-100.',
      'Prudence sur les positions overnight autour de ces dates.',
    ],
  },
  energie: {
    lead: 'Stocks de pétrole hebdomadaires (EIA). Ils concernent le brut CL et le micro MCL.',
    points: [
      'Publication habituelle : mercredi après 10:30 ET, reportée les semaines fériées.',
      'Le mouvement est sur le pétrole ; les indices ne font que l’accompagner.',
      'La règle du mercredi est estimée tant que la date n’est pas dans le tableau des reports.',
    ],
  },
  adjudication: {
    lead: 'Adjudications du Trésor américain. Elles pèsent sur les taux, donc sur tous les contrats.',
    points: [
      'L’heure est celle de clôture des offres compétitives (souvent 11:30 ET).',
      'Un bon du Trésor n’est pas un chiffre d’inflation : l’impact est en général moindre.',
      'Utile comme contexte de séance, rarement un trade à la seconde.',
    ],
  },
  cme: {
    lead: 'Repères liés aux contrats à terme CME : expiration et rollover, une ligne par future du registre.',
    points: [
      'Rollover : passer au contrat suivant dans NinjaTrader quand le volume migre.',
      'Expiration trimestrielle : volumes et niveaux parfois « étranges » autour de 9:30 ET.',
      'Vérifiez toujours quel contrat (échéance) vous tradez.',
    ],
  },
  horaire: {
    lead: 'Jours fériés, séances écourtées, changements d’heure — la liquidité n’est pas normale.',
    points: [
      'Spreads élargis, mouvements erratiques : beaucoup de traders financés s’abstiennent.',
      'Pendant le décalage DST, New York et Paris ne sont plus à 6 h d’écart.',
      'Cochez ces jours pour éviter les mauvaises surprises d’horaire.',
    ],
  },
  perso: {
    lead: 'Vos propres notes et rappels du jour (coaching, revue, niveaux personnels).',
    points: [
      'Ils n’arrivent pas d’un fil externe : c’est votre journal de bord.',
      'Utilisez-les pour figer une intention avant la séance.',
      'Visibles uniquement sur votre machine.',
    ],
  },
};

/** Un repère débutant par catégorie, pas par instrument. */
const TIPS: Record<EventCategory, string> = {
  fed: 'Fenêtre la plus volatile de l’année sur les indices. Pas de position 15 min avant la décision ; le vrai mouvement arrive souvent pendant la conférence de presse. Débutant : observer, ne pas trader.',
  'banque-centrale': 'Décision de banque centrale : tous les indices sont concernés. Pas de position 15 min avant. Le vrai mouvement arrive souvent pendant la conférence.',
  emploi: 'Publication à 8:30 ET. Mèches très longues possibles en quelques secondes sur les indices. Attendre la clôture de la première bougie 5 min avant toute décision.',
  inflation: 'Chiffre d’inflation le plus suivi. Réaction violente à 8:30 ET puis souvent retournement dans l’heure. Réduire la taille ou rester à plat.',
  croissance: 'Publication pré-ouverture ou à 10:00 ET : le marché intègre la nouvelle avant de choisir un sens. Utile pour le biais du jour.',
  sentiment: 'Publication à 10:00 ET. Impact modéré, mais sensible aux anticipations d’inflation des ménages.',
  resultats: 'Les mégacaps pèsent lourd dans le Nasdaq-100 : leurs résultats (après clôture) font gapper l’indice à la réouverture. Prudence sur les positions overnight.',
  energie: 'Stocks EIA : CL et MCL. Mercredi après 10:30 ET, sauf report férié publié par l’EIA.',
  adjudication: 'Adjudication du Trésor. Heure de clôture des offres compétitives. Contexte de taux pour tous les contrats.',
  cme: 'Expiration ou rollover estimé (3e vendredi) tant que le calendrier CME n’a pas confirmé la date. Vérifier le contrat actif.',
  horaire: 'Séance fériée ou écourtée : liquidité faible, spreads élargis. Pendant le décalage d’heure, New York et Paris ne sont plus à 6 h d’écart.',
  perso: 'Note ou rappel personnel. Il ne vient pas d’un fil externe.',
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
    { date: addDays(easterSunday(year), -2), title: 'Good Friday', closed: false },
    { date: nthWeekdayOfMonth(year, 5, 1, -1), title: 'Memorial Day', closed: false },
    { date: observed(`${year}-06-19`), title: 'Juneteenth', closed: false },
    { date: observed(`${year}-07-04`), title: 'Independence Day', closed: false },
    { date: nthWeekdayOfMonth(year, 9, 1, 1), title: 'Labor Day', closed: false },
    { date: nthWeekdayOfMonth(year, 11, 4, 4), title: 'Thanksgiving', closed: false },
    { date: observed(`${year}-12-25`), title: 'Noël', closed: true },
  ];
}

/**
 * Repères locaux : fériés, séances, résultats estimés, expirations.
 * FOMC et NFP ne sont plus codés ici : ils viennent des adaptateurs `fed` et `bls`.
 * Expirations et rollovers : une ligne par future du registre, 3e vendredi, `estimated: true`
 * tant que CME Group ne confirme pas (page fériés en 403 le 2026-09-26).
 */
export function generateNasdaqEvents(year: number): CalEvent[] {
  const events: CalEvent[] = [];
  const futures = listInstruments({ assetClass: 'future' });

  for (let m = 1; m <= 12; m++) {
    const cpi = businessDayOnOrBefore(nthWeekdayOfMonth(year, m, 3, 2));
    events.push({ id: id('cpi', cpi), date: cpi, timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, estimated: true, description: 'Indice des prix à la consommation (headline et core). Publié par le BLS autour de la deuxième semaine du mois.', beginnerTip: TIPS.inflation });
    const ppi = addDays(cpi, 1);
    events.push({ id: id('ppi', ppi), date: businessDayOnOrBefore(weekday(ppi) === 6 ? addDays(ppi, 2) : ppi), timeET: '08:30', title: 'Prix à la production (PPI)', category: 'inflation', impact: 2, estimated: true, description: 'Inflation côté producteurs, souvent publiée le lendemain du CPI.', beginnerTip: TIPS.inflation });

    const pce = businessDayOnOrBefore(nthWeekdayOfMonth(year, m, 5, -1));
    events.push({ id: id('pce', pce), date: pce, timeET: '08:30', title: 'Inflation PCE · revenus & dépenses', category: 'inflation', impact: 2, estimated: true, description: 'Mesure d’inflation privilégiée par la Fed, publiée en fin de mois avec les revenus et dépenses des ménages.', beginnerTip: TIPS.inflation });

    const ism = nthBusinessDay(year, m, 1);
    events.push({ id: id('ism-m', ism), date: ism, timeET: '10:00', title: 'ISM Manufacturier', category: 'croissance', impact: 2, estimated: true, description: 'PMI manufacturier : activité, nouvelles commandes, prix payés. Premier jour ouvré du mois.', beginnerTip: TIPS.croissance });
    const isms = nthBusinessDay(year, m, 3);
    events.push({ id: id('ism-s', isms), date: isms, timeET: '10:00', title: 'ISM Services', category: 'croissance', impact: 2, estimated: true, description: 'PMI des services, secteur dominant de l’économie américaine. Troisième jour ouvré du mois.', beginnerTip: TIPS.croissance });

    const retail = businessDayOnOrBefore(`${year}-${pad2(m)}-16`);
    events.push({ id: id('retail', retail), date: retail, timeET: '08:30', title: 'Ventes au détail', category: 'croissance', impact: 2, estimated: true, description: 'Consommation des ménages, publiée vers le milieu du mois.', beginnerTip: TIPS.croissance });

    const mich1 = nthWeekdayOfMonth(year, m, 5, 2);
    events.push({ id: id('mich-p', mich1), date: mich1, timeET: '10:00', title: 'Confiance Michigan (préliminaire)', category: 'sentiment', impact: 1, estimated: true, description: 'Sentiment des consommateurs et anticipations d’inflation à 1 an / 5 ans.', beginnerTip: TIPS.sentiment });
    const conf = nthWeekdayOfMonth(year, m, 2, -1);
    events.push({ id: id('conf', conf), date: conf, timeET: '10:00', title: 'Confiance des consommateurs (Conference Board)', category: 'sentiment', impact: 1, estimated: true, description: 'Indice de confiance publié le dernier mardi du mois.', beginnerTip: TIPS.sentiment });

    if ([1, 4, 7, 10].includes(m)) {
      const gdp = businessDayOnOrBefore(nthWeekdayOfMonth(year, m, 4, -1));
      events.push({ id: id('gdp', gdp), date: gdp, timeET: '08:30', title: 'PIB US (première estimation)', category: 'croissance', impact: 2, estimated: true, description: 'Croissance trimestrielle annualisée, première lecture, fin de mois suivant le trimestre.', beginnerTip: TIPS.croissance });
      const mega = nthWeekdayOfMonth(year, m, 3, 4);
      events.push({ id: id('mega', mega), date: mega, title: 'Fenêtre résultats mégacaps (MSFT · GOOGL · META · AAPL · AMZN)', category: 'resultats', impact: 3, estimated: true, allDay: true, description: 'Semaine où la majorité des poids lourds du Nasdaq-100 publient, après la clôture. Gaps fréquents à la réouverture Globex 18:00 ET.', beginnerTip: TIPS.resultats });
    }
    if ([2, 5, 8, 11].includes(m)) {
      const nvda = nthWeekdayOfMonth(year, m, 3, 4);
      events.push({ id: id('nvda', nvda), date: nvda, timeET: '16:20', title: 'Résultats NVIDIA (fenêtre estimée)', category: 'resultats', impact: 3, estimated: true, description: 'Premier poids du Nasdaq-100 par capitalisation : publication après clôture, réaction immédiate sur l’indice en Globex.', beginnerTip: TIPS.resultats });
    }

    const thirdFriday = nthWeekdayOfMonth(year, m, 5, 3);
    if ([3, 6, 9, 12].includes(m)) {
      const code = `${['H', 'M', 'U', 'Z'][[3, 6, 9, 12].indexOf(m)]}${String(year).slice(-1)}`;
      const roll = addDays(thirdFriday, -8);
      for (const spec of futures) {
        events.push({
          id: id('expiry', spec.symbol, thirdFriday),
          date: thirdFriday,
          timeET: '09:30',
          title: `Expiration trimestrielle ${spec.symbol} (${code})`,
          category: 'cme',
          impact: 2,
          estimated: true,
          instruments: [spec.symbol],
          description: 'Date déduite de la règle du 3e vendredi des futures sur indices, appliquée à chaque racine du registre. Non confirmée par CME Group.',
          beginnerTip: TIPS.cme,
        });
        events.push({
          id: id('roll', spec.symbol, roll),
          date: roll,
          title: `Rollover ${spec.symbol} → contrat suivant`,
          category: 'cme',
          impact: 2,
          estimated: true,
          allDay: true,
          instruments: [spec.symbol],
          description: 'Jour de bascule conventionnel (jeudi précédant la semaine d’expiration) : le volume migre vers l’échéance suivante. Date estimée.',
          beginnerTip: TIPS.cme,
        });
      }
    } else {
      events.push({ id: id('opex', thirdFriday), date: thirdFriday, timeET: '16:00', title: 'Expiration mensuelle des options', category: 'cme', impact: 1, estimated: true, description: 'Troisième vendredi : expiration des options sur indices et actions, flux de couverture en fin de séance. Date estimée.', beginnerTip: TIPS.cme });
    }
  }

  for (const h of usHolidays(year)) {
    const earlyFriday = h.title === 'Good Friday';
    const title = h.closed ? `${h.title} · CME fermé` : earlyFriday ? `${h.title} · séance écourtée` : `${h.title} · séance écourtée (clôture 13:00 ET)`;
    const description = h.closed
      ? 'Marchés américains fermés. Pas de séance RTH ; Globex fermé ou très partiel.'
      : earlyFriday
        ? 'Good Friday : les futures sur indices cotent en séance écourtée, pas une journée fermée. L’horaire exact dépend du produit — vérifier le calendrier CME. Un NFP peut tomber le même jour.'
        : 'Jour férié américain : les futures sur indices cotent avec une clôture anticipée vers 13:00 ET. Vérifier les horaires publiés par le CME.';
    events.push({ id: id('hol', h.date), date: h.date, title, category: 'horaire', impact: 2, estimated: false, allDay: true, description, beginnerTip: TIPS.horaire });
  }
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);
  events.push({ id: id('bf', thanksgiving), date: addDays(thanksgiving, 1), title: 'Lendemain de Thanksgiving · clôture 13:15 ET', category: 'horaire', impact: 1, estimated: false, allDay: true, description: 'Séance écourtée, volumes très faibles.', beginnerTip: TIPS.horaire });

  const usDstStart = nthWeekdayOfMonth(year, 3, 0, 2);
  const euDstStart = nthWeekdayOfMonth(year, 3, 0, -1);
  const euDstEnd = nthWeekdayOfMonth(year, 10, 0, -1);
  const usDstEnd = nthWeekdayOfMonth(year, 11, 0, 1);
  events.push({ id: id('dst1', usDstStart), date: usDstStart, title: 'New York passe à l’heure d’été · décalage Paris 5 h', category: 'horaire', impact: 2, estimated: false, allDay: true, description: `Jusqu’au ${euDstStart}, ouverture RTH à 14:30 Paris, publications 8:30 ET à 13:30 Paris.`, beginnerTip: TIPS.horaire });
  events.push({ id: id('dst2', euDstStart), date: euDstStart, title: 'Europe passe à l’heure d’été · décalage Paris 6 h', category: 'horaire', impact: 1, estimated: false, allDay: true, description: 'Retour au décalage habituel : ouverture RTH à 15:30 Paris.', beginnerTip: TIPS.horaire });
  events.push({ id: id('dst3', euDstEnd), date: euDstEnd, title: 'Europe repasse à l’heure d’hiver · décalage Paris 5 h', category: 'horaire', impact: 2, estimated: false, allDay: true, description: `Jusqu’au ${usDstEnd}, ouverture RTH à 14:30 Paris.`, beginnerTip: TIPS.horaire });
  events.push({ id: id('dst4', usDstEnd), date: usDstEnd, title: 'New York repasse à l’heure d’hiver · décalage Paris 6 h', category: 'horaire', impact: 1, estimated: false, allDay: true, description: 'Retour au décalage habituel : ouverture RTH à 15:30 Paris.', beginnerTip: TIPS.horaire });

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
