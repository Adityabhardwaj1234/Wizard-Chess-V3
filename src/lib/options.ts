/**
 * Engine Difficulty, Board Theme & Presentation Options
 *
 * Derived directly from `DIFFICULTY_PRESETS` in `CathedralEngine.js` so UI controls
 * always reflect the exact 12-tier calibrated ladder + Experimental mode.
 */

import { DIFFICULTY_PRESETS } from '../engine/CathedralEngine';

export interface DifficultyOption {
  id: string;
  tier: number;
  label: string;
  shortLabel: string;
  description: string;
  estimatedRating: number;
  ratingUncertainty: number;
  calibrationStatus: string;
  maxDepth: number;
  timeLimitMs: number;
  nodeLimit: number;
}

type PresetMap = Record<
  string,
  {
    id: string;
    tier: number;
    name: string;
    label: string;
    shortLabel: string;
    estimatedRating: number;
    ratingUncertainty: number;
    calibrationStatus: string;
    maxDepth: number;
    timeLimitMs: number;
    nodeLimit: number;
    description: string;
  }
>;

const presets = DIFFICULTY_PRESETS as PresetMap;

export const DIFFICULTY_OPTIONS: DifficultyOption[] = Object.keys(presets)
  .filter(id => id !== 'Analysis')
  .map(id => ({
    id,
    tier: presets[id].tier,
    label: presets[id].label,
    shortLabel: presets[id].shortLabel,
    description: presets[id].description,
    estimatedRating: presets[id].estimatedRating,
    ratingUncertainty: presets[id].ratingUncertainty,
    calibrationStatus: presets[id].calibrationStatus,
    maxDepth: presets[id].maxDepth,
    timeLimitMs: presets[id].timeLimitMs,
    nodeLimit: presets[id].nodeLimit
  }))
  .sort((a, b) => a.tier - b.tier);

export const ANALYSIS_PRESET_ID = 'Analysis';

export function describePreset(id: string): string {
  return presets[id]?.description ?? 'Balanced search preset.';
}

export interface BoardThemeOption {
  id: 'classic-green' | 'tournament-slate' | 'woodland' | 'high-contrast';
  label: string;
  description: string;
  lightSquare: string;
  darkSquare: string;
}

export const BOARD_THEME_OPTIONS: BoardThemeOption[] = [
  {
    id: 'classic-green',
    label: 'Classic Green (Default)',
    description: 'Traditional tournament green and warm cream squares.',
    lightSquare: '#eeeed2',
    darkSquare: '#769656'
  },
  {
    id: 'tournament-slate',
    label: 'Tournament Slate',
    description: 'Restrained championship blue-grey and crisp off-white.',
    lightSquare: '#dee3e6',
    darkSquare: '#5b738b'
  },
  {
    id: 'woodland',
    label: 'Woodland',
    description: 'Warm walnut and maple tones inspired by classic wooden boards.',
    lightSquare: '#f0d9b5',
    darkSquare: '#b58863'
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    description: 'Maximum luminance distinction for visual accessibility.',
    lightSquare: '#f8fafc',
    darkSquare: '#334155'
  }
];

export const SEARCH_TIME_OPTIONS = [150, 300, 600, 900, 1500, 2500, 3600];