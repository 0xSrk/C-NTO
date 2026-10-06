/**
 * Suivi NinjaTrader de Visual : le contrat demandé, le bouton, l'état et l'échec, sous les yeux du trader.
 * Lecture seule : un historique borné puis le direct ; aucun ordre ne part d'ici. L'agent ne s'en sert pas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tag } from '@/design/primitives';
import type { Bar } from '@/engine/bars';
import { resolveSymbol } from '@/engine/instruments';
import { createPort, type MarketDataPort, type Nt8Transport } from '@/engine/marketdata';
import { tr, useI18n } from '@/i18n';
import { isNtContract, normalizeContract, ntContract, quarterlyMonth } from './ntContract';
import { followNt, HISTORY_DAYS, mergeLiveBar, type NtFollow } from './ntFollow';
import s from './visual.module.css';

export type FollowPhase = 'idle' | 'loading' | 'live' | 'failed';

/** Échec gardé tel quel : le texte se compose au rendu, dans la langue active. */
export type FollowFailure = { kind: 'offline' } | { kind: 'contract'; instrument: string } | { kind: 'bridge'; detail: string; contract: string };

/** Texte d'un échec du suivi, dans la langue active. */
export function followFailureText(failure: FollowFailure): string {
  if (failure.kind === 'offline') {
    return tr('Le pont NinjaTrader n’est pas ouvert : Visual suit NinjaTrader depuis le desk installé.', 'The NinjaTrader bridge is not open: Visual follows NinjaTrader from the installed desk.', 'El puente NinjaTrader no está abierto: Visual sigue NinjaTrader desde el desk instalado.');
  }
  if (failure.kind === 'contract') {
    const example = `${failure.instrument} ${quarterlyMonth(Date.now())}`;
    return tr(
      `Saisissez le contrat NinjaTrader complet de ${failure.instrument}, par exemple ${example}.`,
      `Enter the full NinjaTrader contract for ${failure.instrument}, for example ${example}.`,
      `Introduzca el contrato NinjaTrader completo de ${failure.instrument}, por ejemplo ${example}.`,
    );
  }
  const { detail, contract } = failure;
  if (/aucune source live|pont indisponible|pont perdu|pont arrêté|connexion remplacée/i.test(detail)) {
    return tr(
      'Pont NinjaTrader hors ligne : rien à suivre. Vérifiez l’AddOn dans Métrique › Pont NinjaTrader.',
      'NinjaTrader bridge offline: nothing to follow. Check the AddOn in Metrics › NinjaTrader bridge.',
      'Puente NinjaTrader desconectado: nada que seguir. Compruebe el AddOn en Métrica › Puente NinjaTrader.',
    );
  }
  if (/instrument inconnu/i.test(detail)) {
    return tr(
      `NinjaTrader ne connaît pas « ${contract} ». Saisissez le contrat tel que NinjaTrader l’écrit, racine et échéance (NQ 12-26).`,
      `NinjaTrader does not know “${contract}”. Enter the contract as NinjaTrader writes it, root and expiry (NQ 12-26).`,
      `NinjaTrader no conoce « ${contract} ». Introduzca el contrato tal como lo escribe NinjaTrader, raíz y vencimiento (NQ 12-26).`,
    );
  }
  if (/délai dépassé/i.test(detail)) {
    return tr(
      'NinjaTrader n’a pas répondu à temps. Réessayez : un premier chargement d’historique peut être long.',
      'NinjaTrader did not answer in time. Try again: a first history load can be slow.',
      'NinjaTrader no respondió a tiempo. Inténtelo de nuevo: una primera carga de histórico puede tardar.',
    );
  }
  const why = detail.trim() || '—';
  return tr(`Le pont NinjaTrader a refusé « ${contract} » : ${why}`, `The NinjaTrader bridge refused “${contract}”: ${why}`, `El puente NinjaTrader rechazó « ${contract} »: ${why}`);
}

/** Source des barres à l'écran : le pont dès que Visual le suit, sinon celle de la série choisie. */
export function shownSource(source: string, following: boolean): 'nt8' | 'demo' | 'csv' {
  if (following || source === 'nt8-bridge') return 'nt8';
  return source === 'demo' ? 'demo' : 'csv';
}

export interface NtFollowInput {
  /** Instrument de la série affichée (racine du registre, ou contrat). */
  instrument: string | null;
  timeframe: number | null;
  /** Transport IPC du pont (`marketdata:*`) ; absent hors du desk installé. */
  transport?: Nt8Transport;
  /** Contrats complets vus sur le pont (`contractsSeen`). */
  seen: readonly string[];
}

export interface NtFollowState {
  phase: FollowPhase;
  /** Historique demandé ou flux en cours. */
  following: boolean;
  /** Contrat suivi, sinon celui du champ (saisi, ou proposé). */
  contract: string;
  setContract: (value: string) => void;
  /** Barres du pont, `null` hors suivi et tant que l'historique n'est pas arrivé. */
  bars: Bar[] | null;
  failure: FollowFailure | null;
  start: () => void;
  stop: () => void;
}

export function useNtFollow({ instrument, timeframe, transport, seen }: NtFollowInput): NtFollowState {
  const [phase, setPhase] = useState<FollowPhase>('idle');
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [failure, setFailure] = useState<FollowFailure | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  const followRef = useRef<NtFollow | null>(null);
  const portRef = useRef<MarketDataPort | null>(null);
  const contractRef = useRef('');
  const seenRef = useRef(seen);
  useEffect(() => {
    seenRef.current = seen;
  }, [seen]);

  const root = instrument ? (resolveSymbol(normalizeContract(instrument))?.symbol ?? normalizeContract(instrument)) : null;
  const suggested = useMemo(() => (instrument ? ntContract(instrument, seen, Date.now()) : null), [instrument, seen]);
  // Autre racine affichée : le champ repart de la proposition.
  useEffect(() => setDraft(null), [root]);

  const teardown = useCallback(() => {
    followRef.current?.stop();
    followRef.current = null;
    portRef.current?.dispose();
    portRef.current = null;
  }, []);

  const fail = useCallback(
    (next: FollowFailure) => {
      teardown();
      setBars(null);
      setFollowed(null);
      setFailure(next);
      setPhase('failed');
    },
    [teardown],
  );

  const stop = useCallback(() => {
    teardown();
    setBars(null);
    setFollowed(null);
    setFailure(null);
    setPhase('idle');
  }, [teardown]);

  const start = useCallback(() => {
    if (!instrument || !timeframe) return;
    teardown();
    setBars(null);
    if (!transport) return fail({ kind: 'offline' });
    const contract = normalizeContract(draft ?? suggested ?? '');
    if (!isNtContract(contract)) return fail({ kind: 'contract', instrument: root ?? instrument });
    contractRef.current = contract;
    setFollowed(contract);
    setFailure(null);
    setPhase('loading');
    const port = createPort('nt8-bridge', { nt8: transport });
    portRef.current = port;
    followRef.current = followNt(
      port,
      contract,
      timeframe,
      (history) => {
        setBars(history);
        setPhase('live');
      },
      (event) => {
        if (event.kind === 'bar') setBars((prev) => mergeLiveBar(prev, event.bar));
      },
      (detail) => fail({ kind: 'bridge', detail, contract: contractRef.current }),
    );
  }, [instrument, timeframe, transport, draft, suggested, root, teardown, fail]);

  // Série changée pendant le suivi : même racine, même contrat ; autre racine, le contrat de celle-ci.
  useEffect(() => {
    const follow = followRef.current;
    if (!follow || !instrument || !timeframe) return;
    const current = contractRef.current;
    const sameRoot = resolveSymbol(current)?.symbol === resolveSymbol(normalizeContract(instrument))?.symbol;
    const contract = sameRoot ? current : ntContract(instrument, seenRef.current, Date.now());
    if (!contract) {
      fail({ kind: 'contract', instrument: resolveSymbol(normalizeContract(instrument))?.symbol ?? instrument });
      return;
    }
    contractRef.current = contract;
    setFollowed(contract);
    // Nouvelle cible : les barres de l'ancienne quittent l'écran sans attendre la réponse de NinjaTrader.
    if (follow.retarget(contract, timeframe)) {
      setBars(null);
      setPhase('loading');
    }
  }, [instrument, timeframe, fail]);

  useEffect(() => teardown, [teardown]);

  return {
    phase,
    following: phase === 'loading' || phase === 'live',
    contract: followed ?? draft ?? suggested ?? '',
    setContract: setDraft,
    bars,
    failure,
    start,
    stop,
  };
}

/** Bloc « Pont NinjaTrader » de la colonne de Visual. */
export function NtFollowPanel({ follow, disabled }: { follow: NtFollowState; disabled?: boolean }) {
  useI18n((state) => state.locale);
  const empty = follow.phase === 'live' && follow.bars?.length === 0;
  return (
    <div className={s.sideSection}>
      <div className={s.sideTitle}>
        <span>{tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')}</span>
        {follow.phase === 'loading' && <Tag>{tr('historique…', 'history…', 'histórico…')}</Tag>}
        {follow.phase === 'live' && <Tag tone="mint">{tr('suivi', 'following', 'siguiendo')}</Tag>}
        {follow.phase === 'failed' && <Tag tone="ember">{tr('échec', 'failed', 'fallo')}</Tag>}
      </div>
      <div className={s.follow}>
        <input
          value={follow.contract}
          onChange={(event) => follow.setContract(event.target.value)}
          disabled={follow.following}
          spellCheck={false}
          placeholder={`NQ ${quarterlyMonth(Date.now())}`}
          aria-label={tr('Contrat NinjaTrader', 'NinjaTrader contract', 'Contrato NinjaTrader')}
        />
        <Button size="sm" variant="ghost" disabled={disabled} onClick={follow.following ? follow.stop : follow.start}>
          {follow.following ? tr('Ne plus suivre', 'Stop following', 'Dejar de seguir') : tr('Suivre le pont', 'Follow the bridge', 'Seguir el puente')}
        </Button>
      </div>
      {follow.failure ? (
        <div className={s.desc} role="alert">
          {followFailureText(follow.failure)}
        </div>
      ) : (
        <div className={s.desc}>
          {empty
            ? tr(`NinjaTrader n’a rendu aucune barre sur ${HISTORY_DAYS} jours : le direct s’affichera ici.`, `NinjaTrader returned no bar over ${HISTORY_DAYS} days: live bars will show here.`, `NinjaTrader no devolvió ninguna barra en ${HISTORY_DAYS} días: el directo se mostrará aquí.`)
            : tr(
                `Contrat complet, tel que NinjaTrader l’écrit (racine et échéance). ${HISTORY_DAYS} jours d’historique, puis le direct. Lecture seule.`,
                `Full contract, as NinjaTrader writes it (root and expiry). ${HISTORY_DAYS} days of history, then live. Read only.`,
                `Contrato completo, tal como lo escribe NinjaTrader (raíz y vencimiento). ${HISTORY_DAYS} días de histórico, luego el directo. Solo lectura.`,
              )}
        </div>
      )}
    </div>
  );
}
