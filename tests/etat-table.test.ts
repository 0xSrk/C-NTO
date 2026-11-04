/**
 * @vitest-environment jsdom
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import e from '@/design/etat.module.css';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.1 — une seule table d'états pour le desk, `src/design/etat.module.css`, tenue par ce test (Système 5 « Fiche et
 * Frise », décision 3 de l'ADMIN, 2026-11-01). Quatre traits : plein ; contour plein et halo tireté de 3 px ; contour
 * plein et halo pointillé ; filet graphite `--line-2` sans motif. Le halo est le second contour de la Ligne V2, pas la
 * lueur de la LED. Aucun jeton : `tokens.css` ne bouge pas.
 */

const TABLE = 'src/design/etat.module.css';

/** La table : une classe par état, et ce que chaque état dit (décision 3, plan OROS5.1). */
const ETATS = {
  plein: ['en service', 'publié', 'décidé'],
  tirete: ['prévu', 'proposé', 'hypothèse', 'en attente'],
  pointille: ['au-delà de l’horizon'],
  eteint: ['fermé', 'en pause', 'désarmé', 'désactivé', 'hors service', 'en panne'],
} as const;
type Etat = keyof typeof ETATS;

/** Un trait tireté ou pointillé, en CSS, en SVG, au canevas ou dans la bibliothèque des graphiques. */
const DASH = /\bdashed\b|\bdotted\b|stroke-dasharray|strokeDasharray|setLineDash|\bLineStyle\.(?:Dashed|Dotted|LargeDashed|SparseDotted)\b/g;

/**
 * Le cliquet, hors de la table. Chaque trait tireté ou pointillé y figure, une règle CSS par son sélecteur
 * (« fichier › sélecteur »), un fichier de code par son compte (« fichier ×n »). Les deux listes ne font que décroître :
 * un porteur rendu à la table en sort, son plafond baisse avec lui, et aucun ne s'y ajoute (un trait nouveau passe par la
 * table). Le décor ne dit aucun état : OROS5.2 l'a vidé, le tireté ne dit plus qu'un état.
 */
const DECOR: readonly string[] = [];

/** OROS5.2 : ce qui décorait au tireté (dix séparateurs et l'état vide) passe au filet plein `--line-1`. */
const DECOR_RENDU: readonly (readonly [path: string, selector: string, side: 'border' | 'border-top' | 'border-bottom'])[] = [
  ['src/design/primitives.module.css', '.empty', 'border'],
  ['src/modules/agent/agent.module.css', '.toolItem', 'border-bottom'],
  ['src/modules/bot/bot.module.css', '.guard', 'border-bottom'],
  ['src/modules/calendrier/calendrier.module.css', '.markerCompact', 'border-bottom'],
  ['src/modules/calendrier/calendrier.module.css', '.histRow', 'border-bottom'],
  ['src/modules/copieur/copieur.module.css', '.preview', 'border-top'],
  ['src/modules/copieur/copieur.module.css', '.bridgeRow', 'border-bottom'],
  ['src/modules/crypto/crypto.module.css', '.marketRow', 'border-bottom'],
  ['src/modules/metrique/metrique.module.css', '.ringStats li', 'border-bottom'],
  ['src/modules/metrique/metrique.module.css', '.cascadeRules > div', 'border-bottom'],
  ['src/modules/visual/visual.module.css', '.tradeRow', 'border-bottom'],
];

/** Les porteurs qui disent un état hors de la table (elle les reprendra), ou tracent une série, un repère, un master. */
const PORTEURS: Readonly<Record<string, string>> = {
  'src/design/charts/Fan.tsx ×2': 'tracé · enveloppes p5 et p95 de la projection',
  'src/design/charts/LineArea.tsx ×4': 'tracé · série tiretée d’une courbe, réticule de lecture',
  'src/design/micro/assets.ts ×3': 'tracé · masters de la Ligne V2, générés hors du dépôt',
  'src/design/wordmark.module.css › .trait': 'tracé · le logotype se trace (construction du démarrage)',
  'src/design/wordmark.module.css › .pointe': 'tracé · la pointe lumineuse de la construction',
  'src/engine/crypto/indicators.ts ×7': 'tracé · bandes σ et niveaux de la veille (crypto)',
  'src/engine/indicators.ts ×9': 'tracé · bandes σ et niveaux de la veille',
  'src/modules/agent/CloudReports.tsx ×1': 'état · trait d’un rapport en construction',
  'src/modules/agent/reports.module.css › .plate.dashed': 'état · rapport en construction',
  'src/modules/agent/reports.module.css › .fiche.planned': 'état · rapport prévu',
  'src/modules/bot/bot.module.css › .template': 'état · modèle proposé, pas encore en service',
  "src/modules/calendrier/calendrier.module.css › .ev[data-stroke='prevu'], .fluxEv[data-stroke='prevu']": 'état · publication prévue dans la fenêtre',
  "src/modules/calendrier/calendrier.module.css › .ev[data-stroke='horizon'], .fluxEv[data-stroke='horizon']": 'état · publication au-delà de l’horizon',
  'src/modules/crypto/crypto.module.css › .alertRow .planTag': 'état · alerte armée, prévue',
  'src/modules/metrique/Analyse.tsx ×1': 'tracé · diagonale de référence',
  'src/modules/metrique/EquityChart.tsx ×3': 'tracé · grille et réticule de la courbe A.02',
  'src/modules/metrique/PropFirmView.tsx ×2': 'tracé · plancher et objectif sur la courbe du plan',
  'src/modules/metrique/metrique.module.css › .dropzone': 'état · en attente d’un fichier',
  'src/modules/note/Graph.tsx ×2': 'état · lien hypothèse du graphe',
  'src/modules/note/note.module.css › .preview :global(a.wikilink)': 'tracé · souligné d’un lien de note, au glacier',
  'src/modules/note/note.module.css › .preview :global(a.wikilink.missing)': 'état · lien vers une note à créer',
  'src/modules/visual/Chart.tsx ×8': 'tracé · indicateurs, lignes de prix, réticule, dernier prix',
};

/** Le plafond de chaque liste : il baisse avec elle et ne se relève jamais. */
const PLAFOND = { decor: 0, porteurs: 22 };

/** tokens.css tel que la décision 4 le fige (fins de ligne ramenées à LF). */
const TOKENS_SHA256 = '6f1d2accfe2f3dd99f5ca6be447396dcb9bc5494548fe51cf3449089c9e31a81';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(css|tsx?|mjs)$/.test(name)) out.push(relative('.', path).split(/[/\\]/).join('/'));
  }
  return out;
}

/** Les porteurs d'un trait tireté ou pointillé hors de la table, tels que le cliquet les nomme. */
function carriers(): string[] {
  const found: string[] = [];
  for (const path of walk('src')) {
    if (path === TABLE) continue;
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('.css')) {
      for (const rule of cssRules(text)) if (new RegExp(DASH.source).test(rule.body)) found.push(`${path} › ${rule.selector.replace(/\s+/g, ' ')}`);
    } else {
      const n = text.match(DASH)?.length ?? 0;
      if (n > 0) found.push(`${path} ×${n}`);
    }
  }
  return found;
}

const sheet = () => cssRules(readFileSync(TABLE, 'utf8'));
const selectorsOf = (selector: string) => selector.split(',').map((part) => part.trim());

/** La dernière valeur que la table donne à `prop` pour `selector` (règles groupées comprises). */
function decl(selector: string, prop: string): string | undefined {
  let value: string | undefined;
  for (const rule of sheet()) {
    if (!selectorsOf(rule.selector).includes(selector)) continue;
    for (const d of rule.body.split(';')) {
      const [name, ...rest] = d.split(':');
      if (name?.trim() === prop) value = rest.join(':').trim();
    }
  }
  return value;
}

const px = (value: string | undefined) => Number(/(-?\d+(?:\.\d+)?)px/.exec(value ?? '')?.[1] ?? NaN);

describe('OROS5.1 la table d’états du desk', () => {
  it('une classe par état, un état par classe : la feuille, la table de DESIGN.md et la décision 3 disent la même chose', () => {
    const classes = new Set<string>();
    for (const rule of sheet()) {
      for (const part of selectorsOf(rule.selector)) {
        // Une règle de la table ne vise qu'une de ses classes : une boîte HTML, le halo de l'une d'elles, ou, depuis
        // OROS5.24, un tracé SVG de la même classe (les marques de la frise) ; la table n'est pas dupliquée.
        expect(part, rule.selector).toMatch(/^(?:\.[a-z]+(?:::after)?|(?:line|rect|path)\.[a-z]+)$/);
        classes.add(part.replace('::after', '').replace(/^(?:line|rect|path)/, '').slice(1));
      }
    }
    expect([...classes].sort()).toEqual(Object.keys(ETATS).sort());

    const doc = readFileSync('docs/DESIGN.md', 'utf8');
    const section = doc.slice(doc.indexOf('**Table d’états**'), doc.indexOf('## 01.'));
    expect(section).toContain(TABLE);
    const rows = section.split('\n').filter((line) => /^\|.*`\.[a-z]+`/.test(line));
    expect(rows).toHaveLength(4);
    const told = new Map<string, string>();
    for (const row of rows) {
      const named = [...row.matchAll(/`\.([a-z]+)`/g)].map((m) => m[1]!);
      expect(named, row).toHaveLength(1);
      const etat = named[0] as Etat;
      expect(Object.keys(ETATS), row).toContain(etat);
      const dit = row.split('|').map((cell) => cell.trim()).filter(Boolean).at(-1)!;
      expect(dit.split(', '), row).toEqual([...ETATS[etat]]);
      for (const sens of ETATS[etat]) {
        // Un sens n'a qu'un trait.
        expect(told.get(sens), sens).toBeUndefined();
        told.set(sens, etat);
      }
    }
    expect(told.size).toBe(Object.values(ETATS).flat().length);
  });

  it('quatre traits : plein ; contour plein et halo tireté à 3 px ; halo pointillé ; filet graphite sans motif', () => {
    for (const etat of ['plein', 'tirete', 'pointille'] as const) expect(decl(`.${etat}`, 'border'), etat).toBe('1px solid var(--k)');
    expect(decl('.plein::after', 'content')).toBeUndefined();
    for (const [etat, motif] of [
      ['tirete', 'dashed'],
      ['pointille', 'dotted'],
    ] as const) {
      const halo = decl(`.${etat}::after`, 'border');
      expect(halo, etat).toBe(`1px ${motif} var(--k)`);
      expect(decl(`.${etat}::after`, 'position'), etat).toBe('absolute');
      expect(decl(`.${etat}::after`, 'pointer-events'), etat).toBe('none');
      // Le halo, hors de la boîte : 3 px entre le contour et lui.
      const gap = -px(decl(`.${etat}::after`, 'inset')) - px(halo) - px(decl(`.${etat}`, 'border'));
      expect(gap, etat).toBe(3);
    }
    expect(decl('.eteint', 'border')).toBe('1px solid var(--line-2)');
    expect(decl('.eteint::after', 'content')).toBeUndefined();
    // OROS5.24 : la même table pour les marques tracées (SVG) — le trait du tracé dit l'état, sans halo ; un trait par
    // état, le même pour une ligne, un rectangle ou un chemin.
    const traced = (etat: Etat, prop: string) => {
      const values = ['line', 'rect', 'path'].map((tag) => decl(`${tag}.${etat}`, prop));
      expect(new Set(values).size, `${etat} ${prop}`).toBe(1);
      return values[0];
    };
    for (const etat of ['plein', 'tirete', 'pointille'] as const) expect(traced(etat, 'stroke'), etat).toBe('var(--k)');
    expect(traced('plein', 'stroke-dasharray')).toBe('none');
    expect(traced('tirete', 'stroke-dasharray')).toMatch(/^\d+(?:\.\d+)? \d+(?:\.\d+)?$/);
    expect(traced('pointille', 'stroke-dasharray')).toMatch(/^0\.0\d+ \d+(?:\.\d+)?$/);
    expect(traced('pointille', 'stroke-linecap')).toBe('round');
    expect(traced('eteint', 'stroke')).toBe('var(--line-2)');
    expect(traced('eteint', 'stroke-dasharray')).toBe('none');
    const body = sheet()
      .filter((rule) => selectorsOf(rule.selector).some((part) => part.includes('.eteint')))
      .map((rule) => rule.body)
      .join('\n');
    // Éteint : ni motif, ni l'encre de la zone (l'autorité), ni halo.
    expect(body).not.toMatch(/dashed|dotted|var\(--k\)/);
    // Le halo n'est pas la lueur de la LED : aucune ombre, aucun flou, aucune animation, aucune couleur écrite.
    const css = readFileSync(TABLE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/box-shadow|filter|blur|animation|transition|#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it('hors de la table, tout trait tireté ou pointillé figure au cliquet, qui ne fait que décroître', () => {
    const found = carriers();
    const listed = [...DECOR, ...Object.keys(PORTEURS)];
    // Aucun porteur hors du cliquet : un trait nouveau passe par la table.
    expect(found.filter((where) => !listed.includes(where))).toEqual([]);
    // Le cliquet ne garde que des porteurs réels : un porteur rendu à la table en sort.
    expect(listed.filter((where) => !found.includes(where))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
    expect(DECOR).toHaveLength(PLAFOND.decor);
    expect(Object.keys(PORTEURS)).toHaveLength(PLAFOND.porteurs);
    for (const [where, dit] of Object.entries(PORTEURS)) expect(dit, where).toMatch(/^(?:état|tracé) · /);
  });

  it('OROS5.2 le tireté ne décore plus : le cliquet du décor est vide, chaque séparateur passe au filet plein --line-1', () => {
    expect(DECOR).toEqual([]);
    for (const [path, selector, side] of DECOR_RENDU) {
      const rule = cssRules(readFileSync(path, 'utf8')).find((r) => r.selector.replace(/\s+/g, ' ') === selector);
      expect(rule, `${path} › ${selector}`).toBeDefined();
      const value = rule!.body
        .split(';')
        .map((d) => d.split(':'))
        .find(([name]) => name?.trim() === side)
        ?.slice(1)
        .join(':')
        .trim();
      // Le même filet, à la même place : seul le motif s'en va.
      expect(value, `${path} › ${selector}`).toBe('1px solid var(--line-1)');
      expect(new RegExp(DASH.source).test(rule!.body), `${path} › ${selector}`).toBe(false);
    }
  });

  it('aucun jeton : tokens.css ne change pas', () => {
    const tokens = readFileSync('src/design/tokens.css', 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(tokens).digest('hex')).toBe(TOKENS_SHA256);
  });

  it('la légende L.01 du Calendrier renvoie à la table : plein, tireté, pointillé', async () => {
    const { useMacro } = await import('@/store/macro');
    const { useI18n } = await import('@/i18n');
    useI18n.setState({ locale: 'fr' });
    useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
    const { default: Calendrier } = await import('@/modules/calendrier/Calendrier');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Calendrier)));
    try {
      const swatches = [...host.querySelectorAll<HTMLElement>('[data-legend="trait"] [data-stroke]')];
      expect(swatches.map((el) => el.dataset.stroke)).toEqual(['publie', 'prevu', 'horizon']);
      const etats: Etat[] = ['plein', 'tirete', 'pointille'];
      swatches.forEach((el, i) => {
        for (const etat of Object.keys(ETATS) as Etat[]) expect(el.classList.contains(e[etat]!), `${el.dataset.stroke} · ${etat}`).toBe(etat === etats[i]);
      });
      // Le trait de la légende n'est plus écrit par le Calendrier : il vient de la table.
      const calendar = readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8');
      expect(cssRules(calendar).filter((rule) => /\.swatch/.test(rule.selector) && new RegExp(DASH.source).test(rule.body))).toEqual([]);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});

describe('OROS5.45b la pause, la panne et le fermé au filet graphite', () => {
  it('un rapport en pause, en défaut ou archivé, une alerte en pause et une étape verrouillée : le filet --line-2, sans motif (décision 3)', () => {
    const rule = (path: string, selector: string) => cssRules(readFileSync(path, 'utf8')).find((r) => r.selector.replace(/\s+/g, ' ') === selector)?.body ?? '';
    for (const [path, selector] of [
      ['src/modules/agent/reports.module.css', '.plate.off'],
      ['src/modules/crypto/crypto.module.css', '.alertRow .pauseTag'],
      ['src/modules/bot/bot.module.css', '.stage.locked'],
    ] as const) {
      const body = rule(path, selector);
      expect(body, `${path} › ${selector}`).toMatch(/border-color: var\(--line-2\)/);
      expect(new RegExp(DASH.source).test(body), `${path} › ${selector}`).toBe(false);
    }
    const reports = readFileSync('src/modules/agent/CloudReports.tsx', 'utf8');
    expect(reports).toMatch(/paused: r\.off/);
    expect(reports).toMatch(/fault: r\.off/);
    expect(reports).toMatch(/archived: r\.off/);
    // le prévu garde son tireté : un dossier en construction
    expect(reports).toMatch(/construction: r\.dashed/);
  });
});

describe('OROS5.45g le trait des publications ne vise que ce que le Calendrier pose', () => {
  it('chaque classe d’une règle [data-stroke] de la feuille du Calendrier est posée par le Calendrier ; .evCard, sans emploi, est sortie', () => {
    const css = readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8');
    const tsx = readFileSync('src/modules/calendrier/Calendrier.tsx', 'utf8');
    const classes = new Set<string>();
    for (const rule of cssRules(css)) {
      for (const part of rule.selector.split(',')) if (/\[data-stroke/.test(part)) for (const [, name] of part.matchAll(/\.([A-Za-z]\w*)/g)) classes.add(name!);
    }
    expect(classes.size).toBeGreaterThan(0);
    for (const name of classes) expect(tsx, name).toMatch(new RegExp(`\\bs\\.${name}\\b`));
    expect(css).not.toMatch(/\.evCard\b/);
  });
});
