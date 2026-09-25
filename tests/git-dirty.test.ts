import { describe, expect, it } from 'vitest';
import { classifyDirty, porcelainPaths } from '../electron/git-dirty';

describe('changements locaux avant mise à jour', () => {
  it('un package-lock.json réécrit par npm ne bloque pas la mise à jour', () => {
    expect(classifyDirty(' M package-lock.json\n')).toEqual({ generated: ['package-lock.json'], user: [] });
  });

  it('un vrai changement reste à confirmer, même accompagné du lockfile', () => {
    expect(classifyDirty(' M package-lock.json\n M src/app/Shell.tsx\n?? notes.md\n')).toEqual({
      generated: ['package-lock.json'],
      user: ['src/app/Shell.tsx', 'notes.md'],
    });
  });

  it('arbre propre : rien à restaurer ni à confirmer', () => {
    expect(classifyDirty('')).toEqual({ generated: [], user: [] });
  });

  it('lit les renommages, les chemins entre guillemets et les fins de ligne Windows', () => {
    expect(porcelainPaths('R  a.ts -> b.ts\r\n M "docs/mon fichier.md"\r\n')).toEqual(['a.ts', 'b.ts', 'docs/mon fichier.md']);
  });

  it('un lockfile imbriqué n’est pas celui du dépôt', () => {
    expect(classifyDirty(' M sub/package-lock.json\n').user).toEqual(['sub/package-lock.json']);
  });
});
