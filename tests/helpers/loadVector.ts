import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadVector<T>(name: string): T {
  return JSON.parse(readFileSync(join(ROOT, 'vectors', name), 'utf8')) as T;
}
