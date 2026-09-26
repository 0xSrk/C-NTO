import { recomputeOntology } from './recompute';
import type { Link } from './schema';
import type { StructuralInput } from './structural';

self.onmessage = (e: MessageEvent<{ input: StructuralInput; existing: Link[]; now: number }>) => {
  try {
    const { input, existing, now } = e.data;
    const result = recomputeOntology(input, existing, now);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
