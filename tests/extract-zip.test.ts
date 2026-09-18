import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { extractZipJs } from '../scripts/extract-zip.mjs';

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = f.data;
    const payload = f.deflate ? deflateRawSync(raw) : raw;
    const method = f.deflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04'),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      name,
      payload,
    ]);
    const central = Buffer.concat([
      Buffer.from('PK\x01\x02'),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(raw.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([Buffer.from('PK\x05\x06'), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, cd, eocd]);
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(): Promise<{ dir: string; zip: string; out: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'canto-zip-'));
  dirs.push(dir);
  return { dir, zip: path.join(dir, 'a.zip'), out: path.join(dir, 'out') };
}

describe('extractZipJs', () => {
  it('extrait store et deflate', async () => {
    const { zip, out } = await scratch();
    await writeFile(zip, makeZip([
      { name: 'hello.txt', data: Buffer.from('bonjour') },
      { name: 'nested/data.bin', data: Buffer.from('xyz'.repeat(40)), deflate: true },
    ]));
    await extractZipJs(zip, out);
    expect(await readFile(path.join(out, 'hello.txt'), 'utf8')).toBe('bonjour');
    expect(await readFile(path.join(out, 'nested/data.bin'), 'utf8')).toBe('xyz'.repeat(40));
  });

  it('refuse le zip slip', async () => {
    const { zip, out } = await scratch();
    await mkdir(out, { recursive: true });
    await writeFile(zip, makeZip([{ name: '../evil.txt', data: Buffer.from('nope') }]));
    await expect(extractZipJs(zip, out)).rejects.toThrow(/refusé|hors cible/);
  });
});
