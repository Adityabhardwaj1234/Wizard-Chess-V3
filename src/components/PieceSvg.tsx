'use client';

/**
 * Original 2D SVG Chess Piece Artwork (`PieceSvg.tsx`)
 *
 * Custom, dependency-free Neo-Staunton vector pieces drawn on a 45×45 viewBox.
 * Each piece is composed from layered `<path>` / `<circle>` / `<rect>` shapes filled
 * with two linear gradients (a diagonal body gradient plus a horizontal base
 * gradient) so the artwork reads as carved, dimensional material at any size.
 *
 * Three selectable art directions are supported:
 * - `neo`   — Chess.com Neo Staunton (default)
 * - `wood`  — Imperial Wood & Ivory
 * - `glass` — Tournament Crystal
 *
 * The SVG is inert (`pointer-events: none`, `user-select: none`) so it never
 * intercepts board clicks, drags, or keyboard navigation performed by the
 * surrounding square/button elements.
 */

import React, { useId } from 'react';

import type { PieceType, PlayerColor } from '../lib/cathedral';

export type PieceStyleId = 'neo' | 'wood' | 'glass';

interface PieceSvgProps {
  /** Piece identity: pawn, knight, bishop, rook, queen, or king. */
  type: PieceType;
  /** Side the piece belongs to. */
  color: PlayerColor;
  /** Rendered width/height in pixels. Defaults to `100%` of the parent holder. */
  size?: number;
  /** Art direction override. Defaults to the Neo Staunton set. */
  pieceStyle?: PieceStyleId;
}

interface PiecePalette {
  stop1: string;
  stop2: string;
  stop3: string;
  stroke: string;
  inner: string;
  spec: string;
  collar: string;
}

const PIECE_LABELS: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King'
};

function getPiecePalette(color: PlayerColor, pieceStyle: PieceStyleId): PiecePalette {
  const isW = color === 'w';

  if (pieceStyle === 'wood') {
    return {
      stop1: isW ? '#fff3db' : '#69422c',
      stop2: isW ? '#edd09f' : '#432616',
      stop3: isW ? '#cfa363' : '#261309',
      stroke: isW ? '#38200f' : '#120803',
      inner: isW ? '#523018' : '#b88662',
      spec: isW ? 'rgba(255,255,255,0.86)' : 'rgba(255,220,185,0.28)',
      collar: isW ? '#e0b879' : '#54321f'
    };
  }

  if (pieceStyle === 'glass') {
    return {
      stop1: isW ? '#f8fdff' : '#4f6078',
      stop2: isW ? '#d8f1ff' : '#293548',
      stop3: isW ? '#9bd6f5' : '#111827',
      stroke: isW ? '#0f3f5c' : '#020617',
      inner: isW ? '#0284c7' : '#94a3b8',
      spec: '#ffffff',
      collar: isW ? '#bae6fd' : '#334155'
    };
  }

  // Default: Chess.com Neo Staunton.
  return {
    stop1: isW ? '#ffffff' : '#454e5e',
    stop2: isW ? '#f5f2eb' : '#2a303c',
    stop3: isW ? '#dfd9cc' : '#161920',
    stroke: isW ? '#1c2026' : '#0a0c10',
    inner: isW ? '#2c333f' : '#8b98b0',
    spec: isW ? '#ffffff' : 'rgba(255,255,255,0.3)',
    collar: isW ? '#ede8dd' : '#343c4a'
  };
}

interface PieceShapeArgs {
  /** `url(#…)` reference for the diagonal body gradient. */
  gradUrl: string;
  /** `url(#…)` reference for the horizontal base gradient. */
  baseUrl: string;
  pal: PiecePalette;
}

const PIECE_SVG_MAP: Record<PieceType, (args: PieceShapeArgs) => React.ReactNode> = {
  p: ({ gradUrl, baseUrl, pal }) => (
    <g fill={gradUrl} stroke={pal.stroke} strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 10.5,38 L 34.5,38 C 34.5,35.2 32.8,33.6 30.5,33.2 L 14.5,33.2 C 12.2,33.6 10.5,35.2 10.5,38 z" fill={baseUrl} />
      <path d="M 13.5,33.2 C 14.5,27.5 17.6,23.8 19.6,21.5 L 25.4,21.5 C 27.4,23.8 30.5,27.5 31.5,33.2 Z" />
      <rect x="16.5" y="19.2" width="12" height="2.6" rx="1.3" fill={pal.collar} />
      <circle cx="22.5" cy="13.2" r="5.8" />
      <path d="M 19.5,10.2 A 3.8,3.8 0 0 1 24.5,9.6" fill="none" stroke={pal.spec} strokeWidth="1.5" />
      <line x1="13.8" y1="35.6" x2="31.2" y2="35.6" stroke={pal.inner} strokeWidth="1.15" />
    </g>
  ),

  r: ({ gradUrl, baseUrl, pal }) => (
    <g fill={gradUrl} stroke={pal.stroke} strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 9.5,38.2 L 35.5,38.2 C 35.2,35.2 33.6,33.8 31.5,33.4 L 13.5,33.4 C 11.4,33.8 9.8,35.2 9.5,38.2 z" fill={baseUrl} />
      <path d="M 12.5,33.4 L 14,30 L 31,30 L 32.5,33.4 Z" fill={pal.collar} />
      <path d="M 14.8,30 L 16.2,17.2 L 28.8,17.2 L 30.2,30 Z" />
      <path d="M 12.2,17.2 L 32.8,17.2 L 33.8,10 L 29.6,10 L 29.6,12.8 L 26.8,12.8 L 26.8,10 L 18.2,10 L 18.2,12.8 L 15.4,12.8 L 15.4,10 L 11.2,10 Z" />
      <path d="M 17.8,19.5 L 17,28" fill="none" stroke={pal.spec} strokeWidth="1.5" />
      <line x1="15.2" y1="17.2" x2="29.8" y2="17.2" stroke={pal.inner} strokeWidth="1.3" />
      <line x1="13.2" y1="35.8" x2="31.8" y2="35.8" stroke={pal.inner} strokeWidth="1.2" />
    </g>
  ),

  n: ({ gradUrl, baseUrl, pal }) => (
    <g fill={gradUrl} stroke={pal.stroke} strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 10,38.2 L 35,38.2 C 34.6,35.2 33,33.8 30.8,33.4 L 14.2,33.4 C 12,33.8 10.4,35.2 10,38.2 z" fill={baseUrl} />
      <path d="M 13,33.4 L 14.2,30.2 L 30.8,30.2 L 32,33.4 Z" fill={pal.collar} />
      <path d="M 14.8,30.2 C 15.2,23.2 19.2,20.8 22.4,19.4 C 19.2,19.8 15.4,21.5 12.2,19.6 C 10.2,18.2 10.2,15.2 12.8,13.2 C 15.2,11.4 17.5,9.6 19,6.8 C 20.8,7.6 21.8,9.4 22.2,10.2 C 24.2,8.8 26.6,7.6 28.4,7.2 C 28,9.6 27.6,11.2 28.8,12.4 C 33.2,15.6 34.4,22.4 31.4,30.2 Z" />
      <circle cx="17.2" cy="13.8" r="1.45" fill={pal.inner} stroke="none" />
      <circle cx="13.2" cy="16.8" r="0.9" fill={pal.inner} stroke="none" />
      <path d="M 26.2,12.8 C 29.2,16.5 29.8,22.5 28.2,28.5" fill="none" stroke={pal.spec} strokeWidth="1.6" />
      <line x1="13.2" y1="35.8" x2="31.8" y2="35.8" stroke={pal.inner} strokeWidth="1.2" />
    </g>
  ),

  b: ({ gradUrl, baseUrl, pal }) => (
    <g fill={gradUrl} stroke={pal.stroke} strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 9.8,38.2 L 35.2,38.2 C 34.8,35.4 33,33.8 30.8,33.4 L 14.2,33.4 C 12,33.8 10.2,35.4 9.8,38.2 z" fill={baseUrl} />
      <path d="M 13.2,33.4 L 14.8,29.8 L 30.2,29.8 L 31.8,33.4 Z" fill={pal.collar} />
      <path d="M 15.2,29.8 C 12.5,22.8 14,13.5 22.5,9.6 C 31,13.5 32.5,22.8 29.8,29.8 Z" />
      <circle cx="22.5" cy="7" r="2.4" fill={baseUrl} />
      <path d="M 19.2,17.2 L 25.8,17.2 M 22.5,14 L 22.5,20.6" stroke={pal.inner} strokeWidth="1.75" />
      <path d="M 17.5,14.2 C 15.8,18.2 15.8,23.2 17.2,27.5" fill="none" stroke={pal.spec} strokeWidth="1.4" />
      <line x1="15.2" y1="29.8" x2="29.8" y2="29.8" stroke={pal.inner} strokeWidth="1.3" />
      <line x1="13.2" y1="35.8" x2="31.8" y2="35.8" stroke={pal.inner} strokeWidth="1.2" />
    </g>
  ),

  q: ({ gradUrl, baseUrl, pal }) => (
    <g fill={gradUrl} stroke={pal.stroke} strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 9.5,38.2 L 35.5,38.2 C 35,35.4 33.4,33.8 31,33.4 L 14,33.4 C 11.6,33.8 10,35.4 9.5,38.2 z" fill={baseUrl} />
      <path d="M 12.8,33.4 L 14.2,29.6 L 30.8,29.6 L 32.2,33.4 Z" fill={pal.collar} />
      <path d="M 14.2,29.6 L 9.8,14.2 L 16.8,22.2 L 22.5,12.2 L 28.2,22.2 L 35.2,14.2 L 30.8,29.6 Z" />
      <circle cx="9.2" cy="12" r="2" fill={baseUrl} />
      <circle cx="15.8" cy="10" r="2" fill={baseUrl} />
      <circle cx="22.5" cy="9" r="2.2" fill={baseUrl} />
      <circle cx="29.2" cy="10" r="2" fill={baseUrl} />
      <circle cx="35.8" cy="12" r="2" fill={baseUrl} />
      <path d="M 15.2,26.8 C 20,25.2 25,25.2 29.8,26.8" fill="none" stroke={pal.inner} strokeWidth="1.35" />
      <line x1="13.2" y1="35.8" x2="31.8" y2="35.8" stroke={pal.inner} strokeWidth="1.2" />
    </g>
  ),

  k: ({ gradUrl, baseUrl, pal }) => (
    <g fill={gradUrl} stroke={pal.stroke} strokeWidth="1.95" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 22.5,4.2 L 22.5,10.5 M 19.4,7 L 25.6,7" stroke={pal.stroke} strokeWidth="2.4" />
      <path d="M 9.5,38.2 L 35.5,38.2 C 35,35.4 33.4,33.8 31,33.4 L 14,33.4 C 11.6,33.8 10,35.4 9.5,38.2 z" fill={baseUrl} />
      <path d="M 12.8,33.4 L 14.2,29.6 L 30.8,29.6 L 32.2,33.4 Z" fill={pal.collar} />
      <path d="M 14.2,29.6 C 10.5,21.8 11.5,13.8 18.2,13 C 20.5,12.8 21.8,14.2 22.5,15.8 C 23.2,14.2 24.5,12.8 26.8,13 C 33.5,13.8 34.5,21.8 30.8,29.6 Z" />
      <path d="M 22.5,10.4 C 20.2,10.4 19.2,12.2 22.5,15.8 C 25.8,12.2 24.8,10.4 22.5,10.4 Z" fill={pal.collar} />
      <path d="M 15.2,26.6 C 20,25 25,25 29.8,26.6" fill="none" stroke={pal.inner} strokeWidth="1.35" />
      <path d="M 15,17 C 14,20.5 14.8,24.5 16.2,27.5" fill="none" stroke={pal.spec} strokeWidth="1.4" />
      <line x1="13.2" y1="35.8" x2="31.8" y2="35.8" stroke={pal.inner} strokeWidth="1.2" />
    </g>
  )
};

export function PieceSvg({ type, color, size, pieceStyle = 'neo' }: PieceSvgProps) {
  // `useId` guarantees gradient IDs stay unique when many pieces share the board.
  // Colons are stripped because React's ids are not safe inside `url(#…)`.
  const uid = useId().replace(/:/g, '');
  const pal = getPiecePalette(color, pieceStyle);
  const gradId = `pg-${uid}`;
  const baseId = `pb-${uid}`;
  const label = `${color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[type] || type}`;
  const renderShape = PIECE_SVG_MAP[type];

  return (
    <svg
      viewBox="0 0 45 45"
      width={size ?? '100%'}
      height={size ?? '100%'}
      className={`chess-piece-svg piece-${color}-${type}`}
      role="img"
      aria-label={label}
      style={{
        display: 'block',
        userSelect: 'none',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 2.2px 2.2px rgba(2,6,23,0.36))'
      }}
    >
      <defs>
        <linearGradient id={gradId} x1="20%" y1="8%" x2="82%" y2="92%">
          <stop offset="0%" stopColor={pal.stop1} />
          <stop offset="55%" stopColor={pal.stop2} />
          <stop offset="100%" stopColor={pal.stop3} />
        </linearGradient>
        <linearGradient id={baseId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={pal.stop3} />
          <stop offset="35%" stopColor={pal.stop1} />
          <stop offset="100%" stopColor={pal.stop3} />
        </linearGradient>
      </defs>
      {renderShape ? renderShape({ gradUrl: `url(#${gradId})`, baseUrl: `url(#${baseId})`, pal }) : null}
    </svg>
  );
}

export default PieceSvg;