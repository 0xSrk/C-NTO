import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LlmStreamError, SSE_LIMITS, sseData } from '../electron/llm-stream';

/**
 * SEC2.3 — le flux du fournisseur est borné. Le process principal lisait la réponse du modèle sans délai d'inactivité ni
 * limite de tampon : un fournisseur qui se tait au milieu d'une réponse laissait la conversation tourner sans fin, et une
 * ligne sans fin (un point d'accès local compatible, un proxy en défaut) grossissait la mémoire du process principal,
 * celui qui tient le pont et les gardes. Soixante secondes sans octet, ou plus d'un mégaoctet sans fin de ligne : le flux
 * est coupé, et le desk le dit.
 */

const encoder = new TextEncoder();

/** Un corps de réponse piloté par le test : `push` envoie, `close` termine ; `cancelled` dit si le lecteur l'a coupé. */
function body() {
  const state = { cancelled: false };
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    res: { body: stream },
    state,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

const never = new AbortController().signal;

describe('SEC2.3 le flux du fournisseur LLM est borné', () => {
  it('les bornes : soixante secondes de silence, un mégaoctet sans fin de ligne', () => {
    expect(SSE_LIMITS).toEqual({ idleMs: 60_000, maxBuffer: 1024 * 1024 });
  });

  it('un flux normal rend chaque ligne `data:`, dans l’ordre, coupures de trame et \\r\\n compris', async () => {
    const b = body();
    const seen: string[] = [];
    const done = sseData(b.res, never, (data) => seen.push(data));
    b.push('data: {"a":1}\n\nda');
    b.push('ta: {"b":2}\r\n');
    b.push(': commentaire\nevent: x\ndata:[DONE]\n');
    b.close();
    await done;
    expect(seen).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
    expect(b.state.cancelled).toBe(false);
  });

  it('un fournisseur qui se tait au milieu de la réponse : le flux est coupé après le délai, et l’erreur le dit', async () => {
    const b = body();
    const seen: string[] = [];
    const started = Date.now();
    const done = sseData(b.res, never, (data) => seen.push(data), { idleMs: 60, maxBuffer: 1024 });
    b.push('data: début\n');
    const error = await done.then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmStreamError);
    expect((error as LlmStreamError).code).toBe('idle');
    expect(seen).toEqual(['début']);
    expect(b.state.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('chaque octet reçu repousse le délai : un flux lent mais vivant va au bout', async () => {
    const b = body();
    const seen: string[] = [];
    const done = sseData(b.res, never, (data) => seen.push(data), { idleMs: 120, maxBuffer: 1024 });
    for (let i = 0; i < 4; i += 1) {
      b.push(`data: ${i}\n`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    b.close();
    await done;
    expect(seen).toEqual(['0', '1', '2', '3']);
  });

  it('une ligne sans fin au-delà de la borne : le flux est coupé, rien n’est rendu, la mémoire ne grossit plus', async () => {
    const b = body();
    const seen: string[] = [];
    const done = sseData(b.res, never, (data) => seen.push(data), { idleMs: 5_000, maxBuffer: 1024 });
    b.push(`data: ${'x'.repeat(600)}`);
    b.push('y'.repeat(600));
    const error = await done.then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(LlmStreamError);
    expect((error as LlmStreamError).code).toBe('overflow');
    expect(seen).toEqual([]);
    expect(b.state.cancelled).toBe(true);
  });

  it('une longue réponse en lignes courtes passe : la borne porte sur le tampon, pas sur la réponse', async () => {
    const b = body();
    let count = 0;
    const done = sseData(b.res, never, () => (count += 1), { idleMs: 5_000, maxBuffer: 1024 });
    for (let i = 0; i < 50; i += 1) b.push(`data: ${'z'.repeat(500)}\n`);
    b.close();
    await done;
    expect(count).toBe(50);
  });

  it('une conversation annulée s’arrête sans erreur, comme avant', async () => {
    const b = body();
    const ac = new AbortController();
    ac.abort();
    await expect(sseData(b.res, ac.signal, () => undefined)).resolves.toBeUndefined();
    expect(b.state.cancelled).toBe(true);
    await expect(sseData({ body: null }, never, () => undefined)).resolves.toBeUndefined();
  });

  it('le process principal lit les deux fournisseurs par ce lecteur, et dit la coupure dans les trois langues', () => {
    const main = readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n');
    expect(main).not.toMatch(/async function sseData\(/);
    expect([...main.matchAll(/await sseData\(res, signal, /g)]).toHaveLength(2);
    expect(main).toMatch(/err instanceof LlmStreamError \? llmStreamCut\(err\)/);
    expect(main).toContain("'Fournisseur muet depuis 60 secondes : la réponse est interrompue. Relancez la demande.'");
    expect(main).toContain("'Provider silent for 60 seconds: the answer was cut. Send the request again.'");
    expect(main).toContain("'Proveedor en silencio desde hace 60 segundos: la respuesta se interrumpió. Repita la solicitud.'");
    expect(main).toContain("'Réponse du fournisseur illisible (plus de 1 Mo sans fin de ligne) : elle est interrompue.'");
  });
});
