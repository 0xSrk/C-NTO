import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : `prepareVaultRestore` est pur, le module qui le porte ouvre une base à l'import.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { openSealedVault, SEALED_VAULT_FORMAT, sealVault, type VaultKeychain } from '../electron/vault-seal';
import { buildVaultV2, SEALED_VAULT_FORMAT as ENGINE_SEALED_FORMAT } from '@/engine/vault';
import { prepareVaultRestore } from '@/store/db';

/**
 * SEC1.9 — une sauvegarde « chiffrée » se restaure. L'option « trousseau système » écrivait
 * `{"format":"canto-vault-v2-enc","payload":…}`, que la restauration rejetait (« Fichier non reconnu ») : aucune copie
 * chiffrée n'était relisible, et le trader croyait en avoir. Le process principal ouvre l'enveloppe à la lecture du
 * fichier, sur le poste et le compte qui l'ont scellée ; ailleurs, la restauration dit pourquoi elle ne s'ouvre pas.
 */

/** Un trousseau de test, réversible : le scellé n'est lisible qu'avec le même secret (un autre poste en a un autre). */
function keychain(secret: string, available = true): VaultKeychain {
  const mask = (bytes: Buffer) => Buffer.from(bytes.map((byte, i) => byte ^ secret.charCodeAt(i % secret.length)));
  const tag = (bytes: Buffer) => createHash('sha256').update(secret).update(bytes).digest().subarray(0, 8);
  return {
    available: () => available,
    encrypt: (text) => {
      const clear = Buffer.from(text, 'utf8');
      return Buffer.concat([tag(clear), mask(clear)]);
    },
    // Comme `safeStorage.decryptString` : un scellé d'un autre trousseau lève, il ne rend pas du bruit.
    decrypt: (blob) => {
      const clear = mask(blob.subarray(8));
      if (!tag(clear).equals(blob.subarray(0, 8))) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return clear.toString('utf8');
    },
  };
}

const vault = JSON.stringify(
  buildVaultV2({
    appVersion: '3.10.0',
    exportedAt: 1_794_250_000_000,
    sessions: [{ id: 's1', date: '2026-11-06', account: 'Sim101', createdAt: 1, updatedAt: 1 }],
    trades: [],
    notes: [],
  }),
);

describe('SEC1.9 sauvegarde scellée par le trousseau du système', () => {
  it('le même format des deux côtés : celui que le process principal écrit, celui que la restauration reconnaît', () => {
    expect(SEALED_VAULT_FORMAT).toBe('canto-vault-v2-enc');
    expect(ENGINE_SEALED_FORMAT).toBe(SEALED_VAULT_FORMAT);
  });

  it('sceller puis ouvrir rend le coffre, octet pour octet, sur le poste qui l’a scellé', () => {
    const here = keychain('poste-du-trader');
    const sealed = sealVault(vault, here);
    expect(sealed).not.toBeNull();
    const envelope = JSON.parse(sealed!) as { format: string; payload: string };
    expect(envelope.format).toBe(SEALED_VAULT_FORMAT);
    expect(sealed).not.toContain('Sim101');
    expect(openSealedVault(sealed!, here)).toEqual({ sealed: true, ok: true, json: vault });
  });

  it('un coffre en clair, un CSV ou un JSON quelconque ne sont pas des scellés : rendus tels quels à l’appelant', () => {
    const here = keychain('poste-du-trader');
    for (const text of [vault, 'Instrument,Action,Quantity\nNQ 12-26,Buy,1', '{"format":"autre","payload":"x"}', '{"format":"canto-vault-v2-enc"}', '', '{', '[1,2]', 'null']) {
      expect(openSealedVault(text, here), text.slice(0, 40)).toEqual({ sealed: false });
    }
  });

  it('un autre poste, un autre compte ou un trousseau absent : scellé reconnu, non ouvert, sans rien rendre du contenu', () => {
    const sealed = sealVault(vault, keychain('poste-du-trader'))!;
    expect(openSealedVault(sealed, keychain('un-autre-poste!'))).toEqual({ sealed: true, ok: false, reason: 'keychain' });
    expect(openSealedVault(sealed, keychain('poste-du-trader', false))).toEqual({ sealed: true, ok: false, reason: 'keychain' });
    expect(sealVault(vault, keychain('poste-du-trader', false))).toBeNull();
  });

  it('n’ouvre qu’un coffre : un autre secret du trousseau glissé dans une enveloppe n’est jamais rendu', () => {
    const here = keychain('poste-du-trader');
    // La clé API du modèle est scellée par le même trousseau : l'enveloppe d'un coffre ne sert pas à la lire.
    const apiKey = 'sk-ant-api03-cle-du-trader';
    const forged = JSON.stringify({ format: SEALED_VAULT_FORMAT, payload: here.encrypt(apiKey).toString('base64') });
    const opened = openSealedVault(forged, here);
    expect(opened).toEqual({ sealed: true, ok: false, reason: 'not_a_vault' });
    expect(JSON.stringify(opened)).not.toContain('sk-ant');
    // Un JSON qui n'est pas un coffre ne passe pas davantage.
    for (const inner of ['{"apiKey":"sk-ant-api03-cle-du-trader"}', '{"format":"canto-vault-v2-enc","payload":"x"}', '["canto-vault-v2"]', '"canto-vault-v2"']) {
      const wrapped = JSON.stringify({ format: SEALED_VAULT_FORMAT, payload: here.encrypt(inner).toString('base64') });
      expect(openSealedVault(wrapped, here), inner).toEqual({ sealed: true, ok: false, reason: 'not_a_vault' });
    }
  });

  it('le process principal scelle à l’écriture et ouvre à la lecture du fichier, par ce module seulement', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const write = main.slice(main.indexOf("ipcMain.handle('files:write-in-folder'"), main.indexOf('/* ─── Orchestrateur ─── */'));
    expect(write).toMatch(/sealVault\(text, vaultKeychain\)/);
    const open = main.slice(main.indexOf("ipcMain.handle('files:open-text'"), main.indexOf("ipcMain.handle('files:pick-folder'"));
    expect(open).toMatch(/openSealedVault\(text, vaultKeychain\)/);
    // Le format ne s'écrit qu'à un endroit ; aucun canal ne déchiffre un scellé à la demande du renderer.
    expect(main).not.toContain('canto-vault-v2-enc');
    expect(main).not.toMatch(/ipcMain\.(?:handle|on)\('[^']*decrypt/);
    expect(readFileSync('electron/preload.ts', 'utf8')).not.toMatch(/decrypt/i);
  });

  it('la restauration lit ce que le process principal a ouvert', () => {
    const here = keychain('poste-du-trader');
    const opened = openSealedVault(sealVault(vault, here)!, here);
    expect(opened).toMatchObject({ sealed: true, ok: true });
    if (!opened.sealed || !opened.ok) return;
    const prepared = prepareVaultRestore(opened.json);
    expect(prepared.sessions.map((session) => session.id)).toEqual(['s1']);
  });

  it('le réglage dit ce que vaut une copie chiffrée : elle ne se restaure que sur ce poste et ce compte', () => {
    const modal = readFileSync('src/modules/metrique/SettingsModal.tsx', 'utf8');
    const field = modal.slice(modal.indexOf("label={tr('Chiffrer la sauvegarde'"), modal.indexOf('settings.backupEncrypted'));
    expect(field).toMatch(/hint=\{tr\('ne se restaure que sur ce poste et ce compte', 'restores only on this computer and account', 'solo se restaura en este equipo y esta cuenta'\)\}/);
  });

  it('un scellé resté fermé n’est plus « non reconnu » : la restauration dit qu’il ne s’ouvre que sur son poste', () => {
    const sealed = sealVault(vault, keychain('poste-du-trader'))!;
    expect(() => prepareVaultRestore(sealed)).toThrow(/trousseau/);
    expect(() => prepareVaultRestore(sealed)).not.toThrow(/non reconnu/);
  });
});
