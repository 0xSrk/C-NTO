import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { tr, useI18n } from '@/i18n';
import { desk, type SeatApi } from '@/lib/desk';
import { useUi } from '@/store/ui';
import { scrambleFrame, scrambleSteps, SEAT_PROMPT, SEAT_STEP_MS, SEAT_STEPS } from './seatScramble';
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

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fait tourner `target` (six temps de 70 ms) puis le pose ; directement sous mouvement réduit. */
function useScramble(): { text: string; run: (target: string, reverse: boolean) => void; stop: () => void; set: (text: string) => void } {
  const [text, setText] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = useCallback(() => {
    for (const t of timers.current.splice(0)) clearTimeout(t);
  }, []);
  const run = useCallback(
    (target: string, reverse: boolean) => {
      stop();
      if (reducedMotion()) {
        setText(target);
        return;
      }
      scrambleSteps(reverse).forEach((step, k) => {
        timers.current.push(setTimeout(() => setText(scrambleFrame(target, step)), k * SEAT_STEP_MS));
      });
      timers.current.push(setTimeout(() => setText(target), SEAT_STEPS * SEAT_STEP_MS));
    },
    [stop],
  );
  useEffect(() => stop, [stop]);
  return { text, run, stop, set: setText };
}

function SeatGesture({ api, children }: { api: SeatApi; children: ReactNode }) {
  useI18n((st) => st.locale);
  const toast = useUi((u) => u.toast);
  const [client, setClient] = useState<string | null>(null);
  const name = useScramble();
  const prompt = useScramble();
  const [mode, setMode] = useState<Mode>('rest');
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [value, setValue] = useState('');
  const [reform, setReform] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = tr('Inscrire un siège', 'Register a seat', 'Inscribir un asiento');

  const { set: setName } = name;
  useEffect(() => {
    let live = true;
    api
      .status()
      .then((seat) => {
        // Au lancement, le nom est déjà là : il ne tourne pas.
        if (live && seat) {
          setClient(seat.client);
          setName(seat.client);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, setName]);

  const revealed = mode === 'rest' && (hover || focus);
  const { run: runPrompt, stop: stopPrompt } = prompt;
  useEffect(() => {
    if (!revealed) {
      stopPrompt();
      return;
    }
    setReform(false);
    runPrompt(SEAT_PROMPT, false);
  }, [revealed, runPrompt, stopPrompt]);

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
      name.run(result.client, true);
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
          <span aria-hidden>{name.text}</span>
          <span className={s.srOnly}>{client}</span>
        </span>
      )}
      {mode === 'rest' ? (
        <button
          type="button"
          className={s.trigger}
          aria-label={label}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onClick={() => {
            setValue('');
            setMode('open');
          }}
        >
          {revealed ? (
            <span className={s.prompt} aria-hidden>
              {prompt.text}
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
          {typed < [...SEAT_PROMPT].length && (
            <span className={s.rest} aria-hidden>
              {[...SEAT_PROMPT].slice(typed).join('')}
            </span>
          )}
        </span>
      )}
    </>
  );
}
