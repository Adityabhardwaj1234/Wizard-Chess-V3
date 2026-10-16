'use client';

/**
 * Pure 2D 8×8 Chessboard & Tactical X-Ray Vector Overlay (`CathedralBoard.tsx`)
 *
 * Completely replaces the obsolete Three.js 3D renderer with a high-contrast,
 * responsive 2D HTML/CSS/SVG board featuring:
 * - Exactly 64 mapped squares with Classic Green, Tournament Slate, Woodland, and High Contrast themes.
 * - Custom original 2D SVG chess piece artwork (`PieceSvg.tsx`).
 * - Mouse click-to-move, pointer/touch drag-to-move (`touch-action: none` so mobile never scrolls during drag),
 *   and full keyboard arrow-key + Enter/Space navigation.
 * - Separate sorted capture trays for White and Black with net material differential (`+3`).
 * - Atomic Pawn Promotion modal supporting mouse, touch, and keyboard (`Q`, `R`, `B`, `N`, `1-4`, `Escape`).
 * - 2D SVG vector overlay for X-Ray tactical layers (attack badges, hanging halos, pin/fork/skewer rays,
 *   candidate engine arrows, PV arrows, and predicted replies) + color-blind shape indicators.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PieceSvg } from './PieceSvg';
import { useSession } from '../context/CathedralSession';
import { xray as xrayApi, type PieceType, type PlayerColor } from '../lib/cathedral';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

function squareCenterCoords(sq: string, flipped: boolean): { x: number; y: number } {
  const f = sq.charCodeAt(0) - 97;
  const r = 8 - (sq.charCodeAt(1) - 48);
  const col = flipped ? 7 - f : f;
  const row = flipped ? 7 - r : r;
  return {
    x: col * 100 + 50,
    y: row * 100 + 50
  };
}

export function CathedralBoard({ compact = false }: { compact?: boolean }) {
  const session = useSession();
  const {
    snapshot,
    displayedGame,
    selectedSquare,
    selectionMoves,
    clickSquare,
    attemptMove,
    clearSelection,
    pendingPromotion,
    resolvePromotion,
    cancelPromotion,
    settings,
    boardFlipped,
    flipBoard,
    hintTier,
    progressiveHints,
    xrayLayers,
    engineResult,
    humanColor,
    mode
  } = session;

  const boardRef = useRef<HTMLDivElement | null>(null);
  const [focusedSquare, setFocusedSquare] = useState<string>('e2');
  const [dragState, setDragState] = useState<{
    from: string;
    piece: PieceType;
    color: PlayerColor;
    x: number;
    y: number;
    hoverSquare: string | null;
  } | null>(null);

  const xrayData = useMemo(() => {
    if (!xrayLayers.enabled) return null;
    try {
      return xrayApi.computeXRayAnalysis(displayedGame, engineResult);
    } catch (_err) {
      return null;
    }
  }, [displayedGame, snapshot.fen, xrayLayers.enabled, engineResult]);

  // Keyboard shortcuts for Promotion Picker when active
  useEffect(() => {
    if (!pendingPromotion) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        e.preventDefault();
        cancelPromotion();
      } else if (k === 'q' || k === '1') {
        e.preventDefault();
        resolvePromotion('q');
      } else if (k === 'r' || k === '2') {
        e.preventDefault();
        resolvePromotion('r');
      } else if (k === 'b' || k === '3') {
        e.preventDefault();
        resolvePromotion('b');
      } else if (k === 'n' || k === '4') {
        e.preventDefault();
        resolvePromotion('n');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingPromotion, cancelPromotion, resolvePromotion]);

  const getSquareFromClientPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const el = boardRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      const col = Math.max(0, Math.min(7, Math.floor(relX * 8)));
      const row = Math.max(0, Math.min(7, Math.floor(relY * 8)));
      const fileIdx = boardFlipped ? 7 - col : col;
      const rankIdx = boardFlipped ? 7 - row : row;
      return FILES[fileIdx] + RANKS[rankIdx];
    },
    [boardFlipped]
  );

  // Pointer Drag-and-Drop handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, sq: string, cell: { type: PieceType; color: PlayerColor } | null) => {
      if (pendingPromotion || snapshot.isViewingHistory) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const canDragPiece =
        cell &&
        cell.color === snapshot.turn &&
        (mode === 'two-player' || cell.color === humanColor);

      if (canDragPiece) {
        const el = boardRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          setDragState({
            from: sq,
            piece: cell.type,
            color: cell.color,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            hoverSquare: sq
          });
        }
      }
    },
    [humanColor, mode, pendingPromotion, snapshot.isViewingHistory, snapshot.turn]
  );

  useEffect(() => {
    if (!dragState) return;

    const onPointerMove = (e: PointerEvent) => {
      const el = boardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const hoverSq = getSquareFromClientPoint(e.clientX, e.clientY);
      setDragState(prev =>
        prev
          ? {
              ...prev,
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
              hoverSquare: hoverSq
            }
          : null
      );
    };

    const onPointerUp = (e: PointerEvent) => {
      const targetSq = getSquareFromClientPoint(e.clientX, e.clientY);
      const fromSq = dragState.from;
      setDragState(null);
      if (targetSq && targetSq !== fromSq) {
        attemptMove(fromSq, targetSq);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [attemptMove, dragState, getSquareFromClientPoint]);

  // Keyboard navigation across the 64 squares
  const handleBoardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (pendingPromotion) return;
      const f = focusedSquare.charCodeAt(0) - 97;
      const r = 8 - (focusedSquare.charCodeAt(1) - 48);
      const step = boardFlipped ? -1 : 1;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nf = Math.max(0, Math.min(7, f + step));
        setFocusedSquare(FILES[nf] + RANKS[r]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const nf = Math.max(0, Math.min(7, f - step));
        setFocusedSquare(FILES[nf] + RANKS[r]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nr = Math.max(0, Math.min(7, r + step));
        setFocusedSquare(FILES[f] + RANKS[nr]);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nr = Math.max(0, Math.min(7, r - step));
        setFocusedSquare(FILES[f] + RANKS[nr]);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickSquare(focusedSquare);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
      }
    },
    [boardFlipped, clearSelection, clickSquare, focusedSquare, pendingPromotion]
  );

  const legalTargetMap = useMemo(() => {
    const map = new Map<string, { isCapture: boolean; isPromotion: boolean }>();
    if (!settings.showLegalMoves) return map;
    for (const m of selectionMoves) {
      map.set(m.to, {
        isCapture: Boolean(m.captured) || m.flags === 'e',
        isPromotion: Boolean(m.promotion)
      });
    }
    return map;
  }, [selectionMoves, settings.showLegalMoves]);

  const hangingSquareMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!xrayData || (!xrayLayers.hangingPieces && !xrayLayers.vulnerable)) return map;
    for (const h of xrayData.hangingPieces) {
      map.set(h.square, h.severity);
    }
    for (const o of xrayData.overloadedDefenders) {
      if (xrayLayers.overloadedDefenders && !map.has(o.square)) {
        map.set(o.square, 'overloaded');
      }
    }
    return map;
  }, [xrayData, xrayLayers.hangingPieces, xrayLayers.overloadedDefenders, xrayLayers.vulnerable]);

  const defendedSquareSet = useMemo(() => {
    const set = new Set<string>();
    if (!xrayData || !xrayLayers.defendedPieces) return set;
    for (const d of xrayData.defendedPieces) {
      set.add(d.square);
    }
    return set;
  }, [xrayData, xrayLayers.defendedPieces]);

  // Top & Bottom tray sides depending on board orientation
  const topSide: PlayerColor = boardFlipped ? 'w' : 'b';
  const bottomSide: PlayerColor = boardFlipped ? 'b' : 'w';

  const renderCaptureTray = (trayOwner: PlayerColor) => {
    const pieces = trayOwner === 'w' ? snapshot.captured.capturedByWhite : snapshot.captured.capturedByBlack;
    const capturedPieceColor: PlayerColor = trayOwner === 'w' ? 'b' : 'w';
    const netAdv =
      trayOwner === 'w' ? snapshot.captured.netWhiteAdvantage : -snapshot.captured.netWhiteAdvantage;

    return (
      <div
        className="capture-tray"
        aria-label={`${trayOwner === 'w' ? 'White' : 'Black'} captured pieces`}
        data-side={trayOwner}
      >
        <div className="capture-tray-header">
          <span className="capture-tray-owner">
            <span className={`side-dot side-${trayOwner}`} />
            {trayOwner === 'w' ? 'White' : 'Black'}
          </span>
          {netAdv > 0 && <span className="material-adv-badge">+{netAdv}</span>}
        </div>
        <div className="capture-tray-icons">
          {pieces.length === 0 ? (
            <span className="capture-empty">No captures</span>
          ) : (
            pieces.map((p, idx) => (
              <span key={`${p}-${idx}`} className="captured-piece-chip">
                <PieceSvg type={p} color={capturedPieceColor} size={20} />
              </span>
            ))
          )}
        </div>
      </div>
    );
  };

  // Build 64 ordered squares according to orientation
  const orderedRows = useMemo(() => {
    const rows = [];
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      const r = boardFlipped ? 7 - displayRow : displayRow;
      const cells = [];
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const f = boardFlipped ? 7 - displayCol : displayCol;
        const sq = FILES[f] + RANKS[r];
        const isLight = (r + f) % 2 === 0;
        const cell = snapshot.board[r]?.[f] ?? null;
        cells.push({
          sq,
          r,
          f,
          displayRow,
          displayCol,
          isLight,
          cell
        });
      }
      rows.push(cells);
    }
    return rows;
  }, [boardFlipped, snapshot.board]);

  // Build SVG arrows for Hints & X-Ray layers
  const overlayArrows = useMemo(() => {
    const arrows: {
      id: string;
      from: string;
      to: string;
      color: string;
      dashed?: boolean;
      width?: number;
      label?: string;
    }[] = [];

    // Progressive Hint Tier 4/5 arrow
    if (hintTier >= 4 && progressiveHints.available && progressiveHints.recommendedMove) {
      arrows.push({
        id: 'hint-move',
        from: progressiveHints.recommendedMove.from,
        to: progressiveHints.recommendedMove.to,
        color: '#eab308',
        width: 14,
        label: progressiveHints.recommendedMove.san
      });
    }

    if (xrayData && xrayLayers.enabled) {
      // Pins & Discovered Attacks
      if (xrayLayers.pinsAndDiscovered || xrayLayers.motifs) {
        for (const m of xrayData.pinsAndDiscovered) {
          if (m.attackerSquare && m.targetSquares.length >= 2) {
            arrows.push({
              id: `pin-${m.attackerSquare}-${m.targetSquares[1]}`,
              from: m.attackerSquare,
              to: m.targetSquares[1],
              color: m.type === 'Pin' ? '#f97316' : '#a855f7',
              dashed: true,
              width: 9,
              label: m.type
            });
          }
        }
      }

      // Forks & Skewers
      if (xrayLayers.forksAndSkewers || xrayLayers.motifs) {
        for (const m of xrayData.forksAndSkewers) {
          if (m.attackerSquare) {
            for (const tSq of m.targetSquares) {
              arrows.push({
                id: `fork-${m.attackerSquare}-${tSq}`,
                from: m.attackerSquare,
                to: tSq,
                color: '#ec4899',
                dashed: m.type === 'Skewer',
                width: 9,
                label: m.type
              });
            }
          }
        }
      }

      // King Check Threats
      if (xrayLayers.kingThreats || xrayLayers.kingSafety) {
        for (const chk of xrayData.kingSafety.checkAttackers) {
          arrows.push({
            id: `check-${chk.from}-${chk.to}`,
            from: chk.from,
            to: chk.to,
            color: '#ef4444',
            width: 12,
            label: 'CHECK'
          });
        }
      }

      // Candidate Engine Moves
      if (xrayLayers.candidateMoves) {
        for (const c of xrayData.candidateArrows.slice(0, 2)) {
          arrows.push({
            id: `cand-${c.from}-${c.to}`,
            from: c.from,
            to: c.to,
            color: c.rank === 1 ? '#38bdf8' : '#94a3b8',
            width: c.rank === 1 ? 11 : 7,
            label: c.san
          });
        }
      }

      // Principal Variation Arrow
      if (xrayLayers.pvArrows || xrayLayers.prediction) {
        for (const pv of xrayData.pvArrows) {
          if (!arrows.some(a => a.from === pv.from && a.to === pv.to)) {
            arrows.push({
              id: `pv-${pv.from}-${pv.to}`,
              from: pv.from,
              to: pv.to,
              color: '#0ea5e9',
              width: 12,
              label: pv.san
            });
          }
        }
      }

      // Predicted Opponent Reply Arrow
      if (xrayLayers.predictedReplies) {
        for (const rep of xrayData.predictedReplyArrows) {
          arrows.push({
            id: `reply-${rep.from}-${rep.to}`,
            from: rep.from,
            to: rep.to,
            color: '#6366f1',
            dashed: true,
            width: 9,
            label: rep.san
          });
        }
      }
    }

    return arrows;
  }, [hintTier, progressiveHints, xrayData, xrayLayers]);

  return (
    <div
      className={`board-2d-wrapper theme-${settings.boardTheme} ${settings.colorBlindMode ? 'colorblind-mode' : ''} ${
        compact ? 'board-compact' : ''
      }`}
    >
      {/* Top Capture Tray */}
      {!compact && renderCaptureTray(topSide)}

      {/* 8x8 2D Board Container */}
      <div
        ref={boardRef}
        className="board-2d-grid"
        role="grid"
        aria-label="Chessboard — 8 by 8 squares. Use arrow keys to navigate and Enter or Space to select or move."
        tabIndex={0}
        onKeyDown={handleBoardKeyDown}
      >
        {orderedRows.map((row, rIdx) => (
          <div key={rIdx} className="board-2d-row" role="row">
            {row.map(({ sq, displayRow, displayCol, isLight, cell }) => {
              const isSelected = selectedSquare === sq;
              const isLastFrom = snapshot.lastMove?.from === sq;
              const isLastTo = snapshot.lastMove?.to === sq;
              const isKingInCheck = snapshot.checkSquare === sq;
              const isOriginHint = hintTier >= 3 && progressiveHints.originSquare === sq;
              const isDragHover = dragState?.hoverSquare === sq;
              const legalTarget = legalTargetMap.get(sq);
              const hangingSeverity = hangingSquareMap.get(sq);
              const isDefended = defendedSquareSet.has(sq);
              const attackInfo =
                xrayData && (xrayLayers.attackedSquares || xrayLayers.attackMap) ? xrayData.attackMap[sq] : null;

              const showRankCoord = settings.showCoordinates && displayCol === 0;
              const showFileCoord = settings.showCoordinates && displayRow === 7;

              const sqClasses = [
                'board-square',
                isLight ? 'sq-light' : 'sq-dark',
                isSelected ? 'sq-selected' : '',
                isLastFrom || isLastTo ? 'sq-last-move' : '',
                isKingInCheck ? 'sq-in-check' : '',
                isOriginHint ? 'sq-hint-origin' : '',
                isDragHover ? 'sq-drag-hover' : '',
                focusedSquare === sq ? 'sq-focused' : '',
                hangingSeverity ? `sq-hanging-${hangingSeverity}` : '',
                isDefended ? 'sq-defended' : ''
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={sq}
                  type="button"
                  role="gridcell"
                  data-square={sq}
                  aria-label={`${sq}${cell ? `, ${cell.color === 'w' ? 'White' : 'Black'} ${cell.type.toUpperCase()}` : ', empty'}${
                    legalTarget ? (legalTarget.isCapture ? ', legal capture' : ', legal move') : ''
                  }`}
                  aria-selected={isSelected}
                  className={sqClasses}
                  onClick={() => {
                    setFocusedSquare(sq);
                    clickSquare(sq);
                  }}
                  onPointerDown={e => handlePointerDown(e, sq, cell)}
                >
                  {/* Rank and File Coordinate Labels */}
                  {showRankCoord && (
                    <span className="coord-label coord-rank" aria-hidden="true">
                      {sq[1]}
                    </span>
                  )}
                  {showFileCoord && (
                    <span className="coord-label coord-file" aria-hidden="true">
                      {sq[0]}
                    </span>
                  )}

                  {/* X-Ray Attack Control Badge */}
                  {attackInfo && (attackInfo.whiteCount > 0 || attackInfo.blackCount > 0) && (
                    <span
                      className={`xray-control-badge ctrl-${attackInfo.control}`}
                      title={`White attackers: ${attackInfo.whiteCount}, Black attackers: ${attackInfo.blackCount}`}
                      aria-hidden="true"
                    >
                      {attackInfo.whiteCount}:{attackInfo.blackCount}
                    </span>
                  )}

                  {/* Color-Blind & Tactical Status Badges */}
                  {hangingSeverity && (
                    <span className="tactical-corner-badge badge-danger" title="Vulnerable / Hanging Piece" aria-hidden="true">
                      {settings.colorBlindMode ? '▲!' : '!'}
                    </span>
                  )}
                  {!hangingSeverity && isDefended && (
                    <span className="tactical-corner-badge badge-defended" title="Defended Piece" aria-hidden="true">
                      {settings.colorBlindMode ? '◆' : '✓'}
                    </span>
                  )}

                  {/* Chess Piece SVG */}
                  {cell && !(dragState && dragState.from === sq) && (
                    <div className="square-piece-holder">
                      <PieceSvg type={cell.type} color={cell.color} />
                    </div>
                  )}

                  {/* Legal Destination / Capture Indicator */}
                  {legalTarget && (
                    <span
                      className={legalTarget.isCapture ? 'legal-capture-ring' : 'legal-move-dot'}
                      aria-hidden="true"
                    >
                      {settings.colorBlindMode && legalTarget.isCapture && <span className="cb-capture-tag">×</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {/* 2D SVG Vector Overlay for Arrows, Pins, Forks, Skewers, and Principal Variation */}
        <svg className="board-svg-overlay" viewBox="0 0 800 800" aria-hidden="true">
          <defs>
            <marker id="arrow-head-gold" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
              <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#eab308" />
            </marker>
            <marker id="arrow-head-blue" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
              <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#0ea5e9" />
            </marker>
            <marker id="arrow-head-orange" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
              <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#f97316" />
            </marker>
            <marker id="arrow-head-pink" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
              <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#ec4899" />
            </marker>
            <marker id="arrow-head-red" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
              <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#ef4444" />
            </marker>
            <marker id="arrow-head-indigo" markerWidth="4.5" markerHeight="4.5" refX="2.8" refY="2.25" orient="auto">
              <polygon points="0 0, 4.5 2.25, 0 4.5" fill="#6366f1" />
            </marker>
          </defs>

          {overlayArrows.map(arrow => {
            const p1 = squareCenterCoords(arrow.from, boardFlipped);
            const p2 = squareCenterCoords(arrow.to, boardFlipped);
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            const trimStart = 18;
            const trimEnd = 24;
            const x1 = p1.x + (dx / len) * trimStart;
            const y1 = p1.y + (dy / len) * trimStart;
            const x2 = p2.x - (dx / len) * trimEnd;
            const y2 = p2.y - (dy / len) * trimEnd;

            const markerId =
              arrow.color === '#eab308'
                ? 'url(#arrow-head-gold)'
                : arrow.color === '#f97316'
                ? 'url(#arrow-head-orange)'
                : arrow.color === '#ec4899'
                ? 'url(#arrow-head-pink)'
                : arrow.color === '#ef4444'
                ? 'url(#arrow-head-red)'
                : arrow.color === '#6366f1'
                ? 'url(#arrow-head-indigo)'
                : 'url(#arrow-head-blue)';

            return (
              <g key={arrow.id} opacity="0.88">
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={arrow.color}
                  strokeWidth={arrow.width || 11}
                  strokeLinecap="round"
                  strokeDasharray={arrow.dashed ? '14 10' : undefined}
                  markerEnd={markerId}
                />
              </g>
            );
          })}
        </svg>

        {/* Active Drag Ghost Piece */}
        {dragState && (
          <div
            className="drag-ghost-piece"
            style={{
              left: `${dragState.x}px`,
              top: `${dragState.y}px`
            }}
            aria-hidden="true"
          >
            <PieceSvg type={dragState.piece} color={dragState.color} size={56} />
          </div>
        )}

        {/* Atomic Pawn Promotion Modal Overlay */}
        {pendingPromotion && (
          <div
            className="promotion-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Choose pawn promotion piece"
          >
            <div className="promotion-modal-card">
              <div className="promotion-modal-header">
                <strong>Promote Pawn ({pendingPromotion.from} → {pendingPromotion.to})</strong>
                <span className="text-muted">Choose a piece (or press Q, R, B, N / Esc)</span>
              </div>
              <div className="promotion-choice-grid">
                {(
                  [
                    { id: 'q', name: 'Queen', hotkey: 'Q / 1' },
                    { id: 'r', name: 'Rook', hotkey: 'R / 2' },
                    { id: 'b', name: 'Bishop', hotkey: 'B / 3' },
                    { id: 'n', name: 'Knight', hotkey: 'N / 4' }
                  ] as const
                ).map(choice => (
                  <button
                    key={choice.id}
                    type="button"
                    data-promotion-piece={choice.id}
                    className="promotion-choice-btn"
                    onClick={() => resolvePromotion(choice.id)}
                  >
                    <PieceSvg type={choice.id} color={pendingPromotion.color} size={46} />
                    <span className="promo-piece-name">{choice.name}</span>
                    <kbd className="promo-hotkey">{choice.hotkey}</kbd>
                  </button>
                ))}
              </div>
              <button type="button" className="icon-btn promo-cancel-btn" onClick={cancelPromotion}>
                Cancel Move (Esc)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Capture Tray & Quick Board Toolbar */}
      <div className="board-bottom-bar">
        {!compact && renderCaptureTray(bottomSide)}
        <div className="board-quick-tools">
          <button type="button" className="icon-btn" onClick={flipBoard} title="Flip board orientation">
            ⇅ Flip ({boardFlipped ? 'Black bottom' : 'White bottom'})
          </button>
        </div>
      </div>
    </div>
  );
}