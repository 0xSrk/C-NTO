import { readFileSync } from 'node:fs';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { devConnectSrc } from '../vite.config.mts';

/**
 * SEC1.6 — la CSP livrée tient l'invariant du renderer (`CLAUDE.md` § 5) : `connect-src 'self'`, aucun appel réseau
 * direct. `index.html`, que le build copie tel quel, ouvrait en plus `ws://127.0.0.1:*` et `ws://localhost:*` : le
 * WebSocket de rechargement du serveur de développement, livré à tous les desks installés. Un script arrivé dans la page
 * aurait pu ouvrir une socket vers n'importe quel service local du poste. Le rechargement à chaud garde son WebSocket,
 * rendu par un plugin qui ne s'applique qu'au serveur de développement.
 */

const html = readFileSync('index.html', 'utf8');

/** Les directives de la balise CSP d'une page : nom → valeur. */
function directives(page: string): Map<string, string> {
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1] ?? '';
  const out = new Map<string, string>();
  for (const part of content.split(';')) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) out.set(name, rest.join(' '));
  }
  return out;
}

describe('SEC1.6 CSP du renderer', () => {
  it('livrée : connect-src ne laisse que l’origine du desk', () => {
    const csp = directives(html);
    expect(csp.get('connect-src')).toBe("'self'");
    expect([...csp.values()].join(' ')).not.toMatch(/wss?:/);
  });

  it('livrée : les autres directives de l’audit restent en place', () => {
    const csp = directives(html);
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('script-src')).toBe("'self'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'none'");
    expect(csp.get('form-action')).toBe("'none'");
    expect(csp.get('frame-src')).toBe("'none'");
    expect(csp.get('img-src')).toBe("'self' data: blob:");
  });

  it('développement : le plugin rend au rechargement à chaud son WebSocket local, et rien d’autre', () => {
    const plugin = devConnectSrc();
    expect(plugin.apply).toBe('serve');
    const transform = plugin.transformIndexHtml;
    expect(typeof transform).toBe('function');
    const served = (transform as (page: string) => string)(html);
    expect(served).not.toBe(html);
    const shipped = directives(html);
    const dev = directives(served);
    expect(dev.get('connect-src')).toBe("'self' ws://127.0.0.1:* ws://localhost:*");
    for (const [name, value] of shipped) if (name !== 'connect-src') expect(dev.get(name), name).toBe(value);
    expect(served.replace(" ws://127.0.0.1:* ws://localhost:*", '')).toBe(html);
  });

  it('le plugin est dans le serveur de développement, pas dans le build', async () => {
    const names = async (command: 'build' | 'serve') => (await resolveConfig({ logLevel: 'silent' }, command)).plugins.map((plugin) => plugin.name);
    expect(await names('serve')).toContain('canto:dev-connect-src');
    expect(await names('build')).not.toContain('canto:dev-connect-src');
  });
});
