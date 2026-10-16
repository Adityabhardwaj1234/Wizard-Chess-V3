'use client';

/**
 * Application Shell (`page.tsx`)
 *
 * Wraps the entire router stage in `<SessionProvider>` so a match in progress
 * persists seamlessly across Home, Play, Analysis, Training Lab, Game Library, and Settings.
 */

import React, { useCallback, useEffect, useState } from 'react';

import { TopNavbar } from '../components/TopNavbar';
import { HomeDashboard } from '../components/HomeDashboard';
import { PlayView } from '../components/PlayView';
import { XRayOverlayPanel } from '../components/XRayOverlayPanel';
import { TrainingLab } from '../components/TrainingLab';
import { GameLibrary } from '../components/GameLibrary';
import { SettingsView } from '../components/SettingsView';
import { SessionProvider, useSession, type PrimaryView } from '../context/CathedralSession';

export type { PrimaryView } from '../context/CathedralSession';

function AppStage() {
  const { settings } = useSession();
  const [activeView, setActiveView] = useState<PrimaryView>('home');
  const [uiDensity, setUiDensity] = useState<'comfortable' | 'compact'>('comfortable');

  const navigate = useCallback((view: PrimaryView) => setActiveView(view), []);
  const toggleDensity = useCallback(
    () => setUiDensity(prev => (prev === 'comfortable' ? 'compact' : 'comfortable')),
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const map: Record<string, PrimaryView> = {
        h: 'home',
        p: 'play',
        x: 'analysis',
        t: 'training',
        l: 'library',
        s: 'settings'
      };
      const view = map[event.key.toLowerCase()];
      if (view) {
        event.preventDefault();
        setActiveView(view);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={`app-shell density-${uiDensity} ui-theme-${settings.uiTheme || 'dark'} ${
        settings.reducedMotion ? 'reduced-motion' : ''
      }`}
    >
      <TopNavbar
        activeView={activeView}
        onNavigate={navigate}
        uiDensity={uiDensity}
        onToggleDensity={toggleDensity}
      />
      <main className="main-router-stage">
        {activeView === 'home' && <HomeDashboard onNavigate={navigate} />}
        {activeView === 'play' && <PlayView />}
        {activeView === 'analysis' && <XRayOverlayPanel />}
        {activeView === 'training' && <TrainingLab />}
        {activeView === 'library' && <GameLibrary onNavigate={navigate} />}
        {activeView === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default function WizardsChessCathedralPage() {
  return (
    <SessionProvider>
      <AppStage />
    </SessionProvider>
  );
}