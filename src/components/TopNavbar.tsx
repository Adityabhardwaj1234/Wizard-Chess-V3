import React from 'react';
import type { PrimaryView } from '../context/CathedralSession';

interface TopNavbarProps {
  activeView: PrimaryView;
  onNavigate: (view: PrimaryView) => void;
  uiDensity: 'comfortable' | 'compact';
  onToggleDensity: () => void;
}

export function TopNavbar({
  activeView,
  onNavigate,
  uiDensity,
  onToggleDensity
}: TopNavbarProps) {
  const navItems: { id: PrimaryView; label: string; icon: string }[] = [
    { id: 'home', label: 'Home', icon: '⌂' },
    { id: 'play', label: 'Play', icon: '⚔' },
    { id: 'analysis', label: 'Analysis', icon: '◈' },
    { id: 'training', label: 'Training Lab', icon: '⚛' },
    { id: 'library', label: 'Game Library', icon: '☰' },
    { id: 'settings', label: 'Settings', icon: '⚙' }
  ];

  return (
    <header className="top-nav" role="navigation" aria-label="Primary Navigation">
      <div className="brand-cluster" onClick={() => onNavigate('home')} style={{ cursor: 'pointer' }}>
        <div className="brand-crest" aria-hidden="true">♔</div>
        <div className="brand-titles">
          <span className="brand-name">WIZARD&apos;S CHESS</span>
          <span className="brand-tagline">Production Edition · 2D Sanctuary · 12-Tier Engine · X-Ray</span>
        </div>
      </div>

      <div className="nav-actions">
        {navItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={`nav-btn ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="nav-btn"
          onClick={onToggleDensity}
          title="Toggle UI Density (Comfortable / Compact)"
        >
          {uiDensity === 'comfortable' ? '◧ Compact' : '◨ Comfort'}
        </button>
      </div>
    </header>
  );
}
