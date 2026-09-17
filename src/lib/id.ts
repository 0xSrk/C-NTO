const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Identifiant court, lisible, trié dans le temps (préfixe temporel + entropie). */
export function uid(prefix = ''): string {
  const now = Date.now();
  let time = '';
  let t = now;
  for (let i = 0; i < 8; i++) {
    time = (ALPHABET[t % 32] ?? '0') + time;
    t = Math.floor(t / 32);
  }
  let rnd = '';
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < bytes.length; i++) rnd += ALPHABET[(bytes[i] ?? 0) % 32] ?? '0';
  return prefix ? `${prefix}_${time}${rnd}` : `${time}${rnd}`;
}
