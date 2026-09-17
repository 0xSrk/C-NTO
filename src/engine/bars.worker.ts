import { importBarsCsv } from './bars';

self.onmessage = (e: MessageEvent<{ text: string }>) => {
  try {
    self.postMessage({ type: 'progress', done: 0, total: 1 });
    const result = importBarsCsv(e.data.text);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
