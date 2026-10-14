import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Lecture du registre en échec, comme un fichier verrouillé ou laissé illisible par un autre compte. */
const unreadable = vi.hoisted(() => ({ code: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    readFileSync: ((...args: Parameters<typeof fs.readFileSync>) => {
      if (unreadable.code && String(args[0]).endsWith('llm-key-hosts.json')) throw Object.assign(new Error(unreadable.code), { code: unreadable.code });
      return fs.readFileSync(...args);
    }) as typeof fs.readFileSync,
  };
});
import { keyFor } from '../electron/llm-host';
import { LLM_KEY_SEALS_FILE, LLM_KEY_SEALS_MAX, LlmKeySeals } from '../electron/llm-key-seals';

const dirs: string[] = [];
afterEach(() => {
  unreadable.code = '';
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function userData(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'canto-llm-seals-'));
  dirs.push(dir);
  return dir;
}

/** Un blob tel que `secrets:encrypt` le rend : du base64 opaque. */
const blob = (n: number): string => Buffer.from(`chiffré-${n}-${'x'.repeat(24)}`).toString('base64');

describe('sceau d’hôte des clés API, tenu par le process principal', () => {
  it('une clé liée part vers son hôte seulement, quoi que dise le renderer', () => {
    const seals = new LlmKeySeals(userData());
    const openai = blob(1);
    seals.bind(openai, 'api.openai.com');
    expect(seals.hostFor(openai, 'openrouter.ai')).toBe('api.openai.com');
    expect(seals.hostFor(openai, undefined)).toBe('api.openai.com');
    expect(keyFor('https://openrouter.ai/api/v1', seals.hostFor(openai, 'openrouter.ai'))).toBe(false);
    expect(keyFor('https://api.openai.com/v1', seals.hostFor(openai, 'openrouter.ai'))).toBe(true);
  });

  it('un secret ancien, sans lien, suit l’hôte du renderer comme avant (champ absent compris)', () => {
    const seals = new LlmKeySeals(userData());
    seals.bind(blob(1), 'api.openai.com');
    const old = blob(2);
    expect(seals.hostFor(old, 'api.anthropic.com')).toBe('api.anthropic.com');
    expect(seals.hostFor(old, undefined)).toBeUndefined();
    expect(seals.hostFor(undefined, 'api.openai.com')).toBe('api.openai.com');
    expect(seals.hostFor(42, null)).toBeNull();
  });

  it('le même blob réécrit autrement en base64 (blancs, sans remplissage) garde son lien', () => {
    const seals = new LlmKeySeals(userData());
    const b = Buffer.from('un blob chiffré de longueur 31!').toString('base64');
    expect(b.endsWith('=')).toBe(true);
    seals.bind(b, 'api.openai.com');
    for (const variant of [`${b}\n`, ` ${b}`, b.replace(/=+$/, ''), `${b.slice(0, 8)}\n${b.slice(8)}`]) {
      expect(seals.hostFor(variant, 'openrouter.ai'), JSON.stringify(variant)).toBe('api.openai.com');
    }
  });

  it('les liens survivent au redémarrage ; le fichier ne porte ni clé ni blob', () => {
    const dir = userData();
    const openai = blob(1);
    new LlmKeySeals(dir).bind(openai, 'api.openai.com');
    expect(new LlmKeySeals(dir).hostFor(openai, 'openrouter.ai')).toBe('api.openai.com');
    const text = readFileSync(path.join(dir, LLM_KEY_SEALS_FILE), 'utf8');
    expect(text).not.toContain(openai);
    expect(text).not.toContain('chiffré');
    expect(JSON.parse(text)).toMatchObject({ v: 1, evicted: false });
  });

  it('une clé ressaisie pour un autre hôte prend le nouveau lien', () => {
    const seals = new LlmKeySeals(userData());
    const b = blob(1);
    seals.bind(b, 'api.openai.com');
    seals.bind(b, 'api.anthropic.com');
    expect(seals.hostFor(b, 'api.openai.com')).toBe('api.anthropic.com');
  });

  it(`au-delà de ${LLM_KEY_SEALS_MAX} liens, les plus anciens partent et un blob inconnu est refusé : une rafale ne délie pas la clé en usage`, () => {
    const dir = userData();
    const seals = new LlmKeySeals(dir);
    const real = blob(0);
    const legacy = blob(-1);
    seals.bind(real, 'api.openai.com');
    for (let i = 1; i <= LLM_KEY_SEALS_MAX; i += 1) seals.bind(blob(i), 'openrouter.ai');
    // Le lien de la vraie clé est parti : elle n'est plus envoyée nulle part, plutôt que de suivre le renderer.
    expect(seals.hostFor(real, 'openrouter.ai')).toBe('');
    expect(keyFor('https://openrouter.ai/api/v1', seals.hostFor(real, 'openrouter.ai'))).toBe(false);
    expect(seals.hostFor(legacy, undefined)).toBe('');
    // Les plus récents restent liés, et l'état survit au redémarrage.
    expect(seals.hostFor(blob(LLM_KEY_SEALS_MAX), 'x')).toBe('openrouter.ai');
    const again = new LlmKeySeals(dir);
    expect(again.hostFor(real, 'openrouter.ai')).toBe('');
    expect(again.hostFor(blob(LLM_KEY_SEALS_MAX), 'x')).toBe('openrouter.ai');
  });

  it('fichier illisible : les liens sont perdus, un blob inconnu est refusé ; fichier absent : comme avant', () => {
    const dir = userData();
    writeFileSync(path.join(dir, LLM_KEY_SEALS_FILE), '{ pas du json');
    expect(new LlmKeySeals(dir).hostFor(blob(1), 'api.openai.com')).toBe('');
    writeFileSync(path.join(dir, LLM_KEY_SEALS_FILE), JSON.stringify({ v: 1, evicted: false, keys: [['zz', 'api.openai.com']] }));
    expect(new LlmKeySeals(dir).hostFor(blob(1), 'api.openai.com')).toBe('');
    expect(new LlmKeySeals(userData()).hostFor(blob(1), 'api.openai.com')).toBe('api.openai.com');
  });

  it('erreur de lecture passagère (fichier verrouillé) : refus le temps qu’elle dure, rien d’écrit ni de gardé, les liens reviennent ensuite', () => {
    const dir = userData();
    const file = path.join(dir, LLM_KEY_SEALS_FILE);
    const key = blob(1);
    expect(new LlmKeySeals(dir).bind(key, 'api.anthropic.com')).toBe(true);
    const before = readFileSync(file, 'utf8');
    // Un dossier à la place du fichier : la lecture échoue autrement que par ENOENT (EISDIR), comme un fichier verrouillé.
    const aside = `${file}.aside`;
    writeFileSync(aside, before);
    rmSync(file);
    mkdirSync(file);
    const seals = new LlmKeySeals(dir);
    expect(seals.hostFor(key, 'api.openai.com')).toBe('');
    expect(seals.bind(blob(2), 'api.openai.com')).toBe(false);
    // Le verrou levé : le registre se relit, la clé scellée part de nouveau vers son hôte.
    rmSync(file, { recursive: true });
    writeFileSync(file, readFileSync(aside, 'utf8'));
    expect(seals.hostFor(key, 'api.openai.com')).toBe('api.anthropic.com');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('registre illisible pour de bon, dossier inscriptible : la clé saisie ensuite est scellée, le registre repart sans les liens d’avant', () => {
    const dir = userData();
    const old = blob(1);
    expect(new LlmKeySeals(dir).bind(old, 'api.anthropic.com')).toBe(true);
    unreadable.code = 'EACCES';
    const seals = new LlmKeySeals(dir);
    expect(seals.hostFor(old, 'api.anthropic.com')).toBe('');
    const fresh = blob(2);
    expect(seals.bind(fresh, 'api.openai.com')).toBe(true);
    // Toujours illisible au disque : le registre écrit fait foi pour la suite du lancement.
    expect(seals.hostFor(fresh, 'openrouter.ai')).toBe('api.openai.com');
    expect(seals.hostFor(old, 'api.anthropic.com')).toBe('');
    unreadable.code = '';
    const next = new LlmKeySeals(dir);
    expect(next.hostFor(fresh, 'openrouter.ai')).toBe('api.openai.com');
    expect(next.hostFor(old, 'api.anthropic.com')).toBe('');
    expect(next.hostFor(blob(3), 'api.openai.com')).toBe('');
  });

  it('électron : secrets:encrypt scelle l’hôte de l’URL de base ; l’appel LLM lit l’hôte scellé ; le renderer donne l’URL de base', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const encrypt = main.slice(main.indexOf("ipcMain.handle('secrets:encrypt'"), main.indexOf('/* ─── LLM'));
    expect(encrypt).toContain("(e, text: unknown, baseUrl?: unknown) =>");
    expect(encrypt).toContain('keySeals().bind(blob, host)');
    const call = main.slice(main.indexOf('function llmKeyForCall('), main.indexOf('function llmRedirectRefusal('));
    expect(call).toContain('const keyHost = keySeals().hostFor(blob, rendererHost);');
    expect(call).toContain('if (keyFor(baseUrl, keyHost))');
    expect(readFileSync('electron/preload.ts', 'utf8')).toContain("encrypt: (text: string, baseUrl?: string) => ipcRenderer.invoke('secrets:encrypt', text, baseUrl),");
    expect(readFileSync('src/store/settings.ts', 'utf8')).toContain('await desk.secrets.encrypt(apiKey, settings.agent.baseUrl);');
    expect(readFileSync('src/store/db.ts', 'utf8')).toContain("await desk.secrets.encrypt(v.pendingApiKey, typeof prevAgent.baseUrl === 'string' ? prevAgent.baseUrl : undefined);");
  });
});
