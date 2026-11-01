import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const notes = readFileSync('src/store/notes.ts', 'utf8');
const noteModule = readFileSync('src/modules/note/Note.tsx', 'utf8');
const sessions = readFileSync('src/modules/metrique/Sessions.tsx', 'utf8');
const metrique = readFileSync('src/modules/metrique/Metrique.tsx', 'utf8');

describe('OROS4.27 la note de bienvenue montre les gestes tels qu’ils sont', () => {
  it('la note du jour se crée depuis les options de Note, dans chaque langue : plus de bouton « en un clic »', () => {
    expect(notes).not.toMatch(/en un clic|one click|en un clic:/);
    // le libellé cité est celui de l'option, dans les trois langues
    expect(noteModule).toContain("{ id: 'jour', label: tr('Note du jour', 'Daily note', 'Nota del día')");
    expect(notes).toContain('**Options › Note du jour**');
    expect(notes).toContain('**Options › Daily note**');
    expect(notes).toContain('**Opciones › Nota del día**');
  });

  it('la note d’une séance se crée depuis Métrique › Séances, par le bouton qui porte ce nom', () => {
    expect(metrique).toContain("label: tr('Séances', 'Sessions', 'Sesiones')");
    expect(sessions).toContain("{tr('Note du jour', 'Daily note', 'Nota del día')}");
    expect(notes).toContain('**Métrique › Séances** (bouton *Note du jour*)');
    expect(notes).toContain('**Metrics › Sessions** (*Daily note* button)');
    expect(notes).toContain('**Métrica › Sesiones** (botón *Nota del día*)');
    expect(notes).not.toMatch(/bouton \*Journal\*|\*Journal\* button|botón \*Diario\*/);
  });
});
