import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/design/primitives';
import { Glyph } from '@/design/Micro';
import { Seal, SEAL_HORIZON } from '@/design/Seal';
import { opens } from '@/engine/gate';
import { tr, useI18n } from '@/i18n';
import { desk } from '@/lib/desk';
import { shortcutLabel } from './KillBand';
import { glyphsAt, SEAT_ALPHABET, SEAT_TICK_MS } from './seatGlyphs';
import { FADE_MS, FOLD_AT_MS, glyphCapacity, reducedTimeline, runUnlockCircuit, UNLOCK_GLYPH_MAX, UNLOCK_GLYPHS, UNLOCK_SEAL, unlockTimeline, WORD_AT_MS, WORD_MS, type UnlockTimeline } from './unlockCircuit';
import s from './gate.module.css';

/** L'horizon du sceau (48,27 % de sa hauteur) se pose sur la ligne de l'écran. */
const SEAL_HZ = `${(SEAL_HORIZON * 100).toFixed(2)}%`;
/** Les temps de l'ouverture, posés une fois ici et lus par la feuille ; le circuit lit les mêmes. */
const TIMING = {
  '--fold-at': `${FOLD_AT_MS / 1000}s`,
  '--word-at': `${WORD_AT_MS / 1000}s`,
  '--draw': `${WORD_MS / 1000}s`,
  '--fade-s': `${FADE_MS / 1000}s`,
  '--spin': `${UNLOCK_GLYPHS.spin}ms`,
} as CSSProperties;
/** Le caractère du champ masqué : les glyphes partent de ce que le champ montrait. */
const BULLET = '•';
/** La dernière lettre du Lab d'un glyphe qui tourne : c'est elle qui se pose en pastille. */
const LAST_FRAME = Math.floor((UNLOCK_GLYPHS.spin - 1) / UNLOCK_GLYPHS.frame);

/** Le rappel du raccourci, après un collage refusé (ms). */
const PASTE_HINT_MS = 3000;
/** Deux touchers plus proches font un double toucher (ms) : le délai du double-clic par défaut sous Windows. */
const DOUBLE_TAP_MS = 500;

/** Deux images plus tard : le rendu demandé avant est posé et peint. */
function afterFrames(run: () => void) {
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => window.setTimeout(cb, 16);
  frame(() => frame(run));
}

/** Ce que le champ masqué montre de points : sa largeur utile, et le pas d'un point (`1ch` de sa police et l'interlettre). */
function fieldCapacity(input: HTMLInputElement | null): number {
  if (!input) return UNLOCK_GLYPH_MAX;
  const cs = getComputedStyle(input);
  const inner = input.clientWidth - (Number.parseFloat(cs.paddingLeft) || 0) - (Number.parseFloat(cs.paddingRight) || 0);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return UNLOCK_GLYPH_MAX;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return glyphCapacity(inner, ctx.measureText('0').width + (Number.parseFloat(cs.letterSpacing) || 0));
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function UnlockMark({ active }: { active: boolean }) {
  return (
    <p className={active ? s.live : undefined} role="img" aria-label="Desk Unlocked">
      {UNLOCK_SEAL}
    </p>
  );
}

/**
 * Le verrou (4.1) : le sceau du Lab, et une fiche d'accès plus large — la phrase, « Coller » pour qui navigue à la
 * souris, « Fermer CΛNTO » pour qui n'a pas la phrase, « Ouvrir ». À l'ouverture, la phrase se défait en glyphes au
 * pas du code d'accolades, les glyphes se posent en pastilles et leurs pistes rejoignent le sceau, dont la lumière
 * rallume les lignes ; le point d'or s'allume au centre, le sceau glisse et se plie dans son horizon, le circuit
 * s'étend jusqu'aux bords, trace les lignes du châssis, et le voile se lève sur le desk déjà monté
 * (`src/app/unlockCircuit.ts`). Une touche, un clic ou un toucher abrège.
 */
export function Gate({ onAdmit, onReveal, onOpen }: { onAdmit: () => void; onReveal: () => void; onOpen: () => void }) {
  useI18n((st) => st.locale);
  const [value, setValue] = useState('');
  const [refused, setRefused] = useState(false);
  /** Le process principal a refusé « Coller » : le bouton montre le raccourci, un temps. */
  const [pasteHint, setPasteHint] = useState(false);
  /** Le rappel dit dans sa région vivante : vidé puis reposé à chaque refus, pour se faire entendre chaque fois. */
  const [hintSaid, setHintSaid] = useState(false);
  const hintTimer = useRef(0);
  const [busy, setBusy] = useState(false);
  /** La longueur de la phrase admise, seule chose qui en reste : la rangée de glyphes la remplace dans le champ. */
  const [cells, setCells] = useState<number | null>(null);
  /** Les points que le champ montre encore : le zoom de l'opérateur, rendu au montage du desk, peut le rétrécir. */
  const [room, setRoom] = useState<number | null>(null);
  /** Le plan de l'ouverture, deux images après l'admission. */
  const [unlock, setUnlock] = useState<UnlockTimeline | null>(null);
  const [t, setT] = useState(0);
  const [reduced] = useState(prefersReducedMotion);
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const glyphsRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** La phrase est admise : plus de seconde soumission, même avant que l'ouverture ne parte. */
  const admittedRef = useRef(false);
  /** Le dernier toucher (doigt, stylet), relevé dès le verrou : celui qui a ouvert précède l'ouverture. */
  const tapRef = useRef(Number.NEGATIVE_INFINITY);
  const admitRef = useRef(onAdmit);
  const revealRef = useRef(onReveal);
  const openRef = useRef(onOpen);
  admitRef.current = onAdmit;
  revealRef.current = onReveal;
  openRef.current = onOpen;

  const admitted = cells !== null;
  const live = unlock !== null;

  useEffect(() => () => window.clearTimeout(hintTimer.current), []);
  useEffect(() => {
    const note = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') tapRef.current = event.timeStamp;
    };
    window.addEventListener('pointerdown', note);
    return () => window.removeEventListener('pointerdown', note);
  }, []);
  // Admise, la phrase : le champ se remesure à chaque changement de taille, et la rangée de glyphes s'arrête à ce qu'il
  // montre avant d'être peinte. Le plan de l'ouverture garde la longueur admise.
  useEffect(() => {
    const input = inputRef.current;
    if (!admitted || reduced || !input || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => flushSync(() => setRoom(fieldCapacity(input))));
    observer.observe(input);
    return () => observer.disconnect();
  }, [admitted, reduced]);
  const hint = (on: boolean) => {
    window.clearTimeout(hintTimer.current);
    setPasteHint(on);
    setHintSaid(false);
    if (!on) return;
    afterFrames(() => setHintSaid(true));
    hintTimer.current = window.setTimeout(() => {
      setPasteHint(false);
      setHintSaid(false);
    }, PASTE_HINT_MS);
  };

  useEffect(() => {
    if (!unlock) return;
    const tl = unlock;
    // Une seule horloge pour les glyphes, les étapes de la feuille et le circuit ; l'abrègement l'avance.
    const t0 = performance.now();
    let offset = 0;
    let abridged = false;
    const clock = () => performance.now() - t0 + offset;
    let revealed = false;
    let opened = false;
    let id = 0;
    const tick = () => {
      const at = clock();
      if (!revealed && at >= tl.reveal) {
        revealed = true;
        revealRef.current();
      }
      setT(at);
      if (!opened && at >= tl.end) {
        opened = true;
        window.clearInterval(id);
        openRef.current();
      }
    };
    id = window.setInterval(tick, SEAT_TICK_MS);
    tick();
    const canvas = canvasRef.current;
    const stop =
      reduced || !canvas
        ? () => undefined
        : runUnlockCircuit(canvas, {
            timeline: tl,
            clock,
            abridged: () => abridged,
            pads: () => [...(glyphsRef.current?.children ?? [])].map((cell) => cell.getBoundingClientRect()),
            field: () => inputRef.current?.getBoundingClientRect() ?? null,
            seal: () => sealRef.current?.querySelector('svg')?.getBoundingClientRect() ?? null,
            sealCarrier: () => sealRef.current,
            word: () => wordRef.current?.querySelector('p')?.getBoundingClientRect() ?? null,
            chassis: () => ({
              title: document.querySelector('[data-chassis="title"]')?.getBoundingClientRect() ?? null,
              rail: document.querySelector('[data-chassis="rail"]')?.getBoundingClientRect() ?? null,
              status: document.querySelector('[data-chassis="status"]')?.getBoundingClientRect() ?? null,
            }),
          });
    // Une touche, un clic ou un toucher abrège : le voile se lève aussitôt sur le desk déjà monté. Seuls les échos du
    // geste qui a ouvert ne comptent pas : la répétition d'une touche tenue, le second clic d'un double-clic sur
    // « Ouvrir » (son `detail` compte les clics) ; tout geste neuf abrège, même aussitôt.
    const abridge = (event: Event) => {
      if (event instanceof KeyboardEvent && event.repeat) return;
      if (event instanceof MouseEvent && event.detail > 1) return;
      const at = clock();
      if (at >= tl.reveal) return;
      abridged = true;
      offset += tl.reveal - at;
      tick();
    };
    // Au doigt et au stylet, le geste compte dès le contact : leur `mousedown` n'arrive qu'au lever d'un toucher, et
    // jamais pour un doigt qui glisse. Le second toucher d'un double toucher sur « Ouvrir » reste un écho, comme le
    // second clic d'un double-clic.
    let tapAt = tapRef.current;
    const tap = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      const echo = event.timeStamp - tapAt < DOUBLE_TAP_MS;
      tapAt = event.timeStamp;
      if (!echo) abridge(event);
    };
    window.addEventListener('mousedown', abridge);
    window.addEventListener('keydown', abridge);
    window.addEventListener('pointerdown', tap);
    return () => {
      window.clearInterval(id);
      stop();
      window.removeEventListener('mousedown', abridge);
      window.removeEventListener('keydown', abridge);
      window.removeEventListener('pointerdown', tap);
    };
  }, [unlock, reduced]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || admittedRef.current) return;
    setBusy(true);
    const phrase = value;
    const ok = await opens(phrase);
    if (admittedRef.current) return;
    if (ok) {
      admittedRef.current = true;
      const count = Math.min(fieldCapacity(inputRef.current), [...phrase].length);
      // La phrase quitte le champ tout de suite, rendue à part avant le montage du desk : les points de la rangée de
      // glyphes, en attente, remplacent ceux du champ, et la fiche se ferme à la saisie.
      window.clearTimeout(hintTimer.current);
      flushSync(() => {
        setRefused(false);
        setPasteHint(false);
        setHintSaid(false);
        setValue('');
        setCells(count);
      });
      // « Coller » n'a plus d'appelant : le process principal le ferme pour la séance.
      desk?.window.pasteClose?.();
      // Le desk se monte dessous ; son premier rendu est lourd. L'horloge de l'ouverture part deux images plus tard, sur
      // un fil libre : sinon ses glyphes sauteraient et la fiche se figerait le temps du montage.
      admitRef.current();
      afterFrames(() => {
        inputRef.current?.blur();
        setT(0);
        setUnlock(reduced ? reducedTimeline() : unlockTimeline(count));
      });
      return;
    }
    setBusy(false);
    hint(false);
    setRefused(true);
    setValue('');
    inputRef.current?.focus();
    const plate = plateRef.current;
    if (plate && !reduced) {
      plate.animate(
        [
          { translate: '0 0' },
          { translate: '-2px 0', offset: 0.2 },
          { translate: '2px 0', offset: 0.45 },
          { translate: '-1px 0', offset: 0.7 },
          { translate: '0 0' },
        ],
        { duration: 420, easing: 'linear' },
      );
    }
  };

  /**
   * « Coller » : la phrase du presse-papiers entre dans le champ comme par Ctrl+V. Dans le desk, le process principal
   * colle dans le champ qui a le focus (le renderer ne lit pas le presse-papiers) ; dans un navigateur, l'API du
   * presse-papiers, si la page y a droit. Sinon, le champ garde le focus pour Ctrl+V.
   */
  const paste = async () => {
    const input = inputRef.current;
    if (!input || admittedRef.current) return;
    input.focus();
    if (desk?.window.paste) {
      // Sans geste réel récent (une aide technique, un clic de script), le process principal refuse : le champ garde le
      // focus, et le bouton dit le raccourci du clavier.
      const pasted = await desk.window.paste();
      if (pasted === false && !admittedRef.current) hint(true);
      return;
    }
    try {
      const text = (await navigator.clipboard?.readText?.()) ?? '';
      // La phrase a pu être admise pendant l'invite du navigateur : rien n'entre plus dans la fiche fermée.
      if (admittedRef.current) return;
      const line = text.replace(/[\r\n]+/g, '');
      if (line) {
        setRefused(false);
        setValue(line);
      }
    } catch {
      /* presse-papiers refusé : Ctrl+V reste possible, le champ a le focus */
    }
  };

  const stateWord = admitted ? tr('Ouvert', 'Open', 'Abierto') : refused ? tr('Refusé', 'Refused', 'Rechazado') : tr('Fermé', 'Closed', 'Cerrado');
  const lock = tr('VERROU', 'LOCK', 'CERROJO');
  const pasteKey = shortcutLabel('CommandOrControl+V');
  const past = (moment: number | undefined) => unlock !== null && moment !== undefined && t >= moment;
  // Les glyphes de la phrase, au temps de l'ouverture : en attente (avant l'horloge aussi), le point du champ ; puis les
  // lettres du Lab ; posés, la pastille d'où part leur piste. Autant que le champ en montre encore.
  const glyphs = cells !== null && !reduced ? glyphsAt(BULLET.repeat(cells), unlock ? t : -1, UNLOCK_GLYPHS).slice(0, room ?? cells) : null;

  return (
    <div
      ref={rootRef}
      className={[
        s.gate,
        live && s.admitted,
        past(unlock?.gold) && s.charged,
        past(unlock?.glide) && s.gliding,
        past(unlock?.spread) && s.spreading,
        past(unlock?.form) && s.forming,
        past(unlock?.reveal) && s.revealing,
        reduced && s.reduced,
        refused && s.denied,
      ]
        .filter(Boolean)
        .join(' ')}
      style={TIMING}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
    >
      <div className={s.texture} aria-hidden />

      <div className={s.hud} aria-hidden>
        <span>
          CΛNTO <i className={s.slash}>/</i> 002 · {live ? 'UNLOCK' : lock}
        </span>
      </div>

      {/* L'état du verrou pour les aides techniques, hors de la fiche : admise, elle devient inerte et son mot s'efface. */}
      <p className={s.srOnly} role="status">
        {stateWord}
      </p>
      {/* Le rappel du raccourci, dans sa propre région : il ne masque jamais l'état, et se vider ne s'annonce pas. */}
      <p className={s.srOnly} data-part="paste-hint" aria-live="polite" aria-atomic="true">
        {pasteHint && hintSaid ? tr(`Collez avec ${pasteKey}`, `Paste with ${pasteKey}`, `Pegue con ${pasteKey}`) : ''}
      </p>

      {/* La ligne d'horizon de l'écran : le sceau y pose le sien et s'y plie ; le mot s'en déplie. */}
      <span className={s.horizon} data-part="horizon-line" aria-hidden />

      <div className={s.stage}>
        {/* Le sceau ferme le verrou ; c'est lui que rejoint le circuit de l'ouverture. */}
        <div className={s.sealbox}>
          <div ref={sealRef} className={s.sealw} data-part="seal" style={{ '--hz': SEAL_HZ } as CSSProperties}>
            <Seal kind="negative" className={s.sealSvg} />
          </div>
        </div>
        <div className={s.stack}>
          <h2 className={s.heading}>
            <span className={s.nm}>SIΞRRΛSKΛ LAB · ARTEFACT 002</span>
            <span id="gate-title">{tr('Desk verrouillé', 'Desk locked', 'Desk bloqueado')}</span>
          </h2>
          {/* Fiche d'accès (Ligne V2) : aucun code ici — le seul code du desk est au pied de la barre d'état. */}
          <form ref={plateRef} className={s.fiche} data-part="fiche" inert={admitted} onSubmit={(event) => void submit(event)}>
            <div className={s.fh}>
              <span>{tr('FICHE D’ACCÈS', 'ACCESS SHEET', 'FICHA DE ACCESO')}</span>
              <span>SK-ART-002 / {lock}</span>
            </div>
            <div className={s.fin}>
              <div className={s.fieldHead}>
                <label htmlFor={inputId} className={s.fieldLabel}>
                  {tr('Phrase', 'Phrase', 'Frase')}
                </label>
                <span className={s.stateLine}>
                  <i className={s.led} aria-hidden />
                  <span className={s.state} aria-hidden>
                    {stateWord}
                  </span>
                </span>
              </div>
              <div className={s.inputRow}>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="password"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  aria-invalid={refused}
                  value={value}
                  onChange={(event) => {
                    setRefused(false);
                    if (pasteHint) hint(false);
                    setValue(event.target.value);
                  }}
                />
                {glyphs ? (
                  <span ref={glyphsRef} className={s.glyphs} data-part="unlock-glyphs" aria-hidden>
                    {glyphs.map((g, i) => (
                      <span key={i} className={s.cell} data-phase={g.phase}>
                        <i className={g.phase === 'turn' ? s.turn : g.phase === 'set' ? s.pad : undefined}>{g.phase === 'set' ? SEAT_ALPHABET[(i * 3 + LAST_FRAME * 7) % SEAT_ALPHABET.length] : g.char}</i>
                      </span>
                    ))}
                  </span>
                ) : null}
                {/* Le champ garde le focus : le clic ne le lui prend pas, le collage y entre. */}
                {/* Les deux libellés dans la même case : le bouton garde la largeur du plus long quand il montre le raccourci. */}
                <button type="button" className={s.paste} data-part="paste" onMouseDown={(event) => event.preventDefault()} onClick={() => void paste()}>
                  <span aria-hidden={pasteHint || undefined}>{tr('Coller', 'Paste', 'Pegar')}</span>
                  <span aria-hidden={!pasteHint || undefined}>{pasteKey}</span>
                </button>
              </div>
              <div className={s.row}>
                {desk ? (
                  <Button variant="ghost" data-part="close-canto" onClick={() => desk?.window.close()}>
                    {tr('Fermer CΛNTO', 'Close CΛNTO', 'Cerrar CΛNTO')}
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" variant="chamfer" disabled={busy || value.length === 0}>
                  {tr('Ouvrir', 'Open', 'Abrir')}
                  <Glyph name="arrowOpen" className={s.bi} />
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className={s.unlock} ref={wordRef} aria-hidden={!live}>
        <UnlockMark active={past(unlock?.spread)} />
      </div>

      {unlock && !reduced ? <canvas ref={canvasRef} className={s.circuit} data-part="unlock-circuit" aria-hidden /> : null}
    </div>
  );
}
