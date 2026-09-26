/**
 * Registre déclaratif des sources de données.
 * Aucun import : le process Electron compile ce fichier seul (`electron/tsconfig.sources.json`)
 * et l'appelle depuis `main.ts`. Un hôte LLM n'est pas une source, et inversement.
 */

export type SourceKind = 'marketdata' | 'calendar' | 'news' | 'reference';
export type Freshness = 'live' | 'delayed15' | 'eod' | 'scheduled' | 'static';
export type AuthMode = 'none' | 'byok' | 'local';

export interface DataSourceSpec {
  id: string;
  name: string;
  kind: SourceKind;
  /** Hôtes contactés par le process principal. Vide pour local/démo. Nom d'hôte nu. */
  hosts: string[];
  auth: AuthMode;
  freshness: Freshness;
  /** Limite déclarée par le fournisseur ; l'adaptateur doit la respecter côté main. */
  rateLimit?: { requests: number; perSeconds: number };
  /** URL des conditions et une phrase sur ce qu'elles permettent. */
  terms: { url?: string; summary: string };
  /** Vrai seulement si l'usage dans un logiciel distribué est permis par `terms`. */
  redistributable: boolean;
  /** Qui fournit la clé quand auth = 'byok'. */
  byokLabel?: string;
}

function isBareHost(host: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host);
}

export const SOURCES: DataSourceSpec[] = [
  {
    id: 'demo',
    name: 'Série synthétique',
    kind: 'marketdata',
    hosts: [],
    auth: 'none',
    freshness: 'static',
    terms: { summary: 'Bougies générées sur le poste. Aucune donnée tierce, aucun hôte.' },
    redistributable: true,
  },
  {
    id: 'csv',
    name: 'Import CSV',
    kind: 'marketdata',
    hosts: [],
    auth: 'local',
    freshness: 'static',
    terms: { summary: 'Fichier choisi par l’utilisateur. Il ne quitte pas le poste.' },
    redistributable: true,
  },
  {
    id: 'nt8-bridge',
    name: 'Pont NinjaTrader 8',
    kind: 'marketdata',
    hosts: [],
    auth: 'local',
    freshness: 'live',
    terms: { summary: 'Flux local entre NinjaTrader 8 et le desk. Aucune donnée ne quitte la machine.' },
    redistributable: true,
  },
  {
    id: 'bls',
    name: 'Bureau of Labor Statistics',
    kind: 'calendar',
    hosts: ['www.bls.gov', 'api.bls.gov'],
    auth: 'byok',
    freshness: 'scheduled',
    rateLimit: { requests: 500, perSeconds: 86_400 },
    terms: {
      url: 'https://www.bls.gov/developers/termsOfService.htm',
      summary: 'Séries du BLS, œuvre du gouvernement fédéral (domaine public). La clé d’enregistrement relève le quota (500 requêtes/jour) ; sans clé le quota anonyme est trop bas pour un desk.',
    },
    redistributable: true,
    byokLabel: 'Clé d’enregistrement BLS',
  },
  {
    id: 'bea',
    name: 'Bureau of Economic Analysis',
    kind: 'calendar',
    hosts: ['www.bea.gov', 'apps.bea.gov'],
    auth: 'byok',
    freshness: 'scheduled',
    terms: {
      url: 'https://apps.bea.gov/API/docs/index.htm',
      summary: 'Statistiques BEA, domaine public des États-Unis. L’API exige un UserID obtenu à l’inscription.',
    },
    redistributable: true,
    byokLabel: 'UserID BEA',
  },
  {
    id: 'fed',
    name: 'Federal Reserve Board',
    kind: 'calendar',
    hosts: ['www.federalreserve.gov'],
    auth: 'none',
    freshness: 'scheduled',
    terms: {
      url: 'https://www.federalreserve.gov/disclaimer.htm',
      summary: 'Publications et calendrier du Board of Governors, œuvre fédérale (domaine public). Pas de clé.',
    },
    redistributable: true,
  },
  {
    id: 'ecb',
    name: 'Banque centrale européenne',
    kind: 'calendar',
    hosts: ['www.ecb.europa.eu'],
    auth: 'none',
    freshness: 'scheduled',
    terms: {
      url: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html',
      summary: 'Statistiques publiques du SEBC : réutilisation gratuite si la source est citée et si les chiffres ne sont pas modifiés. Pas de clé.',
    },
    redistributable: true,
  },
  {
    id: 'cme',
    name: 'CME Group',
    kind: 'calendar',
    hosts: ['www.cmegroup.com'],
    auth: 'none',
    freshness: 'scheduled',
    terms: {
      url: 'https://www.cmegroup.com/market-data/license-data.html',
      summary: 'Les données de marché CME Group sont sous licence. Le site n’offre pas d’API calendrier librement redistribuable : la source ne s’active pas en production tant qu’un contrat ne le permet pas.',
    },
    redistributable: false,
  },
  {
    id: 'eia',
    name: 'Energy Information Administration',
    kind: 'calendar',
    hosts: ['www.eia.gov'],
    auth: 'none',
    freshness: 'scheduled',
    terms: {
      url: 'https://www.eia.gov/petroleum/supply/weekly/schedule.php',
      summary: 'Calendrier du Weekly Petroleum Status Report, domaine public des États-Unis. Page HTML, sans clé.',
    },
    redistributable: true,
  },
  {
    id: 'treasury',
    name: 'TreasuryDirect',
    kind: 'calendar',
    hosts: ['www.treasurydirect.gov'],
    auth: 'none',
    freshness: 'scheduled',
    terms: {
      url: 'https://www.treasurydirect.gov/TA_WS/securities/announced?format=json',
      summary: 'Adjudications annoncées, JSON public du Trésor, domaine public. Sans clé.',
    },
    redistributable: true,
  },
  {
    id: 'fred',
    name: 'FRED (Federal Reserve Bank of St. Louis)',
    kind: 'calendar',
    hosts: ['api.stlouisfed.org'],
    auth: 'byok',
    freshness: 'scheduled',
    rateLimit: { requests: 120, perSeconds: 60 },
    terms: {
      url: 'https://fred.stlouisfed.org/docs/api/terms_of_use.html',
      summary: 'L’API FRED autorise une application à interroger les séries avec une clé personnelle et une attribution. 120 requêtes par minute. La clé ne se partage pas.',
    },
    redistributable: true,
    byokLabel: 'Clé API FRED',
  },
  {
    id: 'investing',
    name: 'Investing.com',
    kind: 'calendar',
    hosts: ['endpoints.investing.com'],
    auth: 'none',
    freshness: 'scheduled',
    terms: {
      url: 'https://www.investing.com/about-us/terms-and-conditions',
      summary: 'Pas d’API publique. Les conditions interdisent l’extraction automatisée et la redistribution. redistributable: false. Retiré du calendrier (tâche 3) ; ligne documentaire, jamais contactée.',
    },
    redistributable: false,
  },
];

for (const spec of SOURCES) {
  if (SOURCES.filter((s) => s.id === spec.id).length !== 1) throw new Error(`Source en double : ${spec.id}`);
  for (const host of spec.hosts) {
    if (!isBareHost(host)) throw new Error(`Hôte invalide pour ${spec.id} : ${host}`);
  }
  if (spec.auth === 'byok' && !spec.byokLabel) throw new Error(`byokLabel manquant : ${spec.id}`);
}

export function getSource(id: string): DataSourceSpec {
  const spec = SOURCES.find((s) => s.id === id);
  if (!spec) throw new Error(`Source inconnue : ${id}`);
  return spec;
}

export function listSources(kind?: SourceKind): DataSourceSpec[] {
  return SOURCES.filter((s) => !kind || s.kind === kind);
}

/** Union des hôtes des sources redistribuables. Seule liste de production. */
export function allowedHosts(): string[] {
  const set = new Set<string>();
  for (const spec of SOURCES) {
    if (!spec.redistributable) continue;
    for (const host of spec.hosts) set.add(host.toLowerCase());
  }
  return [...set].sort();
}

/** Fetch de données du process principal. Seuls les hôtes de `allowedHosts()` (sources redistribuables). */
export function dataFetchAllowed(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts().includes(host);
}
