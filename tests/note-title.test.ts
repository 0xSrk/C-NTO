import { describe, expect, it } from 'vitest';
import { suggestNoteTitle } from '../src/modules/note/title';

describe('titre de note', () => {
  it('prend la première ligne tant que le titre est le placeholder', () => {
    expect(suggestNoteTitle('Nouvelle note', '# Plan\n\ncorps')).toBe('Plan');
    expect(suggestNoteTitle('Nouvelle note 2', 'Biais du jour')).toBe('Biais du jour');
  });

  it('laisse un titre déjà choisi', () => {
    expect(suggestNoteTitle('Journal', '# Autre')).toBeNull();
    expect(suggestNoteTitle('Nouvelle note', '')).toBeNull();
  });
});
