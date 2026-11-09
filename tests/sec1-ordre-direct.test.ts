import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * SEC1.2 — le renderer n'a aucun envoi d'ordre à lui. `ntbridge:order` soumettait, annulait et aplatissait sans dialogue,
 * sous la seule garde du compte (`Sim*` ou compte réel déjà autorisé), du plafond et du tag ; aucun code du desk ne
 * l'appelait. Un script arrivé dans la page aurait passé un ordre sur un compte réel autorisé sans que personne ne le
 * confirme. Les chemins d'ordres restent ceux du process principal : la proposition de l'agent (dialogue à chaque ordre),
 * le copieur (armé par dialogue), le kill switch.
 */

const read = (file: string) => readFileSync(file, 'utf8');
const preload = read('electron/preload.ts');
const main = read('electron/main.ts');
const deskTypes = read('src/lib/desk.ts');

/** Canaux que le preload ouvre au renderer (`invoke` et `send`). */
const exposed = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)].map((m) => m[1]!);
/** Canaux que le process principal écoute (`handle` et `on`). */
const handled = [...main.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)].map((m) => m[1]!);

describe('SEC1.2 aucun envoi d’ordre direct depuis le renderer', () => {
  it('le preload n’ouvre pas `ntbridge:order`, et le process principal ne l’écoute pas', () => {
    expect(exposed.length).toBeGreaterThan(50);
    expect(handled.length).toBeGreaterThan(50);
    expect(exposed).not.toContain('ntbridge:order');
    expect(handled).not.toContain('ntbridge:order');
  });

  it('aucun canal du renderer ne porte un ordre brut vers le pont', () => {
    // Les canaux qui se nomment d'après un ordre : ceux de l'agent (proposition gardée, dialogue à chaque ordre) et la
    // lecture du livre. Un canal de plus se décide ; le copieur et le kill switch ont les leurs, armés par dialogue.
    const orderish = handled.filter((channel) => /order|ordre|flatten|cancel/i.test(channel)).sort();
    expect(orderish).toEqual(['agent-orders:close-day', 'agent-orders:disable', 'agent-orders:enable', 'agent-orders:limits', 'agent-orders:propose', 'agent-orders:status', 'ntbridge:orders'].sort());
    // `ntbridge:orders` ne fait que lire le livre.
    expect(main).toMatch(/ipcMain\.handle\('ntbridge:orders', \(e\) => \(trusted\(e\) \? ntBridge\?\.orders\(\) \?\? null : null\)\);/);
  });

  it('dans le process principal, seul l’hôte des ordres de l’agent atteint `NtBridgeHost.order`', () => {
    const calls = [...main.matchAll(/ntBridge\??\.order\(/g)];
    expect(calls).toHaveLength(1);
    const at = calls[0]!.index!;
    const line = main.slice(main.lastIndexOf('\n', at) + 1, main.indexOf('\n', at));
    // Le `submit` de `AgentOrderHost` : il n'est appelé qu'après le dialogue du process principal.
    expect(line.trim().startsWith('submit: (order) =>')).toBe(true);
  });

  it('le type du pont vu par le renderer n’a plus de méthode `order`', () => {
    const start = deskTypes.indexOf('export interface NtBridgeApi {');
    expect(start).toBeGreaterThan(-1);
    const api = deskTypes.slice(start, deskTypes.indexOf('\n}\n', start));
    expect(api).toMatch(/\bkillSwitch: \(\) =>/);
    expect(api).not.toMatch(/^\s*order\??:/m);
    expect(preload).not.toMatch(/^\s*order:/m);
  });
});
