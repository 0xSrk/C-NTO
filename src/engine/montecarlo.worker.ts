import { monteCarlo, type MonteCarloOptions } from './montecarlo';

type In = { pnls: number[]; opts: Omit<MonteCarloOptions, 'signal' | 'onProgress'> };

self.onmessage = (e: MessageEvent<In>) => {
  try {
    const result = monteCarlo(e.data.pnls, {
      ...e.data.opts,
      onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }),
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
