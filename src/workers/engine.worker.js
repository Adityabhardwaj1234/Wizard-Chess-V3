/**
 * Dedicated Web Worker for the Cathedral Engine
 * Keeps iterative deepening alpha-beta searches off the main UI and 3D rendering thread.
 */

import { CathedralEngine } from '../engine/CathedralEngine.js';

const engine = new CathedralEngine();

self.onmessage = function (event) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'STOP') {
    engine.requestStop();
    return;
  }

  if (msg.type === 'CLEAR_CACHE') {
    engine.clearCache();
    return;
  }

  if (msg.type === 'SEARCH') {
    const { requestId, fen, options } = msg;
    try {
      const result = engine.search(fen, {
        ...options,
        onProgress: progress => {
          self.postMessage({
            type: 'PROGRESS',
            requestId,
            progress
          });
        }
      });
      self.postMessage({
        type: 'RESULT',
        requestId,
        fen,
        result
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        requestId,
        error: err && err.message ? err.message : 'Engine search error'
      });
    }
  }
};
