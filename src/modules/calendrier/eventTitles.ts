import { tr } from '@/i18n';

/** Titres du calendrier moteur (`src/engine/calendar.ts`), en anglais et en espagnol ; le français est la clé. */
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

function holidayLabel(name: string): string {
  const row = EVENT_TITLE[name];
  return row ? tr(name, row[0], row[1]) : name;
}

/** Titres du calendrier moteur, affichés dans la langue active. Les rappels saisis restent tels quels. */
export function trEventTitle(title: string): string {
  const expiry = /^Expiration trimestrielle ([A-Z0-9]+) \((.+)\)$/.exec(title);
  if (expiry) return tr(title, `Quarterly expiration ${expiry[1]} (${expiry[2]})`, `Vencimiento trimestral ${expiry[1]} (${expiry[2]})`);
  const roll = /^Rollover ([A-Z0-9]+) → contrat suivant$/.exec(title);
  if (roll) return tr(title, `Rollover ${roll[1]} → next contract`, `Rollover ${roll[1]} → contrato siguiente`);
  const closed = /^(.+) · CME fermé$/.exec(title);
  if (closed?.[1]) return `${holidayLabel(closed[1])} · ${tr('CME fermé', 'CME closed', 'CME cerrado')}`;
  const early = /^(.+) · séance écourtée \(clôture 13:00 ET\)$/.exec(title);
  if (early?.[1]) return `${holidayLabel(early[1])} · ${tr('séance écourtée (clôture 13:00 ET)', 'shortened session (close 13:00 ET)', 'sesión corta (cierre 13:00 ET)')}`;
  const short = /^(.+) · séance écourtée$/.exec(title);
  if (short?.[1]) return `${holidayLabel(short[1])} · ${tr('séance écourtée', 'shortened session', 'sesión corta')}`;
  const row = EVENT_TITLE[title];
  return row ? tr(title, row[0], row[1]) : title;
}
