'use client';

/**
 * Settings View (`SettingsView.tsx`)
 *
 * Configures:
 * - 2D Board Themes (Classic Green, Tournament Slate, Woodland, High Contrast).
 * - Interface Theme (Dark / Light), Color-Blind Friendly Indicators, and Reduced Motion.
 * - Sound Mixer (Master Volume 0–100%, Mute, and Move / Capture / Check / Game-Over categories).
 * - Default Engine Difficulty (12 calibrated tiers + Experimental), Search Time, and Opening Book toggle.
 * - Local Storage Diagnostics.
 */

import React from 'react';

import { useSession, type BoardTheme, type UiTheme } from '../context/CathedralSession';
import { CLOCK_PRESETS } from '../lib/cathedral';
import { BOARD_THEME_OPTIONS, DIFFICULTY_OPTIONS, SEARCH_TIME_OPTIONS } from '../lib/options';
import { playCue } from '../lib/sound';

export function SettingsView() {
  const { settings, updateSettings, transport, snapshot, mounted, playerRating } = useSession();

  return (
    <section className="settings-view" aria-label="Application settings — board themes, accessibility, audio, and engine">
      <div className="settings-grid">
        {/* ------------------------------------------------- 2D Board & Interface Themes */}
        <div className="panel-section">
          <div className="section-header">
            <span>2D Board &amp; Visual Identity</span>
            <span>Restrained &amp; Accessible</span>
          </div>

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
          <p className="field-hint">
            {BOARD_THEME_OPTIONS.find(t => t.id === settings.boardTheme)?.description}
          </p>

          <label className="field">
            <span>Interface Appearance</span>
            <select
              value={settings.uiTheme}
              onChange={e => updateSettings({ uiTheme: e.target.value as UiTheme })}
            >
              <option value="dark">Calm Dark Slate (Default)</option>
              <option value="light">Warm Daylight Parchment</option>
            </select>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.colorBlindMode}
              onChange={e => updateSettings({ colorBlindMode: e.target.checked })}
            />
            <span>Color-blind friendly indicators (shapes, symbols &amp; high-contrast borders)</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.showCoordinates}
              onChange={e => updateSettings({ showCoordinates: e.target.checked })}
            />
            <span>Show rank and file coordinates (a–h, 1–8)</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.showLegalMoves}
              onChange={e => updateSettings({ showLegalMoves: e.target.checked })}
            />
            <span>Show legal destination and capture markers</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.animationsEnabled}
              onChange={e => updateSettings({ animationsEnabled: e.target.checked })}
            />
            <span>Smooth 2D piece transitions</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={e => updateSettings({ reducedMotion: e.target.checked })}
            />
            <span>Reduced motion mode (suppresses animations)</span>
          </label>
        </div>

        {/* ------------------------------------------------- Sound Mixer */}
        <div className="panel-section">
          <div className="section-header">
            <span>Audio &amp; Sound Mixer</span>
            <span>WebAudio Synthesiser</span>
          </div>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={e => updateSettings({ soundEnabled: e.target.checked })}
            />
            <span>Master Audio Enabled</span>
          </label>

          <label className="field">
            <span>Master Volume — {settings.soundVolume ?? 75}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.soundVolume ?? 75}
              disabled={!settings.soundEnabled}
              onChange={e => updateSettings({ soundVolume: Number(e.target.value) })}
            />
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.soundMove ?? true}
              disabled={!settings.soundEnabled}
              onChange={e => updateSettings({ soundMove: e.target.checked })}
            />
            <span>Piece movement cues</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.soundCapture ?? true}
              disabled={!settings.soundEnabled}
              onChange={e => updateSettings({ soundCapture: e.target.checked })}
            />
            <span>Capture cues</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.soundCheck ?? true}
              disabled={!settings.soundEnabled}
              onChange={e => updateSettings({ soundCheck: e.target.checked })}
            />
            <span>King-in-check alerts</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.soundGameOver ?? true}
              disabled={!settings.soundEnabled}
              onChange={e => updateSettings({ soundGameOver: e.target.checked })}
            />
            <span>Game completion fanfare</span>
          </label>

          <button type="button" className="icon-btn" onClick={() => playCue('move')} disabled={!settings.soundEnabled}>
            🔊 Test Audio Cue
          </button>
        </div>

        {/* ------------------------------------------------- Engine & Clock Defaults */}
        <div className="panel-section">
          <div className="section-header">
            <span>Engine &amp; Time Control</span>
            <span>12 Calibrated Levels</span>
          </div>

          <label className="field">
            <span>Default Opponent Strength</span>
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
          <p className="field-hint">
            {DIFFICULTY_OPTIONS.find(o => o.id === settings.difficulty)?.description}
          </p>

          <label className="field">
            <span>Search Time Budget — {settings.searchTimeMs} ms</span>
            <input
              type="range"
              min={0}
              max={SEARCH_TIME_OPTIONS.length - 1}
              step={1}
              value={Math.max(0, SEARCH_TIME_OPTIONS.indexOf(settings.searchTimeMs))}
              onChange={e => updateSettings({ searchTimeMs: SEARCH_TIME_OPTIONS[Number(e.target.value)] })}
            />
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.useOpeningBook}
              onChange={e => updateSettings({ useOpeningBook: e.target.checked })}
            />
            <span>Enable verified Opening Book (disable for pure search testing)</span>
          </label>

          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={settings.showMoveHints}
              onChange={e => updateSettings({ showMoveHints: e.target.checked })}
            />
            <span>Show engine Principal Variation in Play sidebar</span>
          </label>

          <label className="field">
            <span>Default Time Control</span>
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

        {/* ------------------------------------------------- Runtime & Privacy Diagnostics */}
        <div className="panel-section">
          <div className="section-header">
            <span>System &amp; Privacy Diagnostics</span>
            <span>100% Local Execution</span>
          </div>
          <dl className="diagnostics">
            <dt>Renderer</dt>
            <dd>Pure 2D HTML/CSS/SVG Grid (Obsolete 3D/Three.js Removed)</dd>
            <dt>Engine Transport</dt>
            <dd>{transport === 'pending' && !mounted ? 'Initialising…' : transport}</dd>
            <dt>Local Estimated Rating</dt>
            <dd>
              {playerRating.rating} (±{playerRating.rd}) across {playerRating.gamesPlayed} rated games
            </dd>
            <dt>Active FEN</dt>
            <dd className="diag-mono">{snapshot.fen}</dd>
          </dl>
          <p className="honest-disclaimer">
            Privacy Guarantee: Zero external network requests, zero telemetry, and zero third-party tracking. All rules,
            engine searches, and self-play experiments execute locally in your browser.
          </p>
        </div>
      </div>
    </section>
  );
}