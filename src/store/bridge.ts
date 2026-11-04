import { create } from 'zustand';
import type { Bar } from '@/engine/bars';
import { killSwitchSummary, type KillSwitchReport } from '@/engine/execution/killSwitch';
import { FORMAT_LABEL } from '@/engine/import';
import { QuoteBook } from '@/engine/marketdata/quotes';
import { tr } from '@/i18n';
import { desk, type BridgeFilePayload, type BridgeStatus, type NtBridgeStatus } from '@/lib/desk';
import { uid } from '@/lib/id';
import { useBars } from './bars';
import { useJournal } from './journal';
import { useSettings } from './settings';
import { useUi } from './ui';

export interface BridgeLogEntry {
  id: string;
  at: number;
  file: string;
  kind: BridgeFilePayload['kind'];
  format: string;
  trades: number;
  sessionsAdded: number;
  sessionsMerged: number;
  warnings: string[];
  error?: string;
}

/** Le dernier rapport de coupure du kill switch, daté du départ des ordres d'aplatir (epoch ms). Lecture seule. */
export type LastKill = KillSwitchReport & { at: number };

/** Bornes du rapport reçu : un nom de compte comme le protocole du pont (1 à 128 caractères), une raison de l'AddOn (500). */
const KILL_MAX_ACCOUNTS = 1000;
const KILL_MAX_NAME = 128;
const KILL_MAX_ERROR = 500;

const plainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * La forme d'un rapport de coupure reçu du process principal (poussé par `ntbridge:kill-report` ou redemandé), validée
 * à la réception : `null` pour un rapport mal formé, que ni le store ni la bande ne lisent. Seuls les champs connus
 * sont recopiés ; rien d'autre n'entre dans le renderer. Un nombre de positions fermées (`closed`) négatif ou non fini
 * n'est pas gardé (la bande ne le lit pas), plutôt que d'effacer le rapport.
 */
export function parseKillReport(raw: unknown): LastKill | null {
  if (!plainObject(raw)) return null;
  const { at, sent, accounts, results } = raw;
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0 || typeof sent !== 'boolean') return null;
  if (!Array.isArray(accounts) || accounts.length > KILL_MAX_ACCOUNTS) return null;
  if (!accounts.every((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= KILL_MAX_NAME)) return null;
  if (!Array.isArray(results) || results.length > accounts.length) return null;
  const outcomes: LastKill['results'] = [];
  for (const row of results) {
    if (!plainObject(row) || typeof row.account !== 'string' || !accounts.includes(row.account) || typeof row.ok !== 'boolean') return null;
    if (row.closed !== undefined && typeof row.closed !== 'number') return null;
    if (row.error !== undefined && (typeof row.error !== 'string' || row.error.length > KILL_MAX_ERROR)) return null;
    const outcome: LastKill['results'][number] = { account: row.account, ok: row.ok };
    if (typeof row.closed === 'number' && Number.isFinite(row.closed) && row.closed >= 0) outcome.closed = row.closed;
    if (typeof row.error === 'string') outcome.error = row.error;
    outcomes.push(outcome);
  }
  return { at, accounts: [...accounts], sent, results: outcomes };
}

interface BridgeState {
  ready: boolean;
  available: boolean;
  status: BridgeStatus | null;
  nt: NtBridgeStatus | null;
  /** Rapport de la dernière coupure : la bande de niveau 3 le lit ; `null` tant qu'aucun n'est connu. */
  lastKill: LastKill | null;
  log: BridgeLogEntry[];
  busy: boolean;
  /** Vrai si l'écriture de bridge.json n'a pas pu restreindre les ACL Windows. */
  aclUnrestricted: boolean;
  load: () => Promise<void>;
  pickFolder: () => Promise<void>;
  useDefaultFolder: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  rescan: () => Promise<void>;
  openFolder: () => Promise<void>;
  rotateToken: () => Promise<void>;
  writeNtConfig: () => Promise<void>;
  allowRealAccount: (name: string) => Promise<void>;
  setMaxContracts: (n: number) => Promise<number | undefined>;
  killSwitch: () => Promise<void>;
}

let unsubscribeFile: (() => void) | null = null;
let unsubscribeNt: (() => void) | null = null;

/** Une exécution WebSocket : `importCsv` reprend les lots ouverts du compte et ignore une empreinte déjà connue. */
async function importExecutionCsv(csv: string, fileName: string): Promise<void> {
  const { settings } = useSettings.getState();
  const r = await useJournal.getState().importCsv(csv, { boundaryHour: settings.boundaryHour, riskPerContract: settings.riskPerContract || undefined, source: 'ninjatrader' });
  if (r.newTrades > 0) {
    useUi.getState().toast(
      tr(
        `Pont NinjaTrader · ${r.newTrades} trade(s) importé(s) (${fileName}).`,
        `NinjaTrader bridge · ${r.newTrades} trade(s) imported (${fileName}).`,
        `Puente NinjaTrader · ${r.newTrades} trade(s) importado(s) (${fileName}).`,
      ),
      'ok',
    );
  }
}

const IDLE: BridgeStatus = { enabled: false, folder: null, watching: false, files: 0, pending: 0, processed: 0 };

/** Dernière cotation reçue du pont, par instrument (lue par l'outil `market_quote`). Le desk ne s'abonne pas. */
export const bridgeQuotes = new QuoteBook();

/** Pont réellement actif : activé, dossier choisi, sans erreur. */
export function isBridgeLive(status: BridgeStatus | null | undefined): boolean {
  return !!status?.enabled && !!status.folder && !status.error;
}

export const useBridge = create<BridgeState>((set, get) => ({
  ready: false,
  available: !!desk,
  status: null,
  nt: null,
  lastKill: null,
  log: [],
  busy: false,
  aclUnrestricted: false,

  async load() {
    const api = desk?.bridge;
    if (!api) {
      set({ ready: true, status: IDLE });
      return;
    }
    if (!unsubscribeFile) {
      unsubscribeFile = api.onFile(async (file) => {
        const { settings } = useSettings.getState();
        const entry: BridgeLogEntry = { id: uid('bl'), at: Date.now(), file: file.name, kind: file.kind, format: 'inconnu', trades: 0, sessionsAdded: 0, sessionsMerged: 0, warnings: [] };
        let acceptedIds: string[] = [];
        let skipped = 0;
        try {
          // CSV de fichier ou de secours : même reprise des lots ouverts que le message WebSocket.
          const r = await useJournal.getState().importCsv(file.text, { boundaryHour: settings.boundaryHour, riskPerContract: settings.riskPerContract || undefined, source: 'ninjatrader' });
          entry.format = FORMAT_LABEL[r.format];
          entry.trades = r.newTrades;
          entry.sessionsAdded = r.added;
          entry.sessionsMerged = r.merged;
          entry.warnings = r.warnings;
          acceptedIds = [...new Set([...(r.tradeExecutionKeys ?? []).flat(), ...(r.freshExecutionKeys ?? [])])];
          skipped = r.skipped + Math.max(0, r.trades.length - r.newTrades);
          if (r.newTrades > 0) {
            useUi.getState().toast(
              tr(
                `Pont NinjaTrader · ${r.newTrades} trade(s) importé(s) depuis ${file.name} (${r.added} séance(s) créée(s), ${r.merged} fusionnée(s)).`,
                `NinjaTrader bridge · ${r.newTrades} trade(s) imported from ${file.name} (${r.added} session(s) created, ${r.merged} merged).`,
                `Puente NinjaTrader · ${r.newTrades} trade(s) importado(s) desde ${file.name} (${r.added} sesión(es) creada(s), ${r.merged} fusionada(s)).`,
              ),
              'ok',
            );
          } else if (r.format === 'inconnu') {
            useUi.getState().toast(
              tr(
                `Pont NinjaTrader · ${file.name} ignoré : format non reconnu.`,
                `NinjaTrader bridge · ${file.name} ignored: unrecognized format.`,
                `Puente NinjaTrader · ${file.name} ignorado: formato no reconocido.`,
              ),
              'warn',
            );
          }
        } catch (e) {
          entry.error = e instanceof Error ? e.message : String(e);
          useUi.getState().toast(
            tr(
              `Pont NinjaTrader · échec sur ${file.name} : ${entry.error}`,
              `NinjaTrader bridge · failure on ${file.name}: ${entry.error}`,
              `Puente NinjaTrader · fallo en ${file.name}: ${entry.error}`,
            ),
            'error',
          );
        }
        api.result(file.id, {
          format: entry.format,
          trades: entry.trades,
          sessionsAdded: entry.sessionsAdded,
          sessionsMerged: entry.sessionsMerged,
          warnings: entry.warnings,
          path: file.path,
          acceptedIds,
          skipped,
        });
        set({ log: [entry, ...get().log].slice(0, 60) });
      });
      api.onStatus((status) => set({ status }));
    }
    const ntApi = desk?.ntbridge;
    /** Un rapport de coupure validé remplace le dernier connu, sauf s'il date d'avant : l'ordre d'arrivée ne compte pas. */
    const takeKill = (raw: unknown) => {
      const cut = parseKillReport(raw);
      const known = get().lastKill;
      if (cut && (!known || cut.at >= known.at)) set({ lastKill: cut });
    };
    if (ntApi && !unsubscribeNt) {
      unsubscribeNt = ntApi.onStatus((nt) => set({ nt }));
      // Le rapport d'une coupure, poussé en lecture seule (raccourci global compris) : la bande dit quel compte reste à aplatir.
      ntApi.onKillReport?.(takeKill);
      ntApi.onExecution((payload) => {
        void importExecutionCsv(payload.csv, payload.executionId || 'ws').catch((e) => {
          useUi.getState().toast(e instanceof Error ? e.message : String(e), 'error');
        });
      });
      desk?.marketdata?.onEvent((event) => {
        const row = event as { kind: string; instrument?: string; timeframe?: number; bar?: Bar; final?: boolean; state?: string; quote?: unknown };
        if (row.kind === 'bar' && row.instrument && row.bar && typeof row.timeframe === 'number') {
          useBars.getState().applyNtBar(row.instrument, row.timeframe, row.bar, row.final === true);
        }
        if (row.kind === 'quote') bridgeQuotes.apply(row.quote, Date.now());
        if (row.kind === 'status') {
          useBars.getState().setNtFeed(row.state === 'live' ? 'live' : row.state === 'stale' ? 'stale' : 'closed');
        }
      });
    }
    set({ status: (await api.status()) ?? IDLE, nt: (await ntApi?.status()) ?? null, ready: true });
    // Abonné d'abord, puis redemandé : une coupure faite avant le chargement (verrou, rechargement) garde son rapport.
    takeKill(await ntApi?.lastKill?.());
  },

  async pickFolder() {
    const api = desk?.bridge;
    if (!api) return;
    const folder = await api.pickFolder();
    if (!folder) return;
    set({ busy: true });
    set({ status: (await api.configure({ folder, enabled: true })) ?? get().status, busy: false });
  },

  async useDefaultFolder() {
    const api = desk?.bridge;
    if (!api) return;
    set({ busy: true });
    const folder = await api.defaultFolder();
    if (folder) set({ status: (await api.configure({ folder, enabled: true })) ?? get().status });
    set({ busy: false });
  },

  async setEnabled(enabled) {
    const api = desk?.bridge;
    if (!api) return;
    set({ status: (await api.configure({ enabled })) ?? get().status });
  },

  async rescan() {
    const api = desk?.bridge;
    if (!api) return;
    set({ busy: true });
    set({ status: (await api.rescan()) ?? get().status, busy: false });
  },

  async openFolder() {
    const folder = get().status?.folder;
    if (folder && desk?.bridge) await desk.bridge.openFolder(folder);
  },

  async rotateToken() {
    const api = desk?.ntbridge;
    if (!api) return;
    await api.rotateToken();
    set({ nt: (await api.status()) ?? get().nt });
    useUi.getState().toast(tr('Jeton régénéré. Écrivez la configuration pour NinjaTrader.', 'Token regenerated. Write the NinjaTrader configuration.', 'Token regenerado. Escriba la configuración para NinjaTrader.'), 'ok');
  },

  async writeNtConfig() {
    const api = desk?.ntbridge;
    if (!api) return;
    const res = await api.writeConfig();
    if (res.ok && res.aclRestricted === false) {
      set({ aclUnrestricted: true });
      useUi.getState().toast(tr('permissions du fichier de configuration non restreintes', 'configuration file permissions are not restricted', 'permisos del archivo de configuración no restringidos'), 'warn');
      return;
    }
    if (res.ok) set({ aclUnrestricted: false });
    useUi.getState().toast(
      res.ok
        ? tr('Configuration écrite pour NinjaTrader.', 'Configuration written for NinjaTrader.', 'Configuración escrita para NinjaTrader.')
        : (res.error ?? tr('Écriture impossible.', 'Could not write the file.', 'Escritura imposible.')),
      res.ok ? 'ok' : 'error',
    );
  },

  async allowRealAccount(name) {
    const api = desk?.ntbridge;
    if (!api) return;
    set({ nt: (await api.allowAccount(name)) ?? get().nt });
  },

  async setMaxContracts(n) {
    const api = desk?.ntbridge;
    if (!api) return get().nt?.maxContractsPerOrder;
    const next = (await api.setMaxContracts(n)) ?? get().nt;
    set({ nt: next });
    return next?.maxContractsPerOrder;
  },

  async killSwitch() {
    const api = desk?.ntbridge;
    if (!api) return;
    // Le process principal date son rapport du départ des ordres d'aplatir ; le même rapport lui est poussé. Il se lit,
    // validé, comme le rapport poussé ; à défaut de date, celle de l'appel, l'envoi partant dès sa réception.
    const at = Date.now();
    const report = await api.killSwitch();
    const cut = parseKillReport({ at, ...report });
    const nt = (await api.status()) ?? get().nt;
    const known = get().lastKill;
    set({ nt, ...(cut && (!known || cut.at >= known.at) ? { lastKill: cut } : {}) });
    const { tone, text } = killSwitchSummary(report);
    useUi.getState().toast(text, tone);
  },
}));
