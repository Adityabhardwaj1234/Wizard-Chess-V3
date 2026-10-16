'use client';

/**
 * Home Dashboard (`HomeDashboard.tsx`)
 *
 * Coherent product home screen featuring:
 * - Play Now & Continue Game (when an unfinished match is active).
 * - Quick Game Setup (colour, 12-tier difficulty ladder, time control, board theme, opening book).
 * - Honest Local Player Rating card with W/D/L breakdown and explicit calibration disclaimer.
 * - Recent games with one-click resume/replay.
 * - Concise onboarding guide covering the 12 engine tiers, hints, X-Ray, and Training Lab.
 */

import React, { useEffect, useMemo, useState } from 'react';

import { useSession, type BoardTheme, type PlayerColor, type PrimaryView } from '../context/CathedralSession';
import { CLOCK_PRESETS } from '../lib/cathedral';
import { BOARD_THEME_OPTIONS, DIFFICULTY_OPTIONS } from '../lib/options';
import { loadLearningState } from '../learning/learningEngine';

interface LearningSummary {
  generation: number;
  championVersion: string;
  gamesSimulated: number;
}

export function HomeDashboard({ onNavigate }: { onNavigate: (view: PrimaryView) => void }) {
  const {
    snapshot,
    settings,
    updateSettings,
    archive,
    terminal,
    mounted,
    newGame,
    openArchivedGame,
    playerRating
  } = useSession();

  const [learning, setLearning] = useState<LearningSummary | null>(null);
  const [setupColor, setSetupColor] = useState<'w' | 'b' | 'random'>('w');
  const [setupDifficulty, setSetupDifficulty] = useState<string>(settings.difficulty || 'ClubPlayer');
  const [setupTimeControl, setSetupTimeControl] = useState<string>(settings.timeControl || 'untimed');
  const [setupTheme, setSetupTheme] = useState<BoardTheme>(settings.boardTheme || 'classic-green');

  useEffect(() => {
    setSetupDifficulty(settings.difficulty);
    setSetupTimeControl(settings.timeControl);
    setSetupTheme(settings.boardTheme);
  }, [settings.boardTheme, settings.difficulty, settings.timeControl]);

  useEffect(() => {
    if (!mounted) return;
    try {
      const state = loadLearningState() as {
        generation: number;
        currentVersion: string;
        totalGamesSimulated: number;
      };
      setLearning({
        generation: state.generation,
        championVersion: state.currentVersion,
        gamesSimulated: state.totalGamesSimulated
      });
    } catch (_err) {
      setLearning(null);
    }
  }, [mounted, archive.length]);

  const hasUnfinishedGame = snapshot.moveCount > 0 && !terminal;
  const selectedPreset = useMemo(
    () => DIFFICULTY_OPTIONS.find(d => d.id === setupDifficulty) ?? DIFFICULTY_OPTIONS[4],
    [setupDifficulty]
  );

  const handleQuickStart = (overrideMode?: 'engine' | 'two-player', overrideDiff?: string) => {
    const diff = overrideDiff ?? setupDifficulty;
    updateSettings({
      difficulty: diff,
      timeControl: setupTimeControl,
      boardTheme: setupTheme
    });
    newGame({
      mode: overrideMode ?? 'engine',
      color: setupColor as PlayerColor | 'random',
      difficulty: diff
    });
    onNavigate('play');
  };

  return (
    <section className="home-dashboard" aria-label="Wizard's Chess home dashboard and match launcher">
      <div className="dashboard-grid">
        {/* ------------------------------------------------- Hero Launch & Continue */}
        <div className="panel-section hero-card">
          <div className="section-header">
            <span>Wizard’s Chess · Production Edition</span>
            {hasUnfinishedGame ? (
              <span className="badge-gold">Active Match ({snapshot.moveCount} ply)</span>
            ) : (
              <span>Ready to Play</span>
            )}
          </div>
          <h1 className="hero-title">Precision 2D Chess, Tactical X-Ray &amp; Self-Play Evolution</h1>
          <p className="text-muted">
            {hasUnfinishedGame
              ? `Match in progress: ${snapshot.moveCount} ply played · ${
                  snapshot.turn === 'w' ? 'White' : 'Black'
                } to move.`
              : 'Play against 12 calibrated engine tiers, inspect real-time pins and forks with 11-layer X-Ray, or evolve evaluation weights in the headless Training Lab.'}
          </p>
          <div className="control-row">
            {hasUnfinishedGame && (
              <button type="button" className="nav-btn primary" onClick={() => onNavigate('play')}>
                ▶ Continue Active Game ({snapshot.moveCount} ply)
              </button>
            )}
            <button
              type="button"
              className={hasUnfinishedGame ? 'icon-btn' : 'nav-btn primary'}
              onClick={() => handleQuickStart('engine')}
            >
              ⚔ Play Now vs {selectedPreset?.shortLabel ?? setupDifficulty}
            </button>
            <button type="button" className="icon-btn" onClick={() => handleQuickStart('two-player')}>
              👥 Pass &amp; Play (2P)
            </button>
          </div>
        </div>

        {/* ------------------------------------------------- Local Player Rating & Telemetry */}
        <div className="panel-section">
          <div className="section-header">
            <span>Personal Performance &amp; Rating</span>
            <span className="badge-subtle">Local Estimated Rating</span>
          </div>
          <div className="telemetry-grid">
            <div className="metric-box">
              <span className="metric-label">Est. Local Rating</span>
              <span className="metric-value">
                {playerRating.rating} <small className="text-muted">±{playerRating.rd}</small>
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Peak Rating</span>
              <span className="metric-value">{playerRating.peakRating}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Record (W/D/L)</span>
              <span className="metric-value">
                {playerRating.wins} / {playerRating.draws} / {playerRating.losses}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Saved Games</span>
              <span className="metric-value">{archive.length}</span>
            </div>
          </div>
          <p className="honest-disclaimer">{playerRating.disclaimer}</p>
        </div>

        {/* ------------------------------------------------- New Game Configurator */}
        <div className="panel-section">
          <div className="section-header">
            <span>Configure New Match</span>
            <span>12 Calibrated Levels + Experimental</span>
          </div>
          <div className="control-grid-2">
            <label className="field">
              <span>Your Colour</span>
              <select value={setupColor} onChange={e => setSetupColor(e.target.value as 'w' | 'b' | 'random')}>
                <option value="w">White</option>
                <option value="b">Black</option>
                <option value="random">Random Colour</option>
              </select>
            </label>

            <label className="field">
              <span>Engine Tier</span>
              <select value={setupDifficulty} onChange={e => setSetupDifficulty(e.target.value)}>
                {DIFFICULTY_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Time Control</span>
              <select value={setupTimeControl} onChange={e => setSetupTimeControl(e.target.value)}>
                {Object.values(CLOCK_PRESETS).map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Board Theme</span>
              <select value={setupTheme} onChange={e => setSetupTheme(e.target.value as BoardTheme)}>
                {BOARD_THEME_OPTIONS.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedPreset && (
            <p className="field-hint">
              <strong>{selectedPreset.shortLabel}</strong> (~{selectedPreset.estimatedRating}±
              {selectedPreset.ratingUncertainty} Est. Local, Depth {selectedPreset.maxDepth},{' '}
              {selectedPreset.nodeLimit.toLocaleString()} max nodes): {selectedPreset.description}
            </p>
          )}

          <div className="control-row">
            <button type="button" className="nav-btn primary" onClick={() => handleQuickStart('engine')}>
              Start Configured Match
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => handleQuickStart('engine', 'CathedralApex')}
            >
              ⚡ Challenge Cathedral Apex (Tier 12)
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => handleQuickStart('engine', 'Experimental')}
            >
              ⚛ Play Trained Lab Champion
            </button>
          </div>
        </div>

        {/* ------------------------------------------------- Recent Games & Quick Access */}
        <div className="panel-section">
          <div className="section-header">
            <span>Recent Games &amp; Research Modules</span>
            <span>{learning ? `Lab Gen ${learning.generation}` : 'Local Storage'}</span>
          </div>

          {archive.length === 0 ? (
            <p className="text-muted">
              No saved games yet. Completed matches are automatically saved to your local browser library.
            </p>
          ) : (
            <ul className="recent-games-list">
              {archive.slice(0, 3).map(g => (
                <li key={g.id} className="recent-game-row">
                  <div>
                    <strong>{g.title}</strong>
                    <span className="text-muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                      {g.result} · {g.openingName || 'Standard Opening'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => {
                      openArchivedGame(g);
                      onNavigate('play');
                    }}
                  >
                    Open / Replay
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="launch-grid" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="icon-btn" onClick={() => onNavigate('analysis')}>
              ◈ Analysis, X-Ray &amp; Review
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('training')}>
              ⚛ Headless Training Lab ({learning?.gamesSimulated ?? 0} games)
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('library')}>
              ☰ Game Library &amp; PGN Share
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('settings')}>
              ⚙ Themes, Audio &amp; Accessibility
            </button>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- Concise Onboarding Strip */}
      <div className="panel-section onboarding-strip">
        <div className="section-header">
          <span>Platform Guide &amp; Capabilities</span>
          <span>100% Local &amp; Offline-Capable</span>
        </div>
        <div className="onboarding-grid">
          <div>
            <strong>1. 12-Tier Calibrated Engine</strong>
            <p className="text-muted">
              From forgiving 1-ply <em>First Steps</em> (~650) to 10-ply <em>Cathedral Apex</em> (~2300) running in a
              dedicated Web Worker.
            </p>
          </div>
          <div>
            <strong>2. 5-Tier Hints &amp; 11-Layer X-Ray</strong>
            <p className="text-muted">
              Step from strategic goals to exact candidate moves, or toggle attack maps, pins, forks, skewers, and PV
              arrows directly on the 2D board.
            </p>
          </div>
          <div>
            <strong>3. Experimental Self-Play Lab</strong>
            <p className="text-muted">
              Optimise the 24-weight evaluation vector across parallel headless workers with mandatory tactical
              regression gating.
            </p>
          </div>
          <div>
            <strong>4. Local IndexedDB &amp; Serverless Share</strong>
            <p className="text-muted">
              Games auto-save locally with PGN/FEN import/export and self-contained URL-fragment sharing (`#cathedral=…`).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}