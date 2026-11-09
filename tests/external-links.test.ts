import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExternalLinks, externalLinkDialog, externalTarget, type ExternalLinkDialog } from '../electron/external-links';

/**
 * SEC2.4 — un lien sortant ne s'ouvre plus sans montrer son hôte. Un lien cliqué dans le desk (une source d'un rapport du
 * Lab, une note) partait vers le navigateur du système sans dialogue : son texte peut dire « bls.gov » et viser un autre
 * hôte. Le process principal montre l'hôte réel, Annuler par défaut, et n'ouvre que sur un oui.
 */

function gate(responses: number[]) {
  const shown: ExternalLinkDialog[] = [];
  const opened: string[] = [];
  const logs: string[] = [];
  const pending: ((value: { response: number }) => void)[] = [];
  const links = new ExternalLinks<{ id: number }>({
    locale: () => 'fr',
    showMessageBox: (_win, options) => {
      shown.push(options);
      const next = responses.shift();
      if (next !== undefined) return Promise.resolve({ response: next });
      return new Promise((resolve) => pending.push(resolve));
    },
    open: (url) => {
      opened.push(url);
    },
    log: (line) => logs.push(line),
  });
  return { links, shown, opened, logs, pending };
}

describe('SEC2.4 un lien sortant montre son hôte avant de s’ouvrir', () => {
  it('seuls https et http://127.0.0.1 sont des liens sortants ; l’hôte rendu est le vrai', () => {
    expect(externalTarget('https://www.bls.gov/schedule/news_release/empsit.htm')).toEqual({ url: 'https://www.bls.gov/schedule/news_release/empsit.htm', host: 'www.bls.gov' });
    expect(externalTarget('http://127.0.0.1:48231/status')).toEqual({ url: 'http://127.0.0.1:48231/status', host: '127.0.0.1:48231' });
    expect(externalTarget('https://exemple.test:8443/a?b=c#d')?.host).toBe('exemple.test:8443');
    // Un nom internationalisé se lit en punycode : un « а » cyrillique ne passe pas pour un « a ».
    expect(externalTarget('https://bücher.example/')?.host).toBe('xn--bcher-kva.example');
    for (const refused of [
      'http://example.com/',
      'http://localhost:5173/',
      'http://127.0.0.1.evil.example/',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'mailto:a@b.c',
      'ms-settings:privacy',
      'canto://x',
      // Le nom lu avant l'arobase n'est pas l'hôte visé.
      'https://www.bls.gov@evil.example/',
      'https://user:secret@example.com/',
      'https://',
      'pas une adresse',
      '',
      `https://example.com/${'a'.repeat(5000)}`,
      42,
      null,
      undefined,
    ]) {
      expect(externalTarget(refused), String(refused).slice(0, 60)).toBeNull();
    }
  });

  it('le dialogue : l’hôte en tête, l’adresse dessous, Annuler par défaut, dans les trois langues', () => {
    const target = externalTarget('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')!;
    expect(externalLinkDialog('fr', target)).toEqual({
      type: 'question',
      title: 'CΛNTO',
      message: 'Ouvrir ce lien dans le navigateur ?',
      detail: 'Hôte : www.federalreserve.gov\n\nhttps://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
      buttons: ['Ouvrir', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    expect(externalLinkDialog('en', target)).toMatchObject({ message: 'Open this link in the browser?', buttons: ['Open', 'Cancel'] });
    expect(externalLinkDialog('es', target)).toMatchObject({ message: '¿Abrir este enlace en el navegador?', buttons: ['Abrir', 'Cancelar'] });
    // Une adresse longue est coupée ; l'hôte reste entier en tête.
    const long = externalLinkDialog('fr', externalTarget(`https://example.com/${'p'.repeat(600)}`)!);
    expect(long.detail.startsWith('Hôte : example.com\n\nhttps://example.com/ppp')).toBe(true);
    expect(long.detail.endsWith('…')).toBe(true);
    expect(long.detail.length).toBeLessThan(280);
  });

  it('rien ne s’ouvre sans un oui : Annuler, la touche Échap ou un refus ne lancent pas le navigateur', async () => {
    const yes = gate([0]);
    expect(await yes.links.request({ id: 1 }, 'https://example.com/a?jeton=secret')).toBe('opened');
    expect(yes.opened).toEqual(['https://example.com/a?jeton=secret']);
    expect(yes.shown).toHaveLength(1);
    // Le journal garde l'hôte, jamais l'adresse.
    expect(yes.logs).toEqual(['lien externe ouvert hôte=example.com']);
    expect(yes.logs.join('\n')).not.toContain('secret');

    const no = gate([1]);
    expect(await no.links.request({ id: 1 }, 'https://example.com/')).toBe('declined');
    expect(no.opened).toEqual([]);
    expect(no.shown).toHaveLength(1);

    const refused = gate([0]);
    expect(await refused.links.request({ id: 1 }, 'file:///etc/passwd')).toBe('refused');
    expect(await refused.links.request(null, 'https://a@b.example/')).toBe('refused');
    expect(refused.shown).toEqual([]);
    expect(refused.opened).toEqual([]);
  });

  it('un dialogue à la fois : une page qui en demande cent n’en ouvre qu’un', async () => {
    const g = gate([]);
    const first = g.links.request({ id: 1 }, 'https://example.com/1');
    for (let i = 2; i <= 100; i += 1) expect(await g.links.request({ id: 1 }, `https://example.com/${i}`)).toBe('busy');
    expect(g.shown).toHaveLength(1);
    g.pending[0]!({ response: 1 });
    expect(await first).toBe('declined');
    expect(g.opened).toEqual([]);
    // Une fois le dialogue fermé, le suivant peut s'ouvrir.
    const next = g.links.request({ id: 1 }, 'https://example.com/suivant');
    g.pending[1]!({ response: 0 });
    expect(await next).toBe('opened');
    expect(g.opened).toEqual(['https://example.com/suivant']);
  });

  it('un navigateur qui ne se lance pas ne laisse pas la porte fermée', async () => {
    const logs: string[] = [];
    const links = new ExternalLinks<null>({
      locale: () => 'fr',
      showMessageBox: async () => ({ response: 0 }),
      open: () => Promise.reject(new Error('aucun navigateur')),
      log: (line) => logs.push(line),
    });
    expect(await links.request(null, 'https://example.com/')).toBe('declined');
    expect(logs.at(-1)).toBe('lien externe non ouvert hôte=example.com : aucun navigateur');
    expect(await links.request(null, 'https://example.com/')).toBe('declined');
  });

  it('le process principal n’ouvre un lien d’une page que par cette porte', () => {
    const main = readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n');
    expect(main).not.toMatch(/function openExternalSafe/);
    expect(main).toMatch(/contents\.setWindowOpenHandler\(\(\{ url \}\) => \{\n    void externalLinks\.request\(BrowserWindow\.fromWebContents\(contents\), url\);\n    return \{ action: 'deny' \};\n  \}\);/);
    // `shell.openExternal` n'apparaît qu'une fois dans le fichier : dans la porte.
    expect([...main.matchAll(/shell\.openExternal\(/g)]).toHaveLength(1);
    expect(main).toMatch(/open: \(url\) => shell\.openExternal\(url\),/);
  });
});
