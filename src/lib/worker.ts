/** Écoute un Worker module : progress / done / error, Annuler via AbortSignal. */
export function listenWorker<T>(
  worker: Worker,
  opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      opts?.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      stop();
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    if (opts?.signal?.aborted) {
      onAbort();
      return;
    }
    opts?.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; result?: T; error?: string }>) => {
      if (e.data.type === 'progress') {
        opts?.onProgress?.(e.data.done ?? 0, e.data.total ?? 1);
        return;
      }
      stop();
      if (e.data.type === 'error') reject(new Error(e.data.error ?? 'worker'));
      else resolve(e.data.result as T);
    };
    worker.onerror = (ev) => {
      stop();
      reject(new Error(ev.message));
    };
  });
}
