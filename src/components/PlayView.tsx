'use client';

/**
 * Play View (`PlayView.tsx`)
 *
 * Combines the 2D chessboard, capture trays, chess clocks, evaluation bar,
 * 5-tier progressive hints, quick X-Ray overlay toggles, move-by-move replay controls,
 * navigable move list, and keyboard/SAN move entry.
 */

import React, { useEffect, useMemo, useState } from 'react';

import { CathedralBoard } from './CathedralBoard';
import { useSession, type BoardTheme, type MoveMeta } from '../context/CathedralSession';
import { allLegalMoves, CLOCK_PRESETS, type VerboseMove } from '../lib/cathedral';
import { BOARD_THEME_OPTIONS, DIFFICULTY_OPTIONS } from '../lib/options';

function evalLabel(cp: number | null): string {
  if (cp === null || cp === undefined) return '0.00';
  if (Math.abs(cp) >= 28000) return cp > 0 ? '+M' : '-M';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function evalBarWhitePercent(cp: number | null): number {
  if (cp === null || cp === undefined) return 50;
  if (cp >= 28000) return 98;
  if (cp <= -28000) return 2;
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return Math.round(50 + (clamped / 1000) * 46);
}

export function PlayView() {
  const session = useSession();
  const {
    snapshot,
    displayedGame,
    moveMeta,
    opening,
    terminal,
    mode,
    setMode,
    humanColor,
    setHumanColor,
    settings,
    updateSettings,
    clockLabel,
    engineThinking,
    engineProgress,
    engineResult,
    engineError,
    bestLine,
    bestLineEval,
    hintTier,
    setHintTier,
    progressiveHints,
    requestHint,
    clearHint,
    undoMove,
    redoMove,
    newGame,
    resign,
    goToPly,
    stepFirst,
    stepPrev,
    stepNext,
    stepLast,
    autoReplay,
    toggleAutoReplay,
    xrayLayers,
    setXrayLayer,
    transport,
    playerRating
  } = session;

  const [sanEntry, setSanEntry] = useState('');
  const [legalMoves, setLegalMoves] = useState<VerboseMove[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    const humansTurn = mode === 'two-player' || displayedGame.turn() === humanColor;
    if (!humansTurn || displayedGame.isGameOver() || terminal || snapshot.isViewingHistory) {
      setLegalMoves([]);
      return;
    }
    setLegalMoves(allLegalMoves(displayedGame));
  }, [displayedGame, humanColor, mode, snapshot.fen, snapshot.isViewingHistory, terminal]);

  const submitSan = () => {
    if (session.playSan(sanEntry)) setSanEntry('');
  };

  const handleSave = () => {
    session.saveCurrentGame();
    setSaveNotice('Game saved to local library.');
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const movePairs = useMemo(() => {
    const pairs: {
      number: number;
      whitePly: number;
      blackPly: number;
      white: string;
      black: string;
      meta: [MoveMeta | undefined, MoveMeta | undefined];
    }[] = [];
    for (let i = 0; i < snapshot.sanHistory.length; i += 2) {
      pairs.push({
        number: i / 2 + 1,
        whitePly: i + 1,
        blackPly: i + 2,
        white: snapshot.sanHistory[i],
        black: snapshot.sanHistory[i + 1] ?? '',
        meta: [moveMeta[i], moveMeta[i + 1]]
      });
    }
    return pairs;
  }, [snapshot.sanHistory, moveMeta]);

  const currentEvalCp = engineProgress?.scoreWhiteCp ?? engineResult?.scoreWhiteCp ?? bestLineEval ?? 0;
  const whitePct = evalBarWhitePercent(currentEvalCp);
  const currentPreset = DIFFICULTY_OPTIONS.find(o => o.id === settings.difficulty);

  return (
    <section className="play-view" aria-label="Live chess match — 2D board, clocks, hints, and move history">
      <div className="play-layout">
        {/* ------------------------------------------------------- Left / Center: 2D Board Stage */}
        <div className="play-board-column">
          <div className="panel-section board-panel">
            <div className="section-header">
              <span>
                {opening ? `${opening.eco} · ${opening.name}` : 'Wizard’s Chess Board'}
                {snapshot.isViewingHistory && (
                  <span className="badge-history">
                    Viewing Ply {snapshot.displayedPly}/{snapshot.moveCount}
                  </span>
                )}
              </span>
              <span>
                {mode === 'engine'
                  ? `You (${humanColor === 'w' ? 'White' : 'Black'}) vs ${currentPreset?.shortLabel ?? settings.difficulty}`
                  : 'Local Two-Player'}
              </span>
            </div>

            {/* Clocks & Turn Status Banner */}
            <div className="board-hud">
              <div className="clock-chip" data-active={snapshot.turn === 'w' && !terminal}>
                <span className="clock-side">♔ White</span>
                <span className="clock-value">{clockLabel('w')}</span>
              </div>
              <div className="turn-indicator" aria-live="polite" data-check={snapshot.inCheck || undefined}>
                {terminal
                  ? terminal.label
                  : snapshot.isViewingHistory
                  ? `History Replay (Ply ${snapshot.displayedPly} of ${snapshot.moveCount})`
                  : snapshot.inCheck
                  ? `⚠ ${snapshot.turn === 'w' ? 'White' : 'Black'} is in CHECK`
                  : `${snapshot.turn === 'w' ? 'White' : 'Black'} to move`}
              </div>
              <div className="clock-chip" data-active={snapshot.turn === 'b' && !terminal}>
                <span className="clock-side">♚ Black</span>
                <span className="clock-value">{clockLabel('b')}</span>
              </div>
            </div>

            {/* Visual Evaluation Bar + 2D Board */}
            <div className="board-with-eval-bar">
              <div className="eval-bar-vertical" title={`Evaluation (White perspective): ${evalLabel(currentEvalCp)}`}>
                <div className="eval-bar-black" style={{ height: `${100 - whitePct}%` }} />
                <div className="eval-bar-white" style={{ height: `${whitePct}%` }} />
                <span className="eval-bar-score">{evalLabel(currentEvalCp)}</span>
              </div>
              <div className="board-main-stage">
                <CathedralBoard />
              </div>
            </div>

            {/* Replay & Primary Action Bar */}
            <div className="replay-nav-bar" aria-label="Move replay and match controls">
              <div className="replay-step-group">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={stepFirst}
                  disabled={snapshot.displayedPly === 0}
                  title="First position"
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={stepPrev}
                  disabled={snapshot.displayedPly === 0}
                  title="Previous move"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={toggleAutoReplay}
                  disabled={snapshot.moveCount === 0}
                  title="Auto-play moves"
                >
                  {autoReplay ? '⏸ Pause' : '▶ Replay'}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={stepNext}
                  disabled={!snapshot.isViewingHistory}
                  title="Next move"
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={stepLast}
                  disabled={!snapshot.isViewingHistory}
                  title="Return to live position"
                >
                  ⏭ Live
                </button>
              </div>

              <div className="match-action-group">
                <button type="button" className="nav-btn primary" onClick={() => newGame()}>
                  New Game
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={undoMove}
                  disabled={snapshot.moveCount === 0}
                  title="Undo move"
                >
                  ↶ Undo
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={redoMove}
                  disabled={!snapshot.canRedo}
                  title="Redo move"
                >
                  ↷ Redo
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={requestHint}
                  disabled={Boolean(terminal)}
                  title="Progressive 5-tier hint"
                >
                  💡 Hint {hintTier > 0 ? `(${hintTier}/5)` : ''}
                </button>
                <button type="button" className="icon-btn" onClick={handleSave}>
                  ⛁ Save
                </button>
                <button type="button" className="icon-btn danger" onClick={resign} disabled={!session.resignable}>
                  ⚑ Resign
                </button>
              </div>
            </div>

            {saveNotice && (
              <p className="save-toast" role="status">
                {saveNotice}
              </p>
            )}

            {/* Progressive 5-Tier Hint Drawer */}
            {hintTier > 0 && progressiveHints.available && (
              <div className="progressive-hint-card" role="region" aria-label="Progressive hint assistant">
                <div className="hint-card-header">
                  <strong>Progressive Hint Assistant (Tier {hintTier} of 5)</strong>
                  <div className="hint-tier-pills">
                    {([1, 2, 3, 4, 5] as const).map(lvl => (
                      <button
                        key={lvl}
                        type="button"
                        className={`tier-pill ${hintTier >= lvl ? 'active' : ''}`}
                        onClick={() => setHintTier(lvl)}
                      >
                        T{lvl}
                      </button>
                    ))}
                    <button type="button" className="icon-btn" onClick={clearHint}>
                      ✕ Close
                    </button>
                  </div>
                </div>
                <ul className="hint-tier-list">
                  {progressiveHints.tiers
                    .filter(t => t.level <= hintTier)
                    .map(t => (
                      <li key={t.level} className="hint-tier-item">
                        <span className="hint-tier-badge">{t.title}</span>
                        <span className="hint-tier-text">{t.text}</span>
                      </li>
                    ))}
                </ul>
                {hintTier < 5 && (
                  <button type="button" className="icon-btn" onClick={requestHint}>
                    Reveal Next Hint Level ({hintTier + 1}/5) →
                  </button>
                )}
              </div>
            )}

            {terminal && (
              <div className="terminal-banner" role="status">
                <div>
                  <strong>{terminal.label}</strong>
                  <span className="text-muted" style={{ display: 'block', fontSize: '0.82rem' }}>
                    Local Estimated Rating: {playerRating.rating} (±{playerRating.rd})
                  </span>
                </div>
                <button type="button" className="nav-btn primary" onClick={() => newGame()}>
                  Play Again
                </button>
              </div>
            )}
          </div>

          {/* Match Setup & Board Theme Strip */}
          <div className="panel-section">
            <div className="section-header">
              <span>Match &amp; Board Setup</span>
              <span>
                {transport === 'worker' ? 'Web Worker Active' : 'Main Thread Fallback'}
              </span>
            </div>
            <div className="control-grid-4">
              <label className="field">
                <span>Mode</span>
                <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                  <option value="engine">Play vs Engine</option>
                  <option value="two-player">Local Two-Player</option>
                </select>
              </label>

              <label className="field">
                <span>Your Side</span>
                <select
                  value={humanColor}
                  disabled={mode === 'two-player'}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === 'random') {
                      newGame({ color: 'random' });
                    } else {
                      setHumanColor(val as 'w' | 'b');
                    }
                  }}
                >
                  <option value="w">White</option>
                  <option value="b">Black</option>
                  <option value="random">Random Side</option>
                </select>
              </label>

              <label className="field">
                <span>Difficulty (12 Tiers)</span>
                <select
                  value={settings.difficulty}
                  onChange={e => updateSettings({ difficulty: e.target.value })}
                >
                  {DIFFICULTY_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Board Theme</span>
                <select
                  value={settings.boardTheme}
                  onChange={e => updateSettings({ boardTheme: e.target.value as BoardTheme })}
                >
                  {BOARD_THEME_OPTIONS.map(theme => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Time Control</span>
                <select
                  value={settings.timeControl}
                  onChange={e => updateSettings({ timeControl: e.target.value })}
                >
                  {Object.values(CLOCK_PRESETS).map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Quick X-Ray Board Overlay Toggles */}
            <div className="quick-xray-strip">
              <span className="quick-xray-title">2D X-Ray Overlays:</span>
              <label className="chip-toggle">
                <input
                  type="checkbox"
                  checked={xrayLayers.enabled}
                  onChange={e => setXrayLayer({ enabled: e.target.checked })}
                />
                <span>Master X-Ray</span>
              </label>
              <label className="chip-toggle">
                <input
                  type="checkbox"
                  checked={xrayLayers.attackedSquares}
                  disabled={!xrayLayers.enabled}
                  onChange={e => setXrayLayer({ attackedSquares: e.target.checked, attackMap: e.target.checked })}
                />
                <span>Attack Counts</span>
              </label>
              <label className="chip-toggle">
                <input
                  type="checkbox"
                  checked={xrayLayers.hangingPieces}
                  disabled={!xrayLayers.enabled}
                  onChange={e => setXrayLayer({ hangingPieces: e.target.checked, vulnerable: e.target.checked })}
                />
                <span>Hanging Pieces</span>
              </label>
              <label className="chip-toggle">
                <input
                  type="checkbox"
                  checked={xrayLayers.pinsAndDiscovered}
                  disabled={!xrayLayers.enabled}
                  onChange={e => setXrayLayer({ pinsAndDiscovered: e.target.checked, motifs: e.target.checked })}
                />
                <span>Pins &amp; Batteries</span>
              </label>
              <label className="chip-toggle">
                <input
                  type="checkbox"
                  checked={xrayLayers.forksAndSkewers}
                  disabled={!xrayLayers.enabled}
                  onChange={e => setXrayLayer({ forksAndSkewers: e.target.checked })}
                />
                <span>Forks &amp; Skewers</span>
              </label>
              <label className="chip-toggle">
                <input
                  type="checkbox"
                  checked={xrayLayers.pvArrows}
                  disabled={!xrayLayers.enabled}
                  onChange={e => setXrayLayer({ pvArrows: e.target.checked, prediction: e.target.checked })}
                />
                <span>PV Arrows</span>
              </label>
            </div>
          </div>
        </div>

        {/* -------------------------------------------------------- Right Side Rail */}
        <div className="play-rail">
          {/* Engine Telemetry Card */}
          <div className="panel-section">
            <div className="section-header">
              <span>{currentPreset?.shortLabel ?? settings.difficulty}</span>
              <span>
                {engineThinking
                  ? 'Searching…'
                  : engineResult?.bookMove
                  ? 'Opening Book'
                  : `Depth ${engineResult?.depth ?? 0}`}
              </span>
            </div>

            <div className="eval-readout">
              <div>
                <span className="eval-label">Eval (White)</span>
                <div className="eval-sub">
                  Est. Opponent Rating: ~{currentPreset?.estimatedRating ?? 1400} (±{currentPreset?.ratingUncertainty ?? 60})
                </div>
              </div>
              <span className="eval-value">{evalLabel(currentEvalCp)}</span>
            </div>

            {(engineProgress || engineResult) && (
              <p className="text-muted telemetry-line">
                Depth {engineProgress?.depth ?? engineResult?.depth ?? 0} ·{' '}
                {(engineProgress?.nodes ?? engineResult?.nodes ?? 0).toLocaleString()} nodes ·{' '}
                {(engineProgress?.nps ?? engineResult?.nps ?? 0).toLocaleString()} nps
              </p>
            )}

            {engineError && <p className="engine-error">{engineError}</p>}

            {settings.showMoveHints && bestLine.length > 0 && (
              <div className="pv-line">
                <span className="text-muted">Principal Variation (Candidate Line)</span>
                <span className="pv-moves">{bestLine.join(' ')}</span>
              </div>
            )}
          </div>

          {/* Navigable Move History */}
          <div className="panel-section">
            <div className="section-header">
              <span>Move History (Click to Replay)</span>
              <span>{snapshot.moveCount} ply</span>
            </div>

            {movePairs.length === 0 ? (
              <p className="text-muted">No moves yet. Click or drag a piece on the 2D board to begin.</p>
            ) : (
              <ol className="move-list">
                {movePairs.map(pair => {
                  const wActive = snapshot.displayedPly === pair.whitePly;
                  const bActive = snapshot.displayedPly === pair.blackPly;
                  return (
                    <li key={pair.number} className="move-row">
                      <span className="move-number">{pair.number}.</span>
                      <button
                        type="button"
                        className={`move-cell-btn ${wActive ? 'active-ply' : ''}`}
                        onClick={() => goToPly(pair.whitePly)}
                      >
                        <span>{pair.white}</span>
                        {pair.meta[0]?.classification && (
                          <em className="move-badge" style={{ color: pair.meta[0].classification.color }}>
                            {pair.meta[0].classification.badge}
                          </em>
                        )}
                      </button>
                      {pair.black ? (
                        <button
                          type="button"
                          className={`move-cell-btn ${bActive ? 'active-ply' : ''}`}
                          onClick={() => goToPly(pair.blackPly)}
                        >
                          <span>{pair.black}</span>
                          {pair.meta[1]?.classification && (
                            <em className="move-badge" style={{ color: pair.meta[1].classification.color }}>
                              {pair.meta[1].classification.badge}
                            </em>
                          )}
                        </button>
                      ) : (
                        <span className="move-cell-empty" />
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Keyboard SAN Entry & Legal Move Picker */}
          <div className="panel-section">
            <div className="section-header">
              <span>SAN / Keyboard Move Input</span>
              <span>{legalMoves.length} legal moves</span>
            </div>
            <div className="control-row">
              <input
                className="san-input"
                value={sanEntry}
                placeholder="e4, Nf3, O-O, e8=Q…"
                onChange={e => setSanEntry(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitSan();
                }}
                disabled={(mode === 'engine' && snapshot.turn !== humanColor) || snapshot.isViewingHistory}
                aria-label="Enter a move in SAN or LAN"
              />
              <button type="button" className="icon-btn" onClick={submitSan} disabled={!sanEntry.trim()}>
                Play
              </button>
            </div>

            {legalMoves.length > 0 && (
              <details className="legal-move-details">
                <summary>All Legal Moves ({legalMoves.length})</summary>
                <div className="legal-move-grid">
                  {legalMoves.map(move => (
                    <button
                      key={move.lan}
                      type="button"
                      className="icon-btn"
                      onClick={() => session.playMove(move)}
                    >
                      {move.san}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}