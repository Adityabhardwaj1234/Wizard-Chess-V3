'use client';

/**
 * Headless Training Lab (`TrainingLab.tsx`)
 *
 * Implements genuine headless Web Worker self-play and parameter optimisation:
 * - Method explicitly named: Seeded SPSA / Evolutionary 24-Parameter Vector Optimisation.
 * - Opponent selection: Current Champion, Self-Play Diagnostic, Previous Checkpoint, or Built-In Difficulty Tier.
 * - Configurable batch size (up to 100 games/batch), multi-generation runs, search depth, worker pool size (1–8),
 *   and deterministic random seed.
 * - Pause, Resume, Cancel, Restart, and JSON Experiment Export/Import.
 * - Genuine metrics: W/D/L, Score % ± StdErr %, Est. Elo Δ, Games/sec, Nodes/sec, Game-Length distribution,
 *   8-position Tactical Regression Gate pass/fail, and Parameter Mutations.
 * - On-demand 2D Training Game Inspector to replay any simulated training game move-by-move.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PieceSvg } from './PieceSvg';
import { createGame } from '../lib/cathedral';
import { DIFFICULTY_OPTIONS } from '../lib/options';
import {
  createInitialLearningState,
  evaluatePromotionDecision,
  generateCandidateParams,
  loadLearningState,
  saveLearningState
} from '../learning/learningEngine';

interface GameResult {
  gameIndex: number;
  openingEco: string;
  openingName: string;
  candidateColor: 'w' | 'b';
  winnerColor: 'w' | 'b' | 'draw';
  candidateOutcome: 'win' | 'loss' | 'draw';
  terminationReason: string;
  plies: number;
  moves?: string[];
  pgn?: string;
  evalsWhite?: number[];
  finalFen: string;
  totalNodes: number;
  avgDepth: number;
  durationMs: number;
}

interface RegressionResult {
  passedAll: boolean;
  passedCount: number;
  totalCount: number;
  results: { id: string; name: string; bestMoveSan: string | null; passed: boolean }[];
}

interface ParameterChange {
  key: string;
  label: string;
  oldValue: number;
  newValue: number;
  delta: number;
}

interface CheckpointRecord {
  version: string;
  generation: number;
  timestamp: string;
  params: Record<string, number>;
  scorePct: number;
  summary: string;
  parameterChanges: ParameterChange[];
}

interface LearningState {
  experimentName: string;
  methodName?: string;
  currentVersion: string;
  generation: number;
  seed: number;
  totalGamesSimulated: number;
  totalPliesSimulated: number;
  totalNodesSearched: number;
  acceptedCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
  championParams: Record<string, number>;
  checkpoints: CheckpointRecord[];
  generationHistory: {
    generation: number;
    timestamp: string;
    scorePct: number;
    wins: number;
    draws: number;
    losses: number;
    promoted: boolean;
    status: string;
  }[];
  sampleGames: GameResult[];
  lastBatchReport: BatchReport | null;
}

interface BatchReport {
  generation: number;
  opponentLabel: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;
  stdErrPct: number;
  eloDeltaEst: number;
  gamesPerSec: number;
  nodesPerSec: number;
  status: string;
  promoted: boolean;
  reason: string;
  regressionPassed: boolean;
  regressionSummary: string;
  parameterChanges: ParameterChange[];
  sampleGames: GameResult[];
  durationMs: number;
  lastCheckpointTime: string;
}

type Phase = 'idle' | 'regression' | 'playing' | 'paused' | 'finished';
type OpponentMode = 'champion' | 'self' | 'checkpoint' | 'preset';

export function TrainingLab() {
  const [state, setState] = useState<LearningState | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, genDone: 0, genTotal: 1 });
  const [batchGamesCount, setBatchGamesCount] = useState(16);
  const [numGenerations, setNumGenerations] = useState(1);
  const [workerCount, setWorkerCount] = useState(4);
  const [searchDepth, setSearchDepth] = useState(2);
  const [explorationPct, setExplorationPct] = useState(8);
  const [customSeed, setCustomSeed] = useState(202610);
  const [opponentMode, setOpponentMode] = useState<OpponentMode>('champion');
  const [selectedCheckpointVer, setSelectedCheckpointVer] = useState<string>('v1.0');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('ClubPlayer');
  const [error, setError] = useState<string | null>(null);
  const [inspectedGame, setInspectedGame] = useState<GameResult | null>(null);
  const [inspectPly, setInspectPly] = useState<number>(0);

  const poolRef = useRef<Worker[]>([]);
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const loaded = loadLearningState() as LearningState;
      setState(loaded);
      setCustomSeed(loaded.seed || 202610);
    } catch (_err) {
      setState(createInitialLearningState() as LearningState);
    }
  }, []);

  const disposePool = useCallback(() => {
    for (const worker of poolRef.current) worker.terminate();
    poolRef.current = [];
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      disposePool();
    },
    [disposePool]
  );

  const runSingleGenerationStep = useCallback(
    async (baseState: LearningState, genOffset: number): Promise<LearningState | null> => {
      const startedAt = performance.now();
      const activeSeed = (Number(customSeed) || 202610) + baseState.generation + genOffset;

      const { candidateParams, parameterChanges } =
        opponentMode === 'self'
          ? { candidateParams: { ...baseState.championParams }, parameterChanges: [] }
          : generateCandidateParams(baseState.championParams, activeSeed, explorationPct);

      let baselineParams = baseState.championParams;
      let opponentLabel = `Champion (${baseState.currentVersion})`;
      if (opponentMode === 'self') {
        opponentLabel = `Self-Play Baseline (${baseState.currentVersion})`;
      } else if (opponentMode === 'checkpoint') {
        const cp = baseState.checkpoints.find(c => c.version === selectedCheckpointVer);
        if (cp) {
          baselineParams = cp.params;
          opponentLabel = `Checkpoint ${cp.version}`;
        }
      } else if (opponentMode === 'preset') {
        opponentLabel = `Preset ${selectedPresetId}`;
      }

      setPhase('regression');
      const regressionModule = await import('../learning/learningEngine.js');
      const regression = regressionModule.runTacticalRegressionSuite(candidateParams) as RegressionResult;

      if (cancelledRef.current) return null;

      setPhase('playing');
      setProgress(prev => ({ ...prev, done: 0, total: batchGamesCount }));

      const match = await runHeadlessBatch({
        candidateParams,
        championParams: baselineParams,
        opponentPresetId: opponentMode === 'preset' ? selectedPresetId : null,
        totalGames: batchGamesCount,
        workerCount,
        maxDepth: searchDepth,
        seed: activeSeed,
        isCancelled: () => cancelledRef.current,
        isPaused: () => pausedRef.current,
        onProgress: done => setProgress(prev => ({ ...prev, done, total: batchGamesCount })),
        poolRef
      });

      if (cancelledRef.current) return null;

      const results = match.results;
      if (match.errors.length > 0) {
        setError(`${match.errors.length} simulation warning(s): ${match.errors[0]}`);
      }
      if (results.length === 0) return null;

      const wins = results.filter(r => r.candidateOutcome === 'win').length;
      const draws = results.filter(r => r.candidateOutcome === 'draw').length;
      const losses = results.filter(r => r.candidateOutcome === 'loss').length;

      const decision = evaluatePromotionDecision({ wins, draws, losses, regressionResult: regression });
      const canPromote = opponentMode !== 'self' && decision.promoted;

      const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
      const batchNodes = results.reduce((sum, r) => sum + r.totalNodes, 0);
      const gamesPerSec = Number(((results.length * 1000) / durationMs).toFixed(2));
      const nodesPerSec = Math.round((batchNodes * 1000) / durationMs);
      const nextGeneration = baseState.generation + 1;
      const nowIso = new Date().toISOString();

      const report: BatchReport = {
        generation: nextGeneration,
        opponentLabel,
        games: results.length,
        wins,
        draws,
        losses,
        scorePct: decision.scorePct,
        stdErrPct: decision.stdErrPct,
        eloDeltaEst: decision.eloDeltaEst,
        gamesPerSec,
        nodesPerSec,
        status: opponentMode === 'self' ? 'diagnostic' : decision.status,
        promoted: canPromote,
        reason:
          opponentMode === 'self'
            ? `Baseline self-play diagnostic completed (${wins}W–${draws}D–${losses}L, ${decision.scorePct}% ±${decision.stdErrPct}%).`
            : decision.reason,
        regressionPassed: regression.passedAll,
        regressionSummary: `${regression.passedCount}/${regression.totalCount} mandatory tactical tests passed`,
        parameterChanges,
        sampleGames: results.slice(0, 12),
        durationMs,
        lastCheckpointTime: nowIso
      };

      const nextState: LearningState = {
        ...baseState,
        seed: activeSeed,
        generation: nextGeneration,
        totalGamesSimulated: baseState.totalGamesSimulated + results.length,
        totalPliesSimulated: baseState.totalPliesSimulated + results.reduce((sum, r) => sum + r.plies, 0),
        totalNodesSearched: baseState.totalNodesSearched + batchNodes,
        acceptedCount: baseState.acceptedCount + (canPromote ? 1 : 0),
        rejectedCount:
          baseState.rejectedCount + (!canPromote && decision.status === 'rejected' && opponentMode !== 'self' ? 1 : 0),
        inconclusiveCount:
          baseState.inconclusiveCount + (decision.status === 'inconclusive' || opponentMode === 'self' ? 1 : 0),
        championParams: canPromote ? candidateParams : baseState.championParams,
        currentVersion: canPromote ? `v${nextGeneration}` : baseState.currentVersion,
        checkpoints: canPromote
          ? [
              {
                version: `v${nextGeneration}`,
                generation: nextGeneration,
                timestamp: nowIso,
                params: candidateParams,
                scorePct: decision.scorePct,
                summary: decision.reason,
                parameterChanges
              },
              ...baseState.checkpoints
            ]
          : baseState.checkpoints,
        generationHistory: [
          ...baseState.generationHistory,
          {
            generation: nextGeneration,
            timestamp: nowIso,
            scorePct: decision.scorePct,
            wins,
            draws,
            losses,
            promoted: canPromote,
            status: report.status
          }
        ],
        sampleGames: [...results.slice(0, 12), ...baseState.sampleGames].slice(0, 24),
        lastBatchReport: report
      };

      saveLearningState(nextState as unknown as Record<string, unknown>);
      setState(nextState);
      return nextState;
    },
    [batchGamesCount, customSeed, explorationPct, opponentMode, searchDepth, selectedCheckpointVer, selectedPresetId, workerCount]
  );

  const startExperiment = useCallback(async () => {
    if (phase === 'regression' || phase === 'playing') return;
    setError(null);
    cancelledRef.current = false;
    pausedRef.current = false;

    let current = (state ?? (loadLearningState() as LearningState)) as LearningState;
    try {
      for (let g = 0; g < numGenerations; g++) {
        if (cancelledRef.current) break;
        setProgress({ done: 0, total: batchGamesCount, genDone: g + 1, genTotal: numGenerations });
        const updated = await runSingleGenerationStep(current, g);
        if (!updated || cancelledRef.current) break;
        current = updated;
      }
      setPhase(cancelledRef.current ? 'idle' : 'finished');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Training run failed.');
      setPhase('idle');
    } finally {
      disposePool();
    }
  }, [batchGamesCount, disposePool, numGenerations, phase, runSingleGenerationStep, state]);

  const rollbackToCheckpoint = (cp: CheckpointRecord) => {
    if (!state) return;
    const updated: LearningState = {
      ...state,
      currentVersion: cp.version,
      championParams: { ...cp.params }
    };
    saveLearningState(updated as unknown as Record<string, unknown>);
    setState(updated);
  };

  const exportExperimentJson = () => {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wizards-chess-training-gen-${state.generation}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const running = phase === 'regression' || phase === 'playing' || phase === 'paused';

  // Inspect a simulated game on an on-demand 2D board
  const inspectedBoardState = useMemo(() => {
    if (!inspectedGame || !inspectedGame.moves) return null;
    const g = createGame();
    const maxPly = Math.min(inspectPly, inspectedGame.moves.length);
    for (let i = 0; i < maxPly; i++) {
      g.move(inspectedGame.moves[i]);
    }
    return g;
  }, [inspectedGame, inspectPly]);

  if (!state) {
    return (
      <section className="training-lab-view" aria-label="Headless self-play training laboratory">
        <div className="panel-section">
          <p className="text-muted">Loading persisted Training Lab state…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="training-lab-view" aria-label="Headless self-play training laboratory">
      <div className="panel-section">
        <div className="section-header">
          <span>Experimental Learning Engine &amp; Headless Training Lab</span>
          <span>Method: Seeded SPSA / Evolutionary 24-Parameter Tuning</span>
        </div>
        <p className="honest-disclaimer">
          Runs 100% headless in background Web Workers without rendering boards during simulation. Candidates must pass
          all 8 mandatory tactical regression tests and score &ge;52.0% with a positive win margin to replace the
          reigning Champion.
        </p>

        <div className="control-grid-4">
          <label className="field">
            <span>Opponent / Baseline</span>
            <select
              value={opponentMode}
              disabled={running}
              onChange={e => setOpponentMode(e.target.value as OpponentMode)}
            >
              <option value="champion">Current Champion ({state.currentVersion})</option>
              <option value="self">Champion vs Itself (Baseline Diagnostic)</option>
              <option value="checkpoint">Previous Champion Checkpoint</option>
              <option value="preset">Built-In Difficulty Tier</option>
            </select>
          </label>

          {opponentMode === 'checkpoint' && (
            <label className="field">
              <span>Select Checkpoint</span>
              <select
                value={selectedCheckpointVer}
                disabled={running}
                onChange={e => setSelectedCheckpointVer(e.target.value)}
              >
                {state.checkpoints.map(cp => (
                  <option key={cp.version} value={cp.version}>
                    {cp.version} (Gen {cp.generation})
                  </option>
                ))}
              </select>
            </label>
          )}

          {opponentMode === 'preset' && (
            <label className="field">
              <span>Select Difficulty Tier</span>
              <select
                value={selectedPresetId}
                disabled={running}
                onChange={e => setSelectedPresetId(e.target.value)}
              >
                {DIFFICULTY_OPTIONS.filter(d => d.id !== 'Experimental').map(d => (
                  <option key={d.id} value={d.id}>
                    {d.shortLabel} (~{d.estimatedRating})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span>Games per Batch (up to 100)</span>
            <input
              type="number"
              min={4}
              max={100}
              step={2}
              value={batchGamesCount}
              disabled={running}
              onChange={e => setBatchGamesCount(Math.max(4, Math.min(100, Number(e.target.value) || 12)))}
            />
          </label>

          <label className="field">
            <span>Generations to Run</span>
            <input
              type="number"
              min={1}
              max={25}
              value={numGenerations}
              disabled={running}
              onChange={e => setNumGenerations(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
            />
          </label>

          <label className="field">
            <span>Workers ({workerCount})</span>
            <input
              type="range"
              min={1}
              max={8}
              value={workerCount}
              disabled={running}
              onChange={e => setWorkerCount(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Search Depth ({searchDepth} ply)</span>
            <select
              value={searchDepth}
              disabled={running}
              onChange={e => setSearchDepth(Number(e.target.value))}
            >
              <option value={2}>2 ply (Fast Throughput)</option>
              <option value={3}>3 ply (Balanced Tactical)</option>
              <option value={4}>4 ply (Deep Verification)</option>
            </select>
          </label>

          <label className="field">
            <span>Mutation Scale ({explorationPct}%)</span>
            <input
              type="range"
              min={3}
              max={20}
              value={explorationPct}
              disabled={running}
              onChange={e => setExplorationPct(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Deterministic Seed</span>
            <input
              type="number"
              value={customSeed}
              disabled={running}
              onChange={e => setCustomSeed(Number(e.target.value) || 42)}
            />
          </label>
        </div>

        <div className="control-row" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="nav-btn primary" onClick={startExperiment} disabled={running}>
            {running
              ? `Running Gen ${progress.genDone}/${progress.genTotal} (${progress.done}/${progress.total} games)…`
              : '▶ Start Headless Training Run'}
          </button>

          {running && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                pausedRef.current = !pausedRef.current;
                setPhase(pausedRef.current ? 'paused' : 'playing');
              }}
            >
              {phase === 'paused' ? '▶ Resume' : '⏸ Pause'}
            </button>
          )}

          <button
            type="button"
            className="icon-btn danger"
            disabled={!running}
            onClick={() => {
              cancelledRef.current = true;
              disposePool();
              setPhase('idle');
            }}
          >
            ■ Cancel Run
          </button>

          <button type="button" className="icon-btn" onClick={exportExperimentJson}>
            ⇩ Export Experiment JSON
          </button>
        </div>

        {error && <p className="engine-error">{error}</p>}
      </div>

      {/* Live Telemetry Metrics */}
      <div className="telemetry-grid">
        <div className="metric-box">
          <span className="metric-label">Current Generation</span>
          <span className="metric-value">{state.generation}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Active Champion</span>
          <span className="metric-value">{state.currentVersion}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Total Games Simulated</span>
          <span className="metric-value">{state.totalGamesSimulated.toLocaleString()}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Total Nodes Searched</span>
          <span className="metric-value">{state.totalNodesSearched.toLocaleString()}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Promotions / Rejections</span>
          <span className="metric-value">
            {state.acceptedCount} / {state.rejectedCount}
          </span>
        </div>
      </div>

      {/* Latest Batch Report */}
      {state.lastBatchReport && (
        <div className="panel-section">
          <div className="section-header">
            <span>
              Generation {state.lastBatchReport.generation} Report vs {state.lastBatchReport.opponentLabel}
            </span>
            <span data-status={state.lastBatchReport.status}>{state.lastBatchReport.status.toUpperCase()}</span>
          </div>

          <div className="telemetry-grid">
            <div className="metric-box">
              <span className="metric-label">Score ± Uncertainty</span>
              <span className="metric-value">
                {state.lastBatchReport.scorePct}% ±{state.lastBatchReport.stdErrPct}%
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">W / D / L</span>
              <span className="metric-value">
                {state.lastBatchReport.wins} / {state.lastBatchReport.draws} / {state.lastBatchReport.losses}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Throughput</span>
              <span className="metric-value">
                {state.lastBatchReport.gamesPerSec} games/s · {state.lastBatchReport.nodesPerSec.toLocaleString()} nps
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Est. Elo Δ</span>
              <span className="metric-value">
                {state.lastBatchReport.eloDeltaEst > 0
                  ? `+${state.lastBatchReport.eloDeltaEst}`
                  : state.lastBatchReport.eloDeltaEst}
              </span>
            </div>
          </div>

          <p className={state.lastBatchReport.promoted ? 'report-promoted' : 'text-muted'}>
            {state.lastBatchReport.reason}
          </p>
          <p className="text-muted">
            Regression Gate: {state.lastBatchReport.regressionSummary} · Elapsed:{' '}
            {(state.lastBatchReport.durationMs / 1000).toFixed(2)}s
          </p>
        </div>
      )}

      {/* Parameter Mutations Table */}
      {state.lastBatchReport && state.lastBatchReport.parameterChanges.length > 0 && (
        <div className="panel-section">
          <div className="section-header">
            <span>Candidate Parameter Mutations</span>
            <span>{state.lastBatchReport.parameterChanges.length} weights perturbed</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Baseline</th>
                <th scope="col">Candidate</th>
                <th scope="col">Delta</th>
              </tr>
            </thead>
            <tbody>
              {state.lastBatchReport.parameterChanges.map(change => (
                <tr key={change.key}>
                  <td>{change.label}</td>
                  <td>{change.oldValue}</td>
                  <td>{change.newValue}</td>
                  <td>{change.delta > 0 ? `+${change.delta}` : change.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Simulated Games List & Lightweight 2D Inspector */}
      {state.sampleGames && state.sampleGames.length > 0 && (
        <div className="panel-section">
          <div className="section-header">
            <span>Simulated Games &amp; 2D Replay Inspector</span>
            <span>Click any game to inspect</span>
          </div>
          <div className="sample-games-grid">
            {state.sampleGames.slice(0, 8).map((g, idx) => (
              <button
                key={`${g.gameIndex}-${idx}`}
                type="button"
                className="icon-btn"
                onClick={() => {
                  setInspectedGame(g);
                  setInspectPly(g.plies);
                }}
              >
                Game #{g.gameIndex + 1} · {g.openingEco} ({g.candidateOutcome.toUpperCase()}, {g.plies} ply)
              </button>
            ))}
          </div>

          {inspectedGame && inspectedBoardState && (
            <div className="inspector-card" style={{ marginTop: '1rem' }}>
              <div className="section-header">
                <strong>
                  Inspecting Game #{inspectedGame.gameIndex + 1}: {inspectedGame.openingEco} {inspectedGame.openingName}{' '}
                  ({inspectedGame.terminationReason})
                </strong>
                <button type="button" className="icon-btn" onClick={() => setInspectedGame(null)}>
                  ✕ Close Inspector
                </button>
              </div>
              <div className="inspector-layout">
                <div className="mini-board-grid">
                  {inspectedBoardState.board().map((row, rIdx) => (
                    <div key={rIdx} className="mini-board-row">
                      {row.map((cell, cIdx) => {
                        const isLight = (rIdx + cIdx) % 2 === 0;
                        return (
                          <div key={cIdx} className={`mini-sq ${isLight ? 'sq-light' : 'sq-dark'}`}>
                            {cell && <PieceSvg type={cell.type} color={cell.color} size={28} />}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="inspector-controls">
                  <p className="text-muted">
                    Ply {inspectPly} of {inspectedGame.plies} · Avg Search Depth: {inspectedGame.avgDepth} · Total Nodes:{' '}
                    {inspectedGame.totalNodes.toLocaleString()}
                  </p>
                  <div className="control-row">
                    <button type="button" className="icon-btn" onClick={() => setInspectPly(0)}>
                      ⏮ Start
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setInspectPly(p => Math.max(0, p - 1))}
                    >
                      ◀ Prev
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setInspectPly(p => Math.min(inspectedGame.plies, p + 1))}
                    >
                      Next ▶
                    </button>
                    <button type="button" className="icon-btn" onClick={() => setInspectPly(inspectedGame.plies)}>
                      End ⏭
                    </button>
                  </div>
                  <code className="library-fen" style={{ display: 'block', marginTop: '0.5rem' }}>
                    {inspectedGame.moves?.join(' ')}
                  </code>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Checkpoints & Rollback Manager */}
      <div className="panel-section">
        <div className="section-header">
          <span>Saved Champion Checkpoints &amp; Rollback</span>
          <span>{state.checkpoints.length} checkpoints</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Gen</th>
              <th scope="col">Score</th>
              <th scope="col">Summary</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {state.checkpoints.map(cp => (
              <tr key={cp.version}>
                <td>
                  <strong>{cp.version}</strong>
                  {cp.version === state.currentVersion ? ' (Active)' : ''}
                </td>
                <td>{cp.generation}</td>
                <td>{cp.scorePct}%</td>
                <td>{cp.summary}</td>
                <td>
                  {cp.version !== state.currentVersion && (
                    <button type="button" className="icon-btn" onClick={() => rollbackToCheckpoint(cp)}>
                      Restore Champion
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
 * Bounded Headless Worker Pool Runner
 * -------------------------------------------------------------------------- */
interface RunBatchArgs {
  candidateParams: Record<string, number>;
  championParams: Record<string, number>;
  opponentPresetId: string | null;
  totalGames: number;
  workerCount: number;
  maxDepth: number;
  seed: number;
  isCancelled: () => boolean;
  isPaused: () => boolean;
  onProgress: (done: number) => void;
  poolRef: React.MutableRefObject<Worker[]>;
}

async function runHeadlessBatch({
  candidateParams,
  championParams,
  opponentPresetId,
  totalGames,
  workerCount,
  maxDepth,
  seed,
  isCancelled,
  isPaused,
  onProgress,
  poolRef
}: RunBatchArgs): Promise<{ results: GameResult[]; errors: string[] }> {
  const results: GameResult[] = [];
  const errors: string[] = [];
  let nextGameIndex = 0;

  // Fallback to synchronous simulation if Worker is unavailable
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    const mod = await import('../learning/learningEngine.js');
    for (let i = 0; i < totalGames; i++) {
      if (isCancelled()) break;
      const gRes = mod.simulateSingleHeadlessGame({
        gameIndex: i,
        openingIndex: Math.floor(i / 2),
        candidateColor: i % 2 === 0 ? 'w' : 'b',
        candidateParams,
        championParams,
        opponentPresetId,
        maxDepth,
        timeLimitMs: 25,
        maxPlies: 76,
        seed: seed + i * 31
      }) as GameResult;
      results.push(gRes);
      onProgress(results.length);
    }
    return { results, errors };
  }

  return new Promise(resolve => {
    const numWorkers = Math.max(1, Math.min(8, workerCount, totalGames));
    let activeWorkers = numWorkers;
    const pool: Worker[] = [];

    try {
      for (let w = 0; w < numWorkers; w++) {
        pool.push(new Worker(new URL('../workers/training.worker.js', import.meta.url)));
      }
      poolRef.current = pool;
    } catch (_err) {
      // Fallback if Worker bundling is blocked
      void import('../learning/learningEngine.js').then(mod => {
        for (let i = 0; i < totalGames; i++) {
          if (isCancelled()) break;
          const gRes = mod.simulateSingleHeadlessGame({
            gameIndex: i,
            openingIndex: Math.floor(i / 2),
            candidateColor: i % 2 === 0 ? 'w' : 'b',
            candidateParams,
            championParams,
            opponentPresetId,
            maxDepth,
            timeLimitMs: 25,
            maxPlies: 76,
            seed: seed + i * 31
          }) as GameResult;
          results.push(gRes);
          onProgress(results.length);
        }
        resolve({ results, errors });
      });
      return;
    }

    const dispatchNext = (worker: Worker, workerIdx: number) => {
      if (isCancelled()) {
        activeWorkers--;
        if (activeWorkers <= 0) resolve({ results, errors });
        return;
      }
      if (isPaused()) {
        setTimeout(() => dispatchNext(worker, workerIdx), 200);
        return;
      }
      if (nextGameIndex >= totalGames) {
        activeWorkers--;
        if (activeWorkers <= 0) {
          for (const w of pool) w.terminate();
          poolRef.current = [];
          resolve({ results, errors });
        }
        return;
      }

      const gameIndex = nextGameIndex++;
      worker.postMessage({
        type: 'RUN_GAME',
        workerId: workerIdx,
        taskId: gameIndex,
        config: {
          gameIndex,
          openingIndex: Math.floor(gameIndex / 2),
          candidateColor: gameIndex % 2 === 0 ? 'w' : 'b',
          candidateParams,
          championParams,
          opponentPresetId,
          maxDepth,
          timeLimitMs: 25,
          maxPlies: 76,
          seed: seed + gameIndex * 31
        }
      });
    };

    pool.forEach((worker, idx) => {
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as { type: string; gameResult?: GameResult; error?: string };
        if (msg.type === 'GAME_COMPLETE' && msg.gameResult) {
          results.push(msg.gameResult);
        } else if (msg.type === 'GAME_ERROR') {
          errors.push(String(msg.error ?? 'simulation error'));
        }
        onProgress(results.length + errors.length);
        dispatchNext(worker, idx);
      };
      worker.onerror = () => {
        errors.push(`Worker ${idx} error`);
        onProgress(results.length + errors.length);
        dispatchNext(worker, idx);
      };
      dispatchNext(worker, idx);
    });
  });
}