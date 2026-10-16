/**
 * Dedicated Headless Self-Play Web Worker (training.worker.js)
 * Executes single or sub-batch self-play games between Candidate and Champion
 * parameter configurations with zero DOM or Three.js overhead and < 1 MB RAM.
 */

import { simulateSingleHeadlessGame, runTacticalRegressionSuite } from '../learning/learningEngine.js';

self.onmessage = function (event) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'RUN_GAME') {
    const { workerId, taskId, config } = msg;
    try {
      const gameResult = simulateSingleHeadlessGame(config);
      self.postMessage({
        type: 'GAME_COMPLETE',
        workerId,
        taskId,
        gameResult
      });
    } catch (err) {
      self.postMessage({
        type: 'GAME_ERROR',
        workerId,
        taskId,
        error: err && err.message ? err.message : 'Simulation error'
      });
    }
  } else if (msg.type === 'RUN_REGRESSION') {
    const { requestId, candidateParams } = msg;
    const regressionResult = runTacticalRegressionSuite(candidateParams);
    self.postMessage({
      type: 'REGRESSION_COMPLETE',
      requestId,
      regressionResult
    });
  }
};
