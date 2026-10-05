import { describe, expect, it } from 'vitest';
import { llmHostOk } from '../electron/llm-host';
import { PRESETS } from '@/modules/agent/presets';

describe('préréglages de fournisseur', () => {
  it('chaque préréglage ouvert passe la liste d’hôtes épinglée du process principal', () => {
    for (const p of PRESETS.filter((x) => !x.reserved)) {
      expect(llmHostOk(p.baseUrl), p.id).toBe(true);
      expect(p.model.length, p.id).toBeGreaterThan(0);
    }
  });

  it('l’emplacement du modèle du Lab est tenu, sans hôte ni modèle tant qu’il n’est pas ouvert', () => {
    const lab = PRESETS.find((p) => p.id === 'lab-artefact-003');
    expect(lab).toMatchObject({ reserved: true, baseUrl: '', model: '' });
    expect(lab?.label).toContain('Artefact 003');
  });

  it('identifiants uniques', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});
