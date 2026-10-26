import { inflateSync } from 'node:zlib';

/** Image PNG décodée : 8 bits par canal, RVB ou RVBA, non entrelacée. */
export interface Png {
  width: number;
  height: number;
  channels: 3 | 4;
  /** [r, g, b] du pixel (x, y). */
  rgb(x: number, y: number): [number, number, number];
}

/** Décodeur PNG minimal pour les gardes d'icône : IHDR, IDAT concaténés, filtres 0 à 4. */
export function decodePng(buf: Buffer): Png {
  if (buf.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('pas un PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString('latin1');
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colour = data[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || data[12] !== 0) throw new Error(`PNG non pris en charge (${depth}, ${colour})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels]! : 0;
      let v = line[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  return {
    width,
    height,
    channels,
    rgb: (x, y) => {
      const o = y * stride + x * channels;
      return [out[o]!, out[o + 1]!, out[o + 2]!];
    },
  };
}

/** Entrées d'un fichier ICO : taille déclarée et charge PNG (les icônes du desk sont en PNG). */
export function icoEntries(buf: Buffer): { size: number; png: Buffer }[] {
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const o = 6 + i * 16;
    const size = buf[o] || 256;
    const bytes = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    return { size, png: buf.subarray(offset, offset + bytes) };
  });
}
