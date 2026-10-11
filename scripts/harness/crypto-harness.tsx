/**
 * Banc de capture de l'onglet 09 · CRY (CRY4.4) : le vrai onglet, monté dans le vrai `Shell`, sur un faux desk nourri des
 * réponses réelles du 9 octobre 2026 (`./recorded`). Chargé par `crypto.html` seulement : l'application ne l'importe jamais,
 * et le banc n'ouvre aucune connexion (le faux desk sert tout, la CSP de la page l'impose).
 *
 * `@/lib/desk` lit `window.canto` à son premier import : le faux desk est donc posé avant toute importation de l'application,
 * qui se fait ensuite, dynamiquement. `crypto.html` retient l'événement load jusqu'à `__releaseCapture`, appelé quand l'onglet
 * a reçu son historique, son direct rejoué, ses prix et sa température.
 */
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/doto/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@/design/tokens.css';
import { fakeCryptoDesk, fakeDeskApi } from './fakeCryptoDesk';
import { recordedFixtures } from './recorded';

declare global {
  interface Window {
    __releaseCapture?: () => void;
  }
}

/** Au-delà, le banc rend la main même si l'onglet n'est pas complet : mieux vaut une capture incomplète qu'un navigateur qui attend. */
const SETTLE_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });

async function until(done: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  while (!done()) {
    if (performance.now() - start > timeoutMs) return false;
    await sleep(50);
  }
  return true;
}

window.canto = fakeDeskApi(fakeCryptoDesk(recordedFixtures));

try {
  const [{ Shell }, { ErrorBoundary }, { default: Crypto }, { CHARTABLE_MARKETS }, { parseCandles }, { useCrypto }, { useUi }] = await Promise.all([
    import('@/app/Shell'),
    import('@/app/ErrorBoundary'),
    import('@/modules/crypto/Crypto'),
    import('@/engine/crypto/markets'),
    import('@/engine/crypto/venues'),
    import('@/store/crypto'),
    import('@/store/ui'),
  ]);

  /**
   * Un onglet habité, comme un trader l'aurait laissé : deux alertes de prix et une de liquidations posées par lui, une de
   * funding et un niveau posés par l'agent (qui s'inscrivent au journal de l'agent), un niveau du trader. Le coffre du
   * navigateur de capture est neuf ; pour un navigateur déjà utilisé, les réglages crypto sont d'abord remis à zéro.
   */
  const seed = async () => {
    const store = () => useCrypto.getState();
    await store().load();
    for (const alert of store().alerts) await store().deleteAlert(alert.id);
    for (const drawing of store().drawings) await store().removeDrawing(drawing.id);
    await store().setMarket('coinbase:BTC-USD');
    await store().setTimeframe(60);
    await store().createAlert({ target: 'coinbase:BTC-USD', kind: 'price_above', level: 83000, mode: 'once' });
    await store().createAlert({ target: 'coinbase:BTC-USD', kind: 'price_below', level: 81500, mode: 'rearm' });
    await store().createAlert({ target: 'binance:ONEUSDT', kind: 'price_below', level: 0.0021, mode: 'once' });
    await store().createAlert({ target: 'temperature', kind: 'liquidations_long_1h_above', level: 2_000_000, mode: 'once' });
    await store().createAlert({ target: 'temperature', kind: 'funding_median_above', level: 0.01, mode: 'rearm' }, 'agent');
    await store().addDrawing({ market: 'coinbase:BTC-USD', kind: 'level', price: 83000, label: 'R1' });
    await store().addDrawing({ market: 'coinbase:BTC-USD', kind: 'level', price: 82100, label: 'Support' }, 'agent');
  };

  await seed();
  useUi.getState().setTab('crypto');
  createRoot(document.getElementById('root')!).render(
    <Shell>
      <ErrorBoundary resetKey="crypto">
        <Crypto />
      </ErrorBoundary>
    </Shell>,
  );

  // La dernière bougie rejouée : l'historique, puis tout le direct, sont alors en place.
  const lastBar = parseCandles('coinbase', recordedFixtures.responses['coinbase:BTC-USD']?.[0]).at(-1);
  const settled = await until(() => {
    const s = useCrypto.getState();
    return (
      lastBar !== undefined &&
      s.bars.at(-1)?.time === lastBar.time &&
      s.cvdAnchoredAt !== null &&
      CHARTABLE_MARKETS.every((id) => s.tickers[id] !== undefined) &&
      s.temperature !== null
    );
  }, SETTLE_TIMEOUT_MS);
  if (!settled) console.error('[banc] l’onglet n’a pas reçu toutes ses données dans le délai');
  // Les polices, la fin des tickers rejoués, le tracé du chart (canevas, par image).
  await document.fonts.ready;
  await sleep(900);
  // `?scroll=end` : le bas de la colonne (Alertes, Source, Agent), que la fenêtre de 1000 px ne montre pas à l'ouverture.
  if (new URLSearchParams(window.location.search).get('scroll') === 'end') {
    const side = document.querySelector('main aside');
    if (side) side.scrollTop = side.scrollHeight;
  }
  await frames(3);
} catch (error) {
  console.error('[banc] échec du montage', error);
} finally {
  window.__releaseCapture?.();
}
