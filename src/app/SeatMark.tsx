import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { tr, useI18n } from '@/i18n';
import { desk, type SeatApi } from '@/lib/desk';
import { useUi } from '@/store/ui';
import { glyphDelays, glyphsAt, glyphsDuration, SEAT_DOMINO, SEAT_DWELL_MS, SEAT_EMERGE, SEAT_PROMPT, SEAT_REFORM_MS, SEAT_TICK_MS, type GlyphPlan } from './seatGlyphs';
import s from './seatMark.module.css';

/**
 * Siège nominatif dans le pied (`docs/SIEGE-NOMINATIF.md`) : le nom signé avant les barres, et le geste
 * caché dans les barres. Hors desk (navigateur), les barres seules : ni bouton, ni geste.
 */
export function SeatMark({ children }: { children: ReactNode }) {
  const api = desk?.seat;
  if (!api) return <>{children}</>;
  return <SeatGesture api={api}>{children}</SeatGesture>;
}

type Mode = 'rest' | 'open' | 'locked';

const PROMPT_LENGTH = [...SEAT_PROMPT].length;
const PROMPT_DURATION = glyphsDuration(PROMPT_LENGTH, SEAT_DOMINO);
/** Les barres s'effacent sous la vague : elles commencent sous le quatrième glyphe et finissent avec elle. */
const WIPE_DELAY = glyphDelays(PROMPT_LENGTH, SEAT_DOMINO)[3] ?? 0;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Horloge d'un geste : `t` avance par pas de 30 ms jusqu'à `duration`, après `delay` (pendant lequel
 * `t` vaut -1 : rien n'est encore paru). Sous mouvement réduit, `t` saute directement à la fin.
 */
function useGestureClock(): { t: number | null; start: (duration: number, delay?: number) => void; stop: () => void } {
  const [t, setT] = useState<number | null>(null);
  const timers = useRef<{ wait?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({});
  const clear = useCallback(() => {
    clearTimeout(timers.current.wait);
    clearInterval(timers.current.tick);
    timers.current = {};
  }, []);
  const stop = useCallback(() => {
    clear();
    setT(null);
  }, [clear]);
  const start = useCallback(
    (duration: number, delay = 0) => {
      clear();
      if (reducedMotion()) {
        setT(duration);
        return;
      }
      const run = () => {
        let now = 0;
        setT(0);
        timers.current.tick = setInterval(() => {
          now += SEAT_TICK_MS;
          if (now >= duration) {
            clearInterval(timers.current.tick);
            setT(duration);
          } else setT(now);
        }, SEAT_TICK_MS);
      };
      if (delay > 0) {
        setT(-1);
        timers.current.wait = setTimeout(run, delay);
      } else run();
    },
    [clear],
  );
  useEffect(() => clear, [clear]);
  return { t, start, stop };
}

/** Une rangée de glyphes au temps `t` ; ceux qui attendent gardent leur place, invisibles. */
function Glyphs({ text, t, plan, turnClass }: { text: string; t: number; plan: GlyphPlan; turnClass: string | undefined }) {
  return (
    <>
      {glyphsAt(text, t, plan).map((g, i) => (
        <span
          key={i}
          className={g.phase === 'wait' ? s.wait : g.phase === 'turn' ? turnClass : s.set}
          style={g.phase === 'turn' ? { animationDuration: `${plan.spin}ms` } : undefined}
        >
          {g.char}
        </span>
      ))}
    </>
  );
}

function SeatGesture({ api, children }: { api: SeatApi; children: ReactNode }) {
  useI18n((st) => st.locale);
  const toast = useUi((u) => u.toast);
  const [client, setClient] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('rest');
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [armed, setArmed] = useState(false);
  const [value, setValue] = useState('');
  const [reform, setReform] = useState(false);
  const prompt = useGestureClock();
  const name = useGestureClock();
  const input = useRef<HTMLInputElement>(null);
  const label = tr('Inscrire un siège', 'Register a seat', 'Inscribir un asiento');

  useEffect(() => {
    let live = true;
    api
      .status()
      .then((seat) => {
        // Au lancement, le nom est déjà là : il n'émerge pas.
        if (live && seat) setClient(seat.client);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  // Le geste ne s'éveille qu'après 2 s de présence sur les barres ; partir avant ne laisse aucune trace.
  const engaged = mode === 'rest' && (hover || focus);
  useEffect(() => {
    if (!engaged) {
      setArmed(false);
      return;
    }
    const id = setTimeout(() => setArmed(true), SEAT_DWELL_MS);
    return () => clearTimeout(id);
  }, [engaged]);

  const { start: startPrompt, stop: stopPrompt } = prompt;
  useEffect(() => {
    if (!armed) {
      stopPrompt();
      return;
    }
    setReform(false);
    startPrompt(PROMPT_DURATION);
  }, [armed, startPrompt, stopPrompt]);

  useEffect(() => {
    if (mode === 'open') input.current?.focus();
  }, [mode]);

  const close = () => {
    setValue('');
    setHover(false);
    setFocus(false);
    setMode('rest');
  };

  const submit = async () => {
    if (mode !== 'open') return;
    const line = value;
    setMode('locked');
    const result = await api.submit(line).catch(() => ({ ok: false as const }));
    if (result.ok) {
      setClient(result.client);
      // Les barres se reforment, puis le nom en sort, glyphe après glyphe.
      name.start(glyphsDuration([...result.client].length, SEAT_EMERGE), SEAT_REFORM_MS);
    } else {
      toast(tr('Siège refusé', 'Seat refused', 'Asiento rechazado'), 'warn');
    }
    setReform(true);
    close();
  };

  const typed = [...value].length;
  return (
    <>
      {client && (
        <span className={s.name} title={client}>
          <span aria-hidden>{name.t === null ? client : <Glyphs text={client} t={name.t} plan={SEAT_EMERGE} turnClass={s.rise} />}</span>
          <span className={s.srOnly}>{client}</span>
        </span>
      )}
      {mode === 'rest' ? (
        <button
          type="button"
          className={armed ? `${s.trigger} ${s.armed}` : s.trigger}
          aria-label={label}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onClick={() => {
            // Avant l'éveil, les barres ne sont que des barres.
            if (!armed) return;
            setValue('');
            setMode('open');
          }}
        >
          {armed && prompt.t !== null ? (
            <span className={s.row} aria-hidden>
              <span className={s.wipe} style={{ animationDelay: `${WIPE_DELAY}ms`, animationDuration: `${PROMPT_DURATION - WIPE_DELAY}ms` }}>
                {children}
              </span>
              <span className={s.prompt}>
                <Glyphs text={SEAT_PROMPT} t={prompt.t} plan={SEAT_DOMINO} turnClass={s.fall} />
              </span>
            </span>
          ) : (
            <span className={reform ? s.reform : s.bars} onAnimationEnd={() => setReform(false)}>
              {children}
            </span>
          )}
        </button>
      ) : (
        <span className={s.field} style={{ '--typed': typed } as CSSProperties}>
          <input
            ref={input}
            className={s.input}
            aria-label={label}
            value={value}
            readOnly={mode === 'locked'}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            onBlur={() => {
              if (mode === 'open') close();
            }}
          />
          {typed < PROMPT_LENGTH && (
            <span className={s.rest} aria-hidden>
              {[...SEAT_PROMPT].slice(typed).join('')}
            </span>
          )}
        </span>
      )}
    </>
  );
}
