import type { AgentProvider } from '@/store/settings';

export interface ProviderPreset {
  id: string;
  label: string;
  provider: AgentProvider;
  baseUrl: string;
  model: string;
  /** Emplacement tenu pour un fournisseur pas encore ouvert : visible, pas sélectionnable. */
  reserved?: boolean;
}

/**
 * Points de départ. « Tester la connexion » liste ensuite les modèles réellement servis par le
 * fournisseur (champ Modèle). Chaque hôte doit figurer dans la liste épinglée du process principal
 * (`electron/llm-host.ts`), sans quoi l'appel est refusé.
 */
export const PRESETS: readonly ProviderPreset[] = [
  { id: 'ollama', label: 'Ollama (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { id: 'lmstudio', label: 'LM Studio (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
  { id: 'openai', label: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
  // Modèle du Lab (Artefact 003) : son hôte rejoindra la liste épinglée du main le jour de son ouverture.
  { id: 'lab-artefact-003', label: 'SIΞRRΛSKΛ Lab · Artefact 003', provider: 'openai-compatible', baseUrl: '', model: '', reserved: true },
];
