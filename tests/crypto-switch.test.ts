import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentDialogOptions } from '../electron/agent-orders';
import { CryptoSwitchHost } from '../electron/crypto-switch';
import type { AppLocale } from '../electron/locale';

type Win = { isDestroyed(): boolean };

interface HarnessOptions {
  /** Réponses successives du dialogue (0 = Activer, 1 = Annuler) ; Annuler quand la liste est vide. */
  answers?: number[];
  /** Le dialogue reste ouvert jusqu'à `answer()` : pour les appels qui se chevauchent. */
  hold?: boolean;
  /** Le dialogue échoue (fenêtre détruite pendant l'attente, par exemple). */
  fail?: boolean;
  /** Valeur brute rendue par le dialogue, mal formée : `undefined`, `null`, `{}`, `{ response: '0' }`… */
  reply?: unknown;
  dir?: string;
  locale?: AppLocale;
  window?: Win | null;
}

function harness(opts: HarnessOptions = {}) {
  const dir = opts.dir ?? mkdtempSync(path.join(tmpdir(), 'canto-crypto-switch-'));
  const win: Win | null = opts.window === undefined ? { isDestroyed: () => false } : opts.window;
  const dialogs: AgentDialogOptions[] = [];
  const parents: Win[] = [];
  const logs: string[] = [];
  const answers = [...(opts.answers ?? [])];
  const waiting: Array<(answer: { response: number }) => void> = [];
  let locale: AppLocale = opts.locale ?? 'fr';
  const host = new CryptoSwitchHost({
    userDataDir: dir,
    locale: () => locale,
    window: () => win,
    showMessageBox: (parent, options) => {
      parents.push(parent);
      dialogs.push(options);
      if (opts.fail) return Promise.reject(new Error('fenêtre détruite'));
      if ('reply' in opts) return Promise.resolve(opts.reply as { response: number });
      if (opts.hold) return new Promise<{ response: number }>((resolve) => waiting.push(resolve));
      return Promise.resolve({ response: answers.shift() ?? 1 });
    },
    log: (line) => logs.push(line),
  });
  return {
    host,
    dir,
    win,
    dialogs,
    parents,
    logs,
    file: path.join(dir, 'crypto.json'),
    /** Répond au plus ancien dialogue resté ouvert (`hold`). */
    answer: (response: number) => waiting.shift()?.({ response }),
    setLocale: (next: AppLocale) => {
      locale = next;
    },
  };
}

/** Contenu du fichier d'état, `undefined` s'il n'existe pas. */
const written = (file: string): unknown => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined);

const CLOSED_WINDOWS: ReadonlyArray<[string, Win | null]> = [
  ['absente', null],
  ['détruite', { isDestroyed: () => true }],
];

const LANGUAGES = [
  [
    'fr',
    'Activer le module crypto ?',
    ['Activer', 'Annuler'],
    ['usage personnel', 'à tout moment', 'Ce choix vaut aussi pour les prochains lancements, jusqu’à ce que vous éteigniez le module.'],
  ],
  [
    'en',
    'Turn on the crypto module?',
    ['Turn on', 'Cancel'],
    ['personal use', 'at any time', 'This choice also applies to the next launches, until you turn the module off.'],
  ],
  [
    'es',
    '¿Activar el módulo cripto?',
    ['Activar', 'Cancelar'],
    ['uso personal', 'en cualquier momento', 'Esta elección también se aplica a los próximos arranques, hasta que apague el módulo.'],
  ],
] as const;

describe('interrupteur crypto · process principal', () => {
  it('éteint par défaut : ni fichier écrit ni dialogue ouvert à la construction', () => {
    const h = harness();
    expect(h.host.enabled).toBe(false);
    expect(existsSync(h.file)).toBe(false);
    expect(h.dialogs).toEqual([]);
  });

  it.each([1, -1, 2])('réponse %i (autre que « Activer ») : reste éteint, rien n’est écrit à true', async (response) => {
    const h = harness({ answers: [response] });
    expect(await h.host.requestEnable()).toBe(false);
    expect(h.host.enabled).toBe(false);
    expect(h.dialogs).toHaveLength(1);
    expect(written(h.file)).not.toEqual({ enabled: true });
    expect(harness({ dir: h.dir }).host.enabled).toBe(false);
  });

  it('réponse 0 (« Activer ») : allumé, fichier {"enabled":true}, un nouvel hôte relit allumé sans rien demander', async () => {
    const h = harness({ answers: [0] });
    expect(await h.host.requestEnable()).toBe(true);
    expect(h.host.enabled).toBe(true);
    expect(readFileSync(h.file, 'utf8')).toBe('{"enabled":true}');
    if (process.platform !== 'win32') expect(statSync(h.file).mode & 0o777).toBe(0o600); // bits de mode sans effet sous Windows
    expect(h.parents).toEqual([h.win]);

    const restarted = harness({ dir: h.dir });
    expect(restarted.host.enabled).toBe(true);
    expect(restarted.dialogs).toEqual([]);
  });

  it('crée le dossier de données s’il manque', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'canto-crypto-switch-'));
    const h = harness({ dir: path.join(root, 'profil', 'neuf'), answers: [0] });
    expect(await h.host.requestEnable()).toBe(true);
    expect(written(h.file)).toEqual({ enabled: true });
  });

  describe('lecture du fichier', () => {
    it('un fichier {"enabled":true} allume, champs inconnus ignorés', () => {
      const h = harness();
      writeFileSync(h.file, '{"enabled":true,"autre":1}');
      expect(harness({ dir: h.dir }).host.enabled).toBe(true);
    });

    it.each(['', '{', '{"enabled":tru', 'null', 'true', '[]', '{}', '{"enabled":false}', '{"enabled":"true"}', '{"enabled":1}'])(
      'fichier corrompu ou de la mauvaise forme %j → éteint',
      (content) => {
        const h = harness();
        writeFileSync(h.file, content);
        expect(harness({ dir: h.dir }).host.enabled).toBe(false);
      },
    );

    it('fichier illisible (un dossier à sa place) → éteint', () => {
      const h = harness();
      mkdirSync(h.file);
      expect(harness({ dir: h.dir }).host.enabled).toBe(false);
    });
  });

  describe('extinction et abonnés', () => {
    it('disable() écrit false, rend false et prévient les abonnés ; un nouvel hôte relit éteint', async () => {
      const h = harness({ answers: [0] });
      const seen: boolean[] = [];
      h.host.onChange((enabled) => seen.push(enabled));
      await h.host.requestEnable();
      expect(seen).toEqual([true]);

      expect(h.host.disable()).toBe(false);
      expect(h.host.enabled).toBe(false);
      expect(readFileSync(h.file, 'utf8')).toBe('{"enabled":false}');
      expect(seen).toEqual([true, false]);
      expect(harness({ dir: h.dir }).host.enabled).toBe(false);
    });

    it('onChange rend une fonction qui désabonne ; deux abonnements de la même fonction sont indépendants', async () => {
      const h = harness({ answers: [0] });
      const seen: boolean[] = [];
      const listener = (enabled: boolean) => seen.push(enabled);
      const stopFirst = h.host.onChange(listener);
      h.host.onChange(listener);
      stopFirst();
      stopFirst();
      await h.host.requestEnable();
      expect(seen).toEqual([true]);

      const stopOnly = h.host.onChange(() => seen.push(false));
      stopOnly();
      h.host.disable();
      expect(seen).toEqual([true, false]);
    });

    it('disable() sur un hôte déjà éteint : personne n’est prévenu, mais le fichier ne dit plus true', () => {
      const h = harness();
      const seen: boolean[] = [];
      h.host.onChange((enabled) => seen.push(enabled));
      writeFileSync(h.file, '{"enabled":true}'); // édité à la main pendant que le desk tourne
      expect(h.host.enabled).toBe(false);
      expect(h.host.disable()).toBe(false);
      expect(seen).toEqual([]);
      expect(readFileSync(h.file, 'utf8')).toBe('{"enabled":false}');
    });

    it('un abonné qui lève ne prive ni les autres abonnés ni disable()', async () => {
      const h = harness({ answers: [0] });
      const seen: boolean[] = [];
      h.host.onChange(() => {
        throw new Error('fenêtre détruite');
      });
      h.host.onChange((enabled) => seen.push(enabled));
      expect(await h.host.requestEnable()).toBe(true);
      expect(() => h.host.disable()).not.toThrow();
      expect(seen).toEqual([true, false]);
      expect(h.host.enabled).toBe(false);
      const failures = h.logs.filter((line) => line.includes('abonné'));
      expect(failures).toHaveLength(2);
      for (const line of failures) expect(line).toContain('(fenêtre détruite)'); // la cause suit, comme dans les autres lignes d'échec
    });

    it('un abonné qui éteint pendant l’allumage : les suivants ne reçoivent jamais un true périmé', async () => {
      const h = harness({ answers: [0] });
      const seen: boolean[] = [];
      h.host.onChange((enabled) => {
        if (enabled) h.host.disable();
      });
      h.host.onChange((enabled) => seen.push(enabled));
      expect(await h.host.requestEnable()).toBe(false);
      expect(h.host.enabled).toBe(false);
      expect(seen).toEqual([false]);
      expect(written(h.file)).toEqual({ enabled: false });
    });
  });

  describe('fenêtre absente', () => {
    it.each(CLOSED_WINDOWS)('fenêtre %s : reste éteint, showMessageBox jamais appelé, rien d’écrit', async (_name, window) => {
      const h = harness({ answers: [0], window });
      expect(await h.host.requestEnable()).toBe(false);
      expect(h.host.enabled).toBe(false);
      expect(h.dialogs).toEqual([]);
      expect(existsSync(h.file)).toBe(false);
    });
  });

  describe('un seul dialogue à la fois (double clic sur « Activer »)', () => {
    it.each([
      [0, true],
      [1, false],
    ])('deux appels pendant que le dialogue est ouvert (réponse %i) : une seule boîte, la même promesse, le même résultat', async (response, expected) => {
      const h = harness({ hold: true });
      const first = h.host.requestEnable();
      const second = h.host.requestEnable();
      expect(second).toBe(first);
      await Promise.resolve(); // un appel venu d'un autre tour de file reçoit la même promesse
      expect(h.host.requestEnable()).toBe(first);
      expect(h.dialogs).toHaveLength(1);

      h.answer(response);
      expect(await Promise.all([first, second])).toEqual([expected, expected]);
      expect(h.dialogs).toHaveLength(1);
      expect(h.host.enabled).toBe(expected);
    });

    it('le dialogue fermé, un nouvel appel en ouvre un autre (Annuler puis Activer)', async () => {
      const h = harness({ answers: [1, 0] });
      expect(await h.host.requestEnable()).toBe(false);
      expect(await h.host.requestEnable()).toBe(true);
      expect(h.dialogs).toHaveLength(2);
    });

    it('déjà allumé : true sans dialogue, même après un redémarrage et sans fenêtre', async () => {
      const h = harness({ answers: [0] });
      await h.host.requestEnable();
      expect(await h.host.requestEnable()).toBe(true);
      expect(h.dialogs).toHaveLength(1);

      const restarted = harness({ dir: h.dir, window: null });
      expect(await restarted.host.requestEnable()).toBe(true);
      expect(restarted.dialogs).toEqual([]);
    });
  });

  describe('dialogue', () => {
    it.each(LANGUAGES)('en %s : question, titre CΛNTO, Annuler par défaut, hôtes, usage et durée du choix nommés', async (locale, message, buttons, phrases) => {
      const h = harness({ locale, answers: [1] });
      await h.host.requestEnable();
      const dialog = h.dialogs[0]!;
      expect(dialog).toMatchObject({ type: 'question', title: 'CΛNTO', message, defaultId: 1, cancelId: 1, noLink: true });
      expect(dialog.buttons).toEqual(buttons);
      expect(dialog.buttons[dialog.defaultId]).toBe(buttons[1]);
      for (const venue of ['Coinbase', 'Binance', 'Bybit']) expect(dialog.detail).toContain(venue);
      for (const phrase of phrases) expect(dialog.detail).toContain(phrase);
    });

    it('la langue est relue à chaque dialogue', async () => {
      const h = harness({ answers: [1, 1] });
      await h.host.requestEnable();
      h.setLocale('en');
      await h.host.requestEnable();
      expect(h.dialogs.map((dialog) => dialog.message)).toEqual(['Activer le module crypto ?', 'Turn on the crypto module?']);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['{}', {}],
      ["{ response: '0' }", { response: '0' }],
    ])('réponse mal formée %s : reste éteint, rien n’est écrit à true', async (_shape, reply) => {
      const h = harness({ reply });
      expect(await h.host.requestEnable()).toBe(false);
      expect(h.host.enabled).toBe(false);
      expect(h.dialogs).toHaveLength(1);
      expect(written(h.file)).not.toEqual({ enabled: true });
      expect(harness({ dir: h.dir }).host.enabled).toBe(false);
    });

    it('un dialogue qui échoue : reste éteint, ne lève pas, libère la place', async () => {
      const h = harness({ fail: true });
      expect(await h.host.requestEnable()).toBe(false);
      expect(h.host.enabled).toBe(false);
      expect(existsSync(h.file)).toBe(false);
      expect(h.logs).toHaveLength(1);
      expect(await h.host.requestEnable()).toBe(false);
      expect(h.dialogs).toHaveLength(2);
    });
  });

  describe('persistance', () => {
    it('crypto.json impossible à écrire ni à supprimer : allumé pour la séance seulement, journalisé, jamais de levée', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'canto-crypto-switch-'));
      mkdirSync(path.join(dir, 'crypto.json')); // un dossier occupe la place du fichier : ni l'écrire ni le supprimer
      const h = harness({ dir, answers: [0] });
      const seen: boolean[] = [];
      h.host.onChange((enabled) => seen.push(enabled));

      expect(await h.host.requestEnable()).toBe(true);
      expect(h.host.enabled).toBe(true);
      expect(h.logs.some((line) => line.includes('crypto.json'))).toBe(true);
      expect(h.logs.some((line) => line.includes('non supprimé'))).toBe(false); // allumer ne supprime jamais rien
      expect(harness({ dir }).host.enabled).toBe(false);

      expect(() => h.host.disable()).not.toThrow();
      expect(h.host.enabled).toBe(false);
      expect(seen).toEqual([true, false]);
      // Éteint, le repli (supprimer) échoue lui aussi : une ligne distincte, avec la cause, dit que l'ancien état sera relu.
      const unremoved = h.logs.filter((line) => line.includes('non supprimé'));
      expect(unremoved).toHaveLength(1);
      expect(unremoved[0]).toMatch(/non supprimé \([^)]+\)/);
      expect(unremoved[0]).toContain('relu au prochain lancement');
    });

    it('écriture de false impossible (fichier en lecture seule) : le fichier est supprimé, un nouvel hôte relit éteint', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'canto-crypto-switch-'));
      const file = path.join(dir, 'crypto.json');
      writeFileSync(file, '{"enabled":true}');
      // Écrire échoue ensuite (EPERM sous Windows, EACCES ailleurs) et l'ancien true resterait sur le disque. Sous un
      // compte administrateur POSIX l'écriture réussit : le test reste vrai, sans exercer le repli.
      chmodSync(file, 0o444);
      try {
        const h = harness({ dir });
        expect(h.host.enabled).toBe(true);
        expect(h.host.disable()).toBe(false);
        expect(written(file)).not.toEqual({ enabled: true });
        expect(h.logs.some((line) => line.includes('relu au prochain lancement'))).toBe(false); // le repli a réussi
        expect(harness({ dir }).host.enabled).toBe(false);
      } finally {
        if (existsSync(file)) chmodSync(file, 0o644); // le dossier temporaire reste effaçable
      }
    });

    it('journalise chaque changement d’état, une ligne chacun, et rien quand rien ne change', async () => {
      const h = harness({ answers: [1, 0] });
      await h.host.requestEnable(); // Annuler
      expect(h.logs).toEqual([]);
      await h.host.requestEnable(); // Activer
      await h.host.requestEnable(); // déjà allumé
      expect(h.logs).toHaveLength(1);
      expect(h.logs[0]).toMatch(/^crypto activé/);
      h.host.disable();
      h.host.disable(); // déjà éteint
      expect(h.logs).toHaveLength(2);
      expect(h.logs[1]).toMatch(/^crypto désactivé/);
    });
  });
});
