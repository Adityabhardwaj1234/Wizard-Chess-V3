'use client';

/**
 * Analysis, 11-Layer X-Ray & Post-Game Review (`XRayOverlayPanel.tsx`)
 *
 * Provides:
 * - Interactive 2D board with live replay navigation (`⏮`, `◀`, `▶ Replay`, `▶`, `⏭`).
 * - Separately controllable toggles for all 11 X-Ray tactical layers.
 * - Explicit epistemic badges (`Fact`, `Candidate Line`, `Prediction`, `Shallow Uncertainty`).
 * - SVG Move-Evaluation Graph across the entire game timeline.
 * - Post-Game Review Summary (Best, Excellent, Good, Inaccuracy, Mistake, Blunder, ACPL & Accuracy %).
 * - On-Demand Pre-Move / Last-Move Blunder Check & FEN Position Inspector.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';

import { CathedralBoard } from './CathedralBoard';
import { useSession, type XRayLayerConfig } from '../context/CathedralSession';
import {
  createGame,
  evalWhite,
  xray as xrayApi,
  type BeforeMoveWarning,
  type VerboseMove
} from '../lib/cathedral';
import { loadLearningState } from '../learning/learningEngine';

interface WarningEngine {
  search(fen: string, options: Record<string, unknown>): {
    bestMoveSan: string | null;
    scoreSideToMoveCp: number;
    scoreWhiteCp: number;
    mateIn: unknown;
    pv: string[];
    depth: number;
  };
}

export function XRayOverlayPanel() {
  const {
    snapshot,
    displayedGame,
    moveMeta,
    reviewSummary,
    xrayLayers,
    setXrayLayer,
    lastHumanMove,
    engineResult,
    goToPly,
    stepFirst,
    stepPrev,
    stepNext,
    stepLast,
    autoReplay,
    toggleAutoReplay,
    importFen
  } = useSession();

  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<BeforeMoveWarning | null>(null);
  const [warningError, setWarningError] = useState<string | null>(null);
  const [customFenInput, setCustomFenInput] = useState('');
  const [fenStatus, setFenStatus] = useState<string | null>(null);
  const engineRef = useRef<WarningEngine | null>(null);

  const analysis = useMemo(() => {
    try {
      return xrayApi.computeXRayAnalysis(displayedGame, engineResult);
    } catch (_err) {
      return null;
    }
  }, [displayedGame, snapshot.fen, engineResult]);

  const championEval = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const state = loadLearningState() as { championParams?: Record<string, number> };
      if (!state.championParams) return null;
      return {
        learned: evalWhite(displayedGame, state.championParams),
        handcrafted: evalWhite(displayedGame, null)
      };
    } catch (_err) {
      return null;
    }
  }, [displayedGame, snapshot.fen]);

  const runBlunderCheck = useCallback(async () => {
    const last = lastHumanMove ?? snapshot.lastMove;
    if (!last || !last.before) return;

    setChecking(true);
    setWarningError(null);
    setWarning(null);

    try {
      if (!engineRef.current) {
        const mod = await import('../engine/CathedralEngine.js');
        engineRef.current = new mod.CathedralEngine(1 << 14) as unknown as WarningEngine;
      }

      const preMove = createGame(last.before);
      const verbose = preMove.moves({ verbose: true });
      const candidate = (Array.isArray(verbose) ? (verbose as VerboseMove[]) : []).find(m => m.san === last.san);
      if (!candidate) {
        setWarningError(`Could not reconstruct ${last.san} from the recorded position.`);
        return;
      }

      const result = xrayApi.evaluateBeforeMoveWarning(preMove, candidate, engineRef.current);
      setWarning(result);
      if (!result) {
        setWarningError(`Verified: ${last.san} does not allow a forcing tactical refutation at 3-ply check depth.`);
      }
    } catch (err) {
      setWarningError(err instanceof Error ? err.message : 'Blunder check failed.');
    } finally {
      setChecking(false);
    }
  }, [lastHumanMove, snapshot.lastMove]);

  const handleLoadFen = () => {
    if (!customFenInput.trim()) return;
    const res = importFen(customFenInput.trim());
    if (res.ok) {
      setFenStatus('Position loaded onto the board.');
      setCustomFenInput('');
    } else {
      setFenStatus(`Invalid FEN: ${res.error}`);
    }
  };

  const layerControls: { key: keyof XRayLayerConfig; label: string; epistemic: string }[] = [
    { key: 'enabled', label: 'Master X-Ray Overlay Switch', epistemic: 'Control' },
    { key: 'attackedSquares', label: '1. Attacked Squares & Control Counts', epistemic: 'Current Fact' },
    { key: 'defendedPieces', label: '2. Defended Friendly Pieces', epistemic: 'Current Fact' },
    { key: 'hangingPieces', label: '3. Hanging & Insufficiently Defended Pieces (SEE)', epistemic: 'Current Fact' },
    { key: 'pinsAndDiscovered', label: '4. Absolute/Relative Pins & Discovered Batteries', epistemic: 'Current Fact' },
    { key: 'forksAndSkewers', label: '5. Active Forks & Skewers', epistemic: 'Current Fact' },
    { key: 'overloadedDefenders', label: '6. Overloaded Defenders', epistemic: 'Current Fact' },
    { key: 'kingThreats', label: '7. King Threats, Checks & Exposed Zone', epistemic: 'Current Fact' },
    { key: 'candidateMoves', label: '8. Candidate Engine Moves', epistemic: 'Candidate Line' },
    { key: 'pvArrows', label: '9. Principal-Variation Arrow', epistemic: 'Candidate Line' },
    { key: 'predictedReplies', label: '10. Predicted Opponent Reply', epistemic: 'Prediction' },
    { key: 'preMoveWarnings', label: '11. Pre-Move / Last-Move Tactical Warning', epistemic: 'Candidate Line' }
  ];

  // Build SVG polyline points for the Evaluation Graph
  const evalGraphPoints = useMemo(() => {
    const series = reviewSummary.evalSeries;
    if (series.length <= 1) return '';
    const width = 560;
    const height = 110;
    return series
      .map((pt, idx) => {
        const x = (idx / Math.max(1, series.length - 1)) * width;
        const cp = pt.whiteCp !== null ? Math.max(-800, Math.min(800, pt.whiteCp)) : 0;
        const y = height / 2 - (cp / 800) * (height / 2 - 10);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [reviewSummary.evalSeries]);

  return (
    <section className="xray-panel" aria-label="11-Layer X-Ray tactical analysis, evaluation graph, and game review">
      <div className="analysis-top-layout">
        {/* Left: Interactive 2D Board & Replay Bar */}
        <div className="panel-section analysis-board-card">
          <div className="section-header">
            <span>Interactive 2D Analysis Board</span>
            <span>
              Ply {snapshot.displayedPly} / {snapshot.moveCount} · Depth {analysis?.analysisDepth ?? 0}
            </span>
          </div>
          <CathedralBoard compact />
          <div className="replay-nav-bar" style={{ marginTop: '0.6rem' }}>
            <div className="replay-step-group">
              <button type="button" className="icon-btn" onClick={stepFirst} disabled={snapshot.displayedPly === 0}>
                ⏮ First
              </button>
              <button type="button" className="icon-btn" onClick={stepPrev} disabled={snapshot.displayedPly === 0}>
                ◀ Prev
              </button>
              <button type="button" className="icon-btn" onClick={toggleAutoReplay} disabled={snapshot.moveCount === 0}>
                {autoReplay ? '⏸ Pause' : '▶ Auto'}
              </button>
              <button type="button" className="icon-btn" onClick={stepNext} disabled={!snapshot.isViewingHistory}>
                Next ▶
              </button>
              <button type="button" className="icon-btn" onClick={stepLast} disabled={!snapshot.isViewingHistory}>
                Last ⏭
              </button>
            </div>
          </div>

          {/* Load any FEN position for tactical inspection */}
          <div className="control-row" style={{ marginTop: '0.6rem' }}>
            <input
              className="san-input"
              value={customFenInput}
              placeholder="Paste FEN to inspect pins, forks, skewers, or endgames…"
              onChange={e => setCustomFenInput(e.target.value)}
              aria-label="Inspect FEN position"
            />
            <button type="button" className="icon-btn" onClick={handleLoadFen}>
              Inspect FEN
            </button>
          </div>
          {fenStatus && <p className="text-muted">{fenStatus}</p>}
        </div>

        {/* Right: 11-Layer Controls & Epistemic Key */}
        <div className="panel-section">
          <div className="section-header">
            <span>11-Layer X-Ray Overlay Controls</span>
            <span>
              {analysis?.isShallowUncertainty
                ? 'Uncertainty: Shallow Depth (<3)'
                : `Verified at Depth ${analysis?.analysisDepth}`}
            </span>
          </div>

          <div className="layer-toggles-grid">
            {layerControls.map(layer => (
              <label key={layer.key} className="xray-toggle-row">
                <input
                  type="checkbox"
                  checked={Boolean(xrayLayers[layer.key])}
                  disabled={layer.key !== 'enabled' && !xrayLayers.enabled}
                  onChange={e => setXrayLayer({ [layer.key]: e.target.checked })}
                />
                <span className="xray-toggle-label">{layer.label}</span>
                <span className="epistemic-pill">{layer.epistemic}</span>
              </label>
            ))}
          </div>

          <div className="control-row" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="icon-btn"
              onClick={() =>
                setXrayLayer({
                  enabled: true,
                  attackedSquares: true,
                  defendedPieces: true,
                  hangingPieces: true,
                  pinsAndDiscovered: true,
                  forksAndSkewers: true,
                  overloadedDefenders: true,
                  kingThreats: true,
                  candidateMoves: true,
                  pvArrows: true,
                  predictedReplies: true
                })
              }
            >
              Enable All 11 Layers
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() =>
                setXrayLayer({
                  candidateMoves: false,
                  pvArrows: false,
                  predictedReplies: false,
                  prediction: false
                })
              }
            >
              Clear Arrows Only
            </button>
          </div>

          <p className="honest-disclaimer">
            <strong>Epistemic Distinction:</strong> <em>Current Fact</em> layers report verified legal rules and static
            board attacks. <em>Candidate Line</em> and <em>Prediction</em> layers reflect engine search at the reported
            depth—never guaranteed outcomes.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------- Game Review & Evaluation Graph */}
      <div className="panel-section">
        <div className="section-header">
          <span>Post-Game Review &amp; Evaluation Timeline</span>
          <span>Click any ply to jump</span>
        </div>

        <div className="eval-graph-container">
          <svg viewBox="0 0 560 110" className="eval-graph-svg" role="img" aria-label="Move evaluation graph">
            <line x1="0" y1="55" x2="560" y2="55" stroke="rgba(148, 163, 184, 0.35)" strokeDasharray="4 4" />
            {evalGraphPoints && (
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
                points={evalGraphPoints}
              />
            )}
            {reviewSummary.evalSeries.map((pt, idx) => {
              const x = (idx / Math.max(1, reviewSummary.evalSeries.length - 1)) * 560;
              const cp = pt.whiteCp !== null ? Math.max(-800, Math.min(800, pt.whiteCp)) : 0;
              const y = 55 - (cp / 800) * 45;
              const isCurrent = idx === snapshot.displayedPly;
              return (
                <circle
                  key={pt.ply}
                  cx={x}
                  cy={y}
                  r={isCurrent ? 5 : 3}
                  fill={pt.classification?.color || '#38bdf8'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => goToPly(pt.ply)}
                >
                  <title>
                    Ply {pt.ply} ({pt.san}): {pt.whiteCp !== null ? `${(pt.whiteCp / 100).toFixed(2)}` : 'Unanalysed'}
                  </title>
                </circle>
              );
            })}
          </svg>
        </div>

        <div className="review-summary-grid">
          {(['w', 'b'] as const).map(side => {
            const s = reviewSummary[side];
            return (
              <div key={side} className="review-side-card">
                <div className="section-header">
                  <strong>{side === 'w' ? '♔ White Review' : '♚ Black Review'}</strong>
                  <span>
                    {s.accuracy !== null ? `Est. Accuracy: ${s.accuracy}% (${s.acpl} ACPL)` : 'Awaiting Search Data'}
                  </span>
                </div>
                <div className="classification-counts">
                  <span>★ Best: {s.best}</span>
                  <span>! Excellent: {s.excellent}</span>
                  <span>✓ Good: {s.good}</span>
                  <span>?! Inaccuracy: {s.inaccuracy}</span>
                  <span>? Mistake: {s.mistake}</span>
                  <span>?? Blunder: {s.blunder}</span>
                  <span>… Unverified: {s.uncertain}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* --------------------------------------------------- Tactical Findings Grid */}
      <div className="xray-grid">
        <div className="panel-section">
          <div className="section-header">
            <span>Layers 4 &amp; 5: Pins, Forks, Skewers &amp; Batteries</span>
            <span>{analysis?.motifs.length ?? 0} verified</span>
          </div>
          {!analysis || analysis.motifs.length === 0 ? (
            <p className="text-muted">No pins, forks, skewers or discovered batteries in this position.</p>
          ) : (
            <ul className="motif-list">
              {analysis.motifs.slice(0, 12).map((motif, i) => (
                <li key={`${motif.type}-${motif.square}-${i}`}>
                  <span className="motif-type" data-color={motif.color}>
                    {motif.type}
                  </span>
                  <span className="motif-text">{motif.description}</span>
                  <span className="motif-confidence">{motif.confidence}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Layers 3 &amp; 6: Hanging &amp; Overloaded Pieces</span>
            <span>{analysis?.vulnerablePieces.length ?? 0} flagged</span>
          </div>
          {!analysis || analysis.vulnerablePieces.length === 0 ? (
            <p className="text-muted">No piece is currently hanging, losing on SEE, or overloaded.</p>
          ) : (
            <ul className="vulnerable-list">
              {analysis.vulnerablePieces.slice(0, 10).map((piece, idx) => (
                <li key={`${piece.square}-${idx}`} data-severity={piece.severity}>
                  <span className="vuln-square">{piece.square}</span>
                  <span className="vuln-text">{piece.description || piece.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Layer 7: King Threats &amp; Candidate Checks</span>
            <span>
              {analysis?.kingSafety.whiteInCheck || analysis?.kingSafety.blackInCheck ? 'ACTIVE CHECK' : 'Stable'}
            </span>
          </div>
          <ul className="king-safety-list">
            <li>
              White King ({analysis?.kingSafety.whiteKingSquare ?? '—'}):{' '}
              {analysis?.kingSafety.whiteInCheck ? 'IN CHECK' : 'Safe from immediate check'}
            </li>
            <li>
              Black King ({analysis?.kingSafety.blackKingSquare ?? '—'}):{' '}
              {analysis?.kingSafety.blackInCheck ? 'IN CHECK' : 'Safe from immediate check'}
            </li>
            {analysis?.kingSafety.candidateChecks.map((check, i) => (
              <li key={`${check.san}-${i}`}>{check.description}</li>
            ))}
          </ul>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Layer 11: On-Demand Blunder &amp; Refutation Check</span>
            <span>3-Ply Verification</span>
          </div>
          <button
            type="button"
            className="nav-btn primary"
            onClick={runBlunderCheck}
            disabled={checking || (!lastHumanMove && !snapshot.lastMove)}
          >
            {checking ? 'Analysing Move…' : 'Verify Last Move for Tactical Refutations'}
          </button>
          {(lastHumanMove || snapshot.lastMove) && (
            <p className="text-muted">
              Target move: <strong>{(lastHumanMove ?? snapshot.lastMove)?.san}</strong>
            </p>
          )}
          {warning && (
            <div className="warning-card" data-severity={warning.severity}>
              <strong>{warning.title}</strong>
              <p>{warning.message}</p>
              <p className="text-muted">
                Refutation line: {warning.refutationLine.join(' ')}
                {warning.recommendedMove ? ` · Recommended alternative: ${warning.recommendedMove}` : ''}
              </p>
            </div>
          )}
          {warningError && <p className="text-muted">{warningError}</p>}
        </div>
      </div>

      {/* --------------------------------------------------- Dual-Engine Static Evaluation Comparator */}
      <div className="panel-section">
        <div className="section-header">
          <span>Dual-Engine Static Evaluation Comparator</span>
          <span>Handcrafted Baseline vs Trained Lab Champion</span>
        </div>
        {championEval ? (
          <div className="comparator-grid">
            <div className="metric-box">
              <span className="metric-label">Handcrafted Baseline</span>
              <span className="metric-value">{(championEval.handcrafted / 100).toFixed(2)}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Trained Champion Weights</span>
              <span className="metric-value">{(championEval.learned / 100).toFixed(2)}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Weight Divergence</span>
              <span className="metric-value">
                {((championEval.learned - championEval.handcrafted) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted">Run a generation in the Training Lab to compare evolved weights.</p>
        )}
      </div>
    </section>
  );
}