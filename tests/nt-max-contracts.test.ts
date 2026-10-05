import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changeMaxContracts, maxContractsDialog } from '../electron/nt-bridge/index';

function harness(response: number, win: { isDestroyed(): boolean } | null = { isDestroyed: () => false }) {
  const dialogs: string[] = [];
  const applied: number[] = [];
  const logs: string[] = [];
  return {
    dialogs,
    applied,
    logs,
    run: (current: number, requested: number) =>
      changeMaxContracts({
        win,
        current,
        requested,
        locale: 'fr',
        showMessageBox: async (_w, options) => {
          dialogs.push(options.buttons[0]);
          return { response };
        },
        apply: async (n) => {
          applied.push(n);
          return n;
        },
        log: (line) => logs.push(line),
      }),
  };
}

describe('plafond de contrats par ordre', () => {
  it('relever demande une confirmation du process principal ; Annuler ne change rien', async () => {
    const refused = harness(1);
    expect(await refused.run(20, 1000)).toBeNull();
    expect(refused.dialogs).toEqual(['Relever à 1000 contrats par ordre']);
    expect(refused.applied).toEqual([]);

    const ok = harness(0);
    expect(await ok.run(20, 50)).toBe(50);
    expect(ok.applied).toEqual([50]);
    expect(ok.logs).toEqual(['nt-bridge plafond 20 → 50 contrats']);
  });

  it('sans fenêtre attachée, un relèvement est refusé', async () => {
    const none = harness(0, null);
    expect(await none.run(20, 21)).toBeNull();
    const destroyed = harness(0, { isDestroyed: () => true });
    expect(await destroyed.run(20, 21)).toBeNull();
    expect([...none.applied, ...destroyed.applied]).toEqual([]);
  });

  it('baisser ou garder le plafond se fait sans dialogue ; hors 1–1000 ou non entier : rien', async () => {
    const h = harness(1, null);
    expect(await h.run(50, 5)).toBe(5);
    expect(await h.run(50, 50)).toBe(50);
    for (const bad of [0, -1, 1001, 2.5, Number.NaN]) expect(await h.run(50, bad)).toBeNull();
    expect(h.dialogs).toEqual([]);
    expect(h.applied).toEqual([5, 50]);
  });

  it('dialogue : Annuler par défaut, trois langues', () => {
    const fr = maxContractsDialog(20, 100, 'fr');
    expect(fr).toMatchObject({ type: 'warning', defaultId: 1, cancelId: 1, noLink: true });
    expect(fr.message).toContain('de 20 à 100 contrats');
    expect(maxContractsDialog(20, 100, 'en').buttons).toEqual(['Raise to 100 contracts per order', 'Cancel']);
    expect(maxContractsDialog(20, 100, 'es').buttons).toEqual(['Subir a 100 contratos por orden', 'Cancelar']);
  });

  it('l’IPC du renderer passe par la confirmation, jamais directement par setMaxContracts', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const start = main.indexOf("ipcMain.handle('ntbridge:max-contracts'");
    const handler = main.slice(start, main.indexOf('ipcMain.handle(', start + 10));
    expect(handler).toContain('changeMaxContracts(');
    expect(handler).not.toMatch(/ntBridge\.setMaxContracts\(n\)/);
  });
});
