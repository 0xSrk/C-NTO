import { useEffect, useState } from 'react';
import { IconPlus } from '@/app/icons';
import { Button, Toggle, cx } from '@/design/primitives';
import type { IndicatorDefinition, IndicatorInstance, IndicatorParam } from '@/engine/indicators';
import { tr, useI18n } from '@/i18n';
import s from './visual.module.css';

export function trIndicatorName(id: string, name: string): string {
  switch (id) {
    case 'ema':
      return tr('Moyenne mobile exponentielle', 'Exponential moving average', 'Media móvil exponencial');
    case 'sma':
      return tr('Moyenne mobile simple', 'Simple moving average', 'Media móvil simple');
    case 'vwap':
      return tr('VWAP de séance', 'Session VWAP', 'VWAP de sesión');
    case 'opening-range':
      return tr('Opening Range (RTH)', 'Opening Range (RTH)', 'Opening Range (RTH)');
    case 'prev-session':
      return tr('Niveaux séance précédente', 'Previous session levels', 'Niveles de la sesión anterior');
    case 'atr':
      return tr('Average True Range', 'Average True Range', 'Average True Range');
    case 'volume-ma':
      return tr('Volume relatif', 'Relative volume', 'Volumen relativo');
    default:
      return name;
  }
}

export function trIndicatorDesc(id: string, description: string): string {
  switch (id) {
    case 'ema':
      return tr('Tendance court/moyen terme. Les scalpers Nasdaq surveillent souvent EMA 9 / 21 sur 1–5 min.', 'Short/medium-term trend. Nasdaq scalpers often watch EMA 9 / 21 on 1–5 min.', 'Tendencia corto/medio plazo. Los scalpers del Nasdaq suelen vigilar EMA 9 / 21 en 1–5 min.');
    case 'sma':
      return tr('Moyenne arithmétique des clôtures. SMA 200 = référence de tendance long terme.', 'Arithmetic average of closes. SMA 200 = long-term trend reference.', 'Media aritmética de los cierres. SMA 200 = referencia de tendencia a largo plazo.');
    case 'vwap':
      return tr('Prix moyen pondéré par le volume, réinitialisé à chaque séance Globex (18:00 ET). Bandes ±1σ / ±2σ.', 'Volume-weighted average price, reset each Globex session (18:00 ET). Bands ±1σ / ±2σ.', 'Precio medio ponderado por volumen, reiniciado en cada sesión Globex (18:00 ET). Bandas ±1σ / ±2σ.');
    case 'opening-range':
      return tr('Plus haut / plus bas des premières minutes après 9:30 ET. Cassure = signal directionnel classique sur NQ.', 'High / low of the first minutes after 9:30 ET. Breakout = classic directional signal on NQ.', 'Máximo / mínimo de los primeros minutos tras las 9:30 ET. Ruptura = señal direccional clásica en NQ.');
    case 'prev-session':
      return tr('Plus haut, plus bas et clôture de la séance précédente : supports/résistances suivis par la majorité des intervenants.', 'Previous session high, low and close: supports/resistances watched by most participants.', 'Máximo, mínimo y cierre de la sesión anterior: soportes/resistencias seguidos por la mayoría de los participantes.');
    case 'atr':
      return tr('Volatilité moyenne par bougie, en points. Sert à dimensionner stops et objectifs.', 'Average volatility per candle, in points. Used to size stops and targets.', 'Volatilidad media por vela, en puntos. Sirve para dimensionar stops y objetivos.');
    case 'volume-ma':
      return tr('Volume de la bougie rapporté à sa moyenne mobile : > 1,5 signale une participation inhabituelle.', 'Candle volume relative to its moving average: > 1.5 signals unusual participation.', 'Volumen de la vela respecto a su media móvil: > 1,5 señala una participación inhabitual.');
    default:
      return description;
  }
}

export function trParamLabel(label: string): string {
  switch (label) {
    case 'Période':
      return tr('Période', 'Period', 'Periodo');
    case 'Bandes':
      return tr('Bandes', 'Bands', 'Bandas');
    case 'Durée (min)':
      return tr('Durée (min)', 'Duration (min)', 'Duración (min)');
    case 'Aucune':
      return tr('Aucune', 'None', 'Ninguna');
    case '±1σ':
      return tr('±1σ', '±1σ', '±1σ');
    case '±1σ et ±2σ':
      return tr('±1σ et ±2σ', '±1σ and ±2σ', '±1σ y ±2σ');
    default:
      return label;
  }
}

/** Saisie numérique de paramètre : l'état local absorbe les frappes, le store n'est mis à jour qu'au blur / Entrée. */
function NumberParam({ p, value, onCommit }: { p: IndicatorParam; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = () => {
    const n = Number(draft) || Number(p.default);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      min={p.min}
      max={p.max}
      step={p.step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

export interface IndicatorCardsProps {
  /** Les instances posées sur le chart, dans l'ordre d'affichage. Le titre les compte toutes. */
  instances: IndicatorInstance[];
  /** Le catalogue : ce que « Ajouter » propose, et où chaque instance retrouve sa définition (sans elle, pas de carte). */
  catalog: IndicatorDefinition[];
  /** Le nom affiché d'une définition ; `fallback` est son nom de définition. */
  nameOf: (id: string, fallback: string) => string;
  /** La description affichée d'une définition ; `fallback` est sa description de définition. */
  descOf: (id: string, fallback: string) => string;
  onAdd: (definitionId: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, number | string>) => void;
  onRemove: (id: string) => void;
}

/**
 * La section « Indicateurs » de la colonne de Visual, partagée avec l'onglet crypto : titre et compte, bouton « Ajouter »
 * et son catalogue, une carte par instance (interrupteur, nom, ×, paramètres, description), puis la note du Lab.
 * Le composant ne lit aucun store : les instances, le catalogue, la copie et les actions arrivent par les props.
 */
export function IndicatorCards({ instances, catalog, nameOf, descOf, onAdd, onToggle, onUpdate, onRemove }: IndicatorCardsProps) {
  useI18n((st) => st.locale);
  const [open, setOpen] = useState(false);
  return (
    <div className={s.sideSection}>
      <div className={s.sideTitle}>
        <span>{tr('Indicateurs', 'Indicators', 'Indicadores')} · {instances.length}</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          <IconPlus size={12} /> {tr('Ajouter', 'Add', 'Añadir')}
        </Button>
      </div>
      {open && (
        <div className={s.catalog}>
          {catalog.map((def) => (
            <button
              key={def.id}
              className={s.catalogItem}
              onClick={() => {
                onAdd(def.id);
                setOpen(false);
              }}
            >
              <small>{def.short}</small>
              <span>{nameOf(def.id, def.name)}</span>
            </button>
          ))}
        </div>
      )}
      {instances.map((inst) => {
        const def = catalog.find((d) => d.id === inst.definitionId);
        if (!def) return null;
        return (
          <div key={inst.id} className={cx(s.indicator, !inst.visible && s.off)}>
            <div className={s.indicatorHead}>
              <Toggle on={inst.visible} onChange={() => onToggle(inst.id)} />
              <b>{nameOf(def.id, def.name)}</b>
              <button onClick={() => onRemove(inst.id)} aria-label={tr('Retirer', 'Remove', 'Quitar')}>
                ×
              </button>
            </div>
            {def.params.length > 0 && (
              <div className={s.params}>
                {def.params.map((p) => (
                  <label key={p.key}>
                    {trParamLabel(p.label)}
                    {p.type === 'number' ? (
                      <NumberParam p={p} value={Number(inst.params[p.key])} onCommit={(v) => onUpdate(inst.id, { [p.key]: v })} />
                    ) : (
                      <select value={String(inst.params[p.key])} onChange={(e) => onUpdate(inst.id, { [p.key]: e.target.value })}>
                        {p.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {trParamLabel(o.label)}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                ))}
              </div>
            )}
            <div className={s.desc}>{descOf(def.id, def.description)}</div>
          </div>
        );
      })}
      <p className={s.desc}>{tr('Chaque nouvel indicateur forgé par le Lab rejoint ce catalogue avec ses paramètres : le graphique évolue avec la méthode du trader.', 'Each new indicator forged by the Lab joins this catalog with its parameters: the chart evolves with the trader’s method.', 'Cada nuevo indicador forjado por el Lab se une a este catálogo con sus parámetros: el gráfico evoluciona con el método del trader.')}</p>
    </div>
  );
}
