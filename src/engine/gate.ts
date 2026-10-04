const SALT = '5009a61804dbf5e6f198c787102a1679';
const DIGEST = 'f565ce6620c55867b32aa270f6bce53a2df1be01b7a1cfd426c6d125c6d7b73c';

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Vrai seulement si la phrase correspond. La comparaison ne s'arrête pas au premier octet. */
export async function opens(phrase: string): Promise<boolean> {
  const material = new TextEncoder().encode(`${SALT}:${phrase}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  const expect = bytes(DIGEST);
  if (digest.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= (digest[i] ?? 0) ^ (expect[i] ?? 0);
  return diff === 0;
}
