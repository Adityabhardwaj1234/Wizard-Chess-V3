/**
 * Orthodox Chess Rules & Fast 0x88 State Adapter (ChessGame.js)
 * Complete FIDE chess rules with zero-string-allocation Zobrist repetition stack,
 * square attacker lookup, Static Exchange Evaluation (SEE), SAN/FEN/PGN, Undo/Redo,
 * Replay position reconstruction, Captured piece tracking, and Perft.
 */

import {
  ZOBRIST,
  CASTLE_WK,
  CASTLE_WQ,
  CASTLE_BK,
  CASTLE_BQ
} from '../engine/positionHash.js';

export const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
export const BISHOP_OFFSETS = [-17, -15, 15, 17];
export const ROOK_OFFSETS = [-16, -1, 1, 16];
export const QUEEN_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];
export const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];

export const SEE_PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 920,
  k: 20000
};

export const STANDARD_PIECE_VALUES = {
  q: 9,
  r: 5,
  b: 3,
  n: 3,
  p: 1,
  k: 0
};

const CAPTURE_SORT_ORDER = { q: 1, r: 2, b: 3, n: 4, p: 5 };

export function sq88To64(sq88) {
  return ((sq88 >> 4) << 3) | (sq88 & 7);
}

export function sq64To88(sq64) {
  return ((sq64 >> 3) << 4) | (sq64 & 7);
}

export function algebraicTo88(alg) {
  if (!alg || typeof alg !== 'string' || alg.length !== 2) return -1;
  const f = alg.charCodeAt(0) - 97;
  const r = 8 - (alg.charCodeAt(1) - 48);
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return (r << 4) | f;
}

export function sq88ToAlgebraic(sq88) {
  if (sq88 & 0x88) return '-';
  const f = sq88 & 7;
  const r = sq88 >> 4;
  return FILES[f] + RANKS[r];
}

const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 ^ CASTLE_BQ;
CASTLE_MASK[0x07] = 15 ^ CASTLE_BK;
CASTLE_MASK[0x04] = 15 ^ (CASTLE_BK | CASTLE_BQ);
CASTLE_MASK[0x70] = 15 ^ CASTLE_WQ;
CASTLE_MASK[0x77] = 15 ^ CASTLE_WK;
CASTLE_MASK[0x74] = 15 ^ (CASTLE_WK | CASTLE_WQ);

export function validateFen(fen) {
  if (!fen || typeof fen !== 'string') {
    return { valid: false, error: 'FEN must be a non-empty string.' };
  }
  if (fen.length > 160) {
    return { valid: false, error: 'FEN exceeds safe length limit.' };
  }
  const tokens = fen.trim().split(/\s+/);
  if (tokens.length < 4 || tokens.length > 6) {
    return { valid: false, error: 'FEN must contain 4 to 6 space-separated fields.' };
  }
  const [boardPart, turnPart, castlePart, epPart, halfPart, fullPart] = tokens;
  const rows = boardPart.split('/');
  if (rows.length !== 8) {
    return { valid: false, error: 'FEN board field must have exactly 8 ranks.' };
  }
  let whiteKings = 0;
  let blackKings = 0;
  for (let r = 0; r < 8; r++) {
    let fileCount = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        fileCount += parseInt(ch, 10);
      } else if ('pnbrqkPNBRQK'.includes(ch)) {
        fileCount += 1;
        if (ch === 'K') whiteKings++;
        if (ch === 'k') blackKings++;
        if ((r === 0 || r === 7) && (ch === 'p' || ch === 'P')) {
          return { valid: false, error: 'Pawns cannot exist on the 1st or 8th rank.' };
        }
      } else {
        return { valid: false, error: `Invalid character "${ch}" in FEN board.` };
      }
    }
    if (fileCount !== 8) {
      return { valid: false, error: `Rank ${8 - r} does not sum to 8 squares.` };
    }
  }
  if (whiteKings !== 1 || blackKings !== 1) {
    return { valid: false, error: 'Position must contain exactly one White King and one Black King.' };
  }
  if (turnPart !== 'w' && turnPart !== 'b') {
    return { valid: false, error: 'Side to move must be "w" or "b".' };
  }
  if (!/^(-|[KQkq]{1,4})$/.test(castlePart)) {
    return { valid: false, error: 'Invalid castling availability string.' };
  }
  if (epPart !== '-' && !/^[a-h][36]$/.test(epPart)) {
    return { valid: false, error: 'Invalid en-passant target square.' };
  }
  if (halfPart !== undefined && (!/^\d+$/.test(halfPart) || parseInt(halfPart, 10) < 0)) {
    return { valid: false, error: 'Halfmove clock must be a non-negative integer.' };
  }
  if (fullPart !== undefined && (!/^\d+$/.test(fullPart) || parseInt(fullPart, 10) < 1)) {
    return { valid: false, error: 'Fullmove number must be a positive integer.' };
  }

  try {
    const temp = new ChessGame(null);
    const ok = temp.load(fen, { skipValidationCheck: true });
    if (!ok) return { valid: false, error: 'Failed to parse FEN.' };
    const inactiveColor = temp.turn() === 'w' ? 'b' : 'w';
    if (temp.isKingAttacked(inactiveColor)) {
      return { valid: false, error: 'Illegal position: side not to move has its king in check.' };
    }
  } catch (e) {
    return { valid: false, error: e.message || 'Invalid position.' };
  }
  return { valid: true, error: null };
}

export class ChessGame {
  constructor(fen = DEFAULT_FEN) {
    this.board88 = new Array(128).fill(null);
    this.kingSq = { w: 0x74, b: 0x04 };
    this.stm = 'w';
    this.castling = 15;
    this.epSq = -1;
    this.halfMoves = 0;
    this.fullMoves = 1;
    this.hash = 0n;
    this.stateStack = [];
    this.hashHistory = [];
    this.moveHistoryList = [];
    this.redoStack = [];
    this.headers = {};
    this.initialFen = DEFAULT_FEN;
    if (fen) {
      this.load(fen, { skipValidationCheck: fen === DEFAULT_FEN });
    }
  }

  clear() {
    this.board88.fill(null);
    this.kingSq = { w: -1, b: -1 };
    this.stm = 'w';
    this.castling = 0;
    this.epSq = -1;
    this.halfMoves = 0;
    this.fullMoves = 1;
    this.stateStack = [];
    this.hashHistory = [];
    this.moveHistoryList = [];
    this.redoStack = [];
    this.headers = {};
    this.recomputeHash();
  }

  load(fen, options = {}) {
    if (!options.skipValidationCheck) {
      const v = validateFen(fen);
      if (!v.valid) return false;
    }
    const tokens = fen.trim().split(/\s+/);
    const [boardPart, turnPart, castlePart, epPart, halfPart, fullPart] = tokens;

    this.board88.fill(null);
    this.kingSq = { w: -1, b: -1 };

    const rows = boardPart.split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          f += parseInt(ch, 10);
        } else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          const type = ch.toLowerCase();
          const sq = (r << 4) | f;
          this.board88[sq] = { type, color };
          if (type === 'k') this.kingSq[color] = sq;
          f++;
        }
      }
    }

    this.stm = turnPart;
    this.castling = 0;
    if (castlePart.includes('K')) this.castling |= CASTLE_WK;
    if (castlePart.includes('Q')) this.castling |= CASTLE_WQ;
    if (castlePart.includes('k')) this.castling |= CASTLE_BK;
    if (castlePart.includes('q')) this.castling |= CASTLE_BQ;

    if (this.kingSq.w !== 0x74) this.castling &= ~(CASTLE_WK | CASTLE_WQ);
    if (!this.board88[0x77] || this.board88[0x77].type !== 'r' || this.board88[0x77].color !== 'w') {
      this.castling &= ~CASTLE_WK;
    }
    if (!this.board88[0x70] || this.board88[0x70].type !== 'r' || this.board88[0x70].color !== 'w') {
      this.castling &= ~CASTLE_WQ;
    }
    if (this.kingSq.b !== 0x04) this.castling &= ~(CASTLE_BK | CASTLE_BQ);
    if (!this.board88[0x07] || this.board88[0x07].type !== 'r' || this.board88[0x07].color !== 'b') {
      this.castling &= ~CASTLE_BK;
    }
    if (!this.board88[0x00] || this.board88[0x00].type !== 'r' || this.board88[0x00].color !== 'b') {
      this.castling &= ~CASTLE_BQ;
    }

    this.epSq = epPart === '-' ? -1 : algebraicTo88(epPart);
    this.halfMoves = halfPart ? parseInt(halfPart, 10) : 0;
    this.fullMoves = fullPart ? parseInt(fullPart, 10) : 1;

    this.stateStack = [];
    this.moveHistoryList = [];
    this.redoStack = [];
    this.recomputeHash();
    this.hashHistory = [this.hash];
    this.initialFen = this.fen();
    return true;
  }

  reset() {
    this.load(DEFAULT_FEN);
  }

  recomputeHash() {
    let h = 0n;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq88 = (r << 4) | f;
        const p = this.board88[sq88];
        if (p) {
          h ^= ZOBRIST.getPieceKey(p.color, p.type, (r << 3) | f);
        }
      }
    }
    h ^= ZOBRIST.castleKeys[this.castling];
    const epIdx = this.epSq === -1 ? 64 : sq88To64(this.epSq);
    h ^= ZOBRIST.epKeys[epIdx];
    if (this.stm === 'b') h ^= ZOBRIST.sideKey;
    this.hash = h;
    return h;
  }

  fen() {
    let boardStr = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board88[(r << 4) | f];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            boardStr += empty;
            empty = 0;
          }
          boardStr += p.color === 'w' ? p.type.toUpperCase() : p.type;
        }
      }
      if (empty > 0) boardStr += empty;
      if (r < 7) boardStr += '/';
    }

    let castleStr = '';
    if (this.castling & CASTLE_WK) castleStr += 'K';
    if (this.castling & CASTLE_WQ) castleStr += 'Q';
    if (this.castling & CASTLE_BK) castleStr += 'k';
    if (this.castling & CASTLE_BQ) castleStr += 'q';
    if (!castleStr) castleStr = '-';

    const epStr = this.epSq === -1 ? '-' : sq88ToAlgebraic(this.epSq);
    return `${boardStr} ${this.stm} ${castleStr} ${epStr} ${this.halfMoves} ${this.fullMoves}`;
  }

  turn() {
    return this.stm;
  }

  get(square) {
    const sq88 = algebraicTo88(square);
    if (sq88 === -1) return null;
    const p = this.board88[sq88];
    return p ? { type: p.type, color: p.color } : null;
  }

  put(piece, square) {
    if (!piece || !piece.type || !piece.color) return false;
    const sq88 = algebraicTo88(square);
    if (sq88 === -1) return false;
    const type = piece.type.toLowerCase();
    const color = piece.color.toLowerCase();
    if (!'pnbrqk'.includes(type) || (color !== 'w' && color !== 'b')) return false;
    this.board88[sq88] = { type, color };
    if (type === 'k') this.kingSq[color] = sq88;
    this.recomputeHash();
    this.hashHistory = [this.hash];
    return true;
  }

  remove(square) {
    const sq88 = algebraicTo88(square);
    if (sq88 === -1) return null;
    const p = this.board88[sq88];
    if (!p) return null;
    this.board88[sq88] = null;
    if (p.type === 'k') this.kingSq[p.color] = -1;
    this.recomputeHash();
    this.hashHistory = [this.hash];
    return p;
  }

  board() {
    const out = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let f = 0; f < 8; f++) {
        const sq88 = (r << 4) | f;
        const p = this.board88[sq88];
        row.push(
          p
            ? {
                square: sq88ToAlgebraic(sq88),
                type: p.type,
                color: p.color
              }
            : null
        );
      }
      out.push(row);
    }
    return out;
  }

  /**
   * Computes captured pieces for both sides and net material balance.
   * Uses moveHistoryList when available, with fallback to initial-vs-current board diff
   * for custom FEN positions without move history.
   */
  getCapturedPieces(upToPly = null) {
    const capturedByWhite = []; // Black pieces captured by White
    const capturedByBlack = []; // White pieces captured by Black

    const maxIdx = upToPly !== null ? Math.min(upToPly, this.moveHistoryList.length) : this.moveHistoryList.length;

    if (maxIdx > 0) {
      for (let i = 0; i < maxIdx; i++) {
        const mv = this.moveHistoryList[i];
        if (mv && mv.captured) {
          if (mv.color === 'w') {
            capturedByWhite.push(mv.captured);
          } else {
            capturedByBlack.push(mv.captured);
          }
        }
      }
    } else if (this.initialFen !== DEFAULT_FEN || this.moveHistoryList.length === 0) {
      // Compare standard starting counts against current board counts
      const startCounts = { w: { q: 1, r: 2, b: 2, n: 2, p: 8 }, b: { q: 1, r: 2, b: 2, n: 2, p: 8 } };
      const currentCounts = { w: { q: 0, r: 0, b: 0, n: 0, p: 0 }, b: { q: 0, r: 0, b: 0, n: 0, p: 0 } };
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = this.board88[(r << 4) | f];
          if (p && p.type !== 'k') {
            currentCounts[p.color][p.type] = (currentCounts[p.color][p.type] || 0) + 1;
          }
        }
      }
      for (const type of ['q', 'r', 'b', 'n', 'p']) {
        const missingB = Math.max(0, startCounts.b[type] - currentCounts.b[type]);
        for (let k = 0; k < missingB; k++) capturedByWhite.push(type);
        const missingW = Math.max(0, startCounts.w[type] - currentCounts.w[type]);
        for (let k = 0; k < missingW; k++) capturedByBlack.push(type);
      }
    }

    capturedByWhite.sort((a, b) => (CAPTURE_SORT_ORDER[a] || 9) - (CAPTURE_SORT_ORDER[b] || 9));
    capturedByBlack.sort((a, b) => (CAPTURE_SORT_ORDER[a] || 9) - (CAPTURE_SORT_ORDER[b] || 9));

    let whiteMat = 0;
    let blackMat = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = this.board88[(r << 4) | f];
        if (p && p.type !== 'k') {
          if (p.color === 'w') whiteMat += STANDARD_PIECE_VALUES[p.type] || 0;
          else blackMat += STANDARD_PIECE_VALUES[p.type] || 0;
        }
      }
    }

    return {
      capturedByWhite,
      capturedByBlack,
      whiteMaterial: whiteMat,
      blackMaterial: blackMat,
      netWhiteAdvantage: whiteMat - blackMat
    };
  }

  /**
   * Returns all legal promotion move objects from `fromAlg` to `toAlg` (4 choices: q, r, b, n)
   * or an empty array if moving from `fromAlg` to `toAlg` is not a legal pawn promotion.
   */
  getPromotionMoves(fromAlg, toAlg) {
    const from88 = algebraicTo88(fromAlg);
    const to88 = algebraicTo88(toAlg);
    if (from88 === -1 || to88 === -1) return [];
    const allLegal = this.moves({ verbose: true });
    return allLegal.filter(m => m.from === fromAlg && m.to === toAlg && Boolean(m.promotion));
  }

  isPromotionMove(fromAlg, toAlg) {
    return this.getPromotionMoves(fromAlg, toAlg).length > 0;
  }

  isSquareAttacked(sq88, attackerColor) {
    if (attackerColor === 'w') {
      const p1 = sq88 + 15;
      const p2 = sq88 + 17;
      if (!(p1 & 0x88)) {
        const piece = this.board88[p1];
        if (piece && piece.color === 'w' && piece.type === 'p') return true;
      }
      if (!(p2 & 0x88)) {
        const piece = this.board88[p2];
        if (piece && piece.color === 'w' && piece.type === 'p') return true;
      }
    } else {
      const p1 = sq88 - 15;
      const p2 = sq88 - 17;
      if (!(p1 & 0x88)) {
        const piece = this.board88[p1];
        if (piece && piece.color === 'b' && piece.type === 'p') return true;
      }
      if (!(p2 & 0x88)) {
        const piece = this.board88[p2];
        if (piece && piece.color === 'b' && piece.type === 'p') return true;
      }
    }

    for (let i = 0; i < 8; i++) {
      const target = sq88 + KNIGHT_OFFSETS[i];
      if (!(target & 0x88)) {
        const piece = this.board88[target];
        if (piece && piece.color === attackerColor && piece.type === 'n') return true;
      }
    }

    for (let i = 0; i < 8; i++) {
      const target = sq88 + KING_OFFSETS[i];
      if (!(target & 0x88)) {
        const piece = this.board88[target];
        if (piece && piece.color === attackerColor && piece.type === 'k') return true;
      }
    }

    for (let i = 0; i < 4; i++) {
      const step = BISHOP_OFFSETS[i];
      let target = sq88 + step;
      while (!(target & 0x88)) {
        const piece = this.board88[target];
        if (piece) {
          if (piece.color === attackerColor && (piece.type === 'b' || piece.type === 'q')) {
            return true;
          }
          break;
        }
        target += step;
      }
    }

    for (let i = 0; i < 4; i++) {
      const step = ROOK_OFFSETS[i];
      let target = sq88 + step;
      while (!(target & 0x88)) {
        const piece = this.board88[target];
        if (piece) {
          if (piece.color === attackerColor && (piece.type === 'r' || piece.type === 'q')) {
            return true;
          }
          break;
        }
        target += step;
      }
    }

    return false;
  }

  /**
   * Returns all pieces of `attackerColor` attacking `sq88`, sorted by ascending material value.
   * Used by X-Ray Attack Maps and Static Exchange Evaluation (SEE).
   */
  getAttackersOfSquare(sq88, attackerColor) {
    const attackers = [];
    if (attackerColor === 'w') {
      for (const off of [15, 17]) {
        const s = sq88 + off;
        if (!(s & 0x88)) {
          const p = this.board88[s];
          if (p && p.color === 'w' && p.type === 'p') {
            attackers.push({ from: s, square: sq88ToAlgebraic(s), type: 'p', color: 'w', value: 100 });
          }
        }
      }
    } else {
      for (const off of [-15, -17]) {
        const s = sq88 + off;
        if (!(s & 0x88)) {
          const p = this.board88[s];
          if (p && p.color === 'b' && p.type === 'p') {
            attackers.push({ from: s, square: sq88ToAlgebraic(s), type: 'p', color: 'b', value: 100 });
          }
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      const s = sq88 + KNIGHT_OFFSETS[i];
      if (!(s & 0x88)) {
        const p = this.board88[s];
        if (p && p.color === attackerColor && p.type === 'n') {
          attackers.push({ from: s, square: sq88ToAlgebraic(s), type: 'n', color: attackerColor, value: 320 });
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      const step = BISHOP_OFFSETS[i];
      let s = sq88 + step;
      while (!(s & 0x88)) {
        const p = this.board88[s];
        if (p) {
          if (p.color === attackerColor && (p.type === 'b' || p.type === 'q')) {
            attackers.push({
              from: s,
              square: sq88ToAlgebraic(s),
              type: p.type,
              color: attackerColor,
              value: SEE_PIECE_VALUES[p.type]
            });
          }
          break;
        }
        s += step;
      }
    }

    for (let i = 0; i < 4; i++) {
      const step = ROOK_OFFSETS[i];
      let s = sq88 + step;
      while (!(s & 0x88)) {
        const p = this.board88[s];
        if (p) {
          if (p.color === attackerColor && (p.type === 'r' || p.type === 'q')) {
            attackers.push({
              from: s,
              square: sq88ToAlgebraic(s),
              type: p.type,
              color: attackerColor,
              value: SEE_PIECE_VALUES[p.type]
            });
          }
          break;
        }
        s += step;
      }
    }

    for (let i = 0; i < 8; i++) {
      const s = sq88 + KING_OFFSETS[i];
      if (!(s & 0x88)) {
        const p = this.board88[s];
        if (p && p.color === attackerColor && p.type === 'k') {
          attackers.push({ from: s, square: sq88ToAlgebraic(s), type: 'k', color: attackerColor, value: 20000 });
        }
      }
    }

    attackers.sort((a, b) => a.value - b.value);
    return attackers;
  }

  /**
   * Fast Static Exchange Evaluation (SEE) in centipawns for a capture move `m`.
   * Positive/zero means winning/equal exchange; negative means losing capture.
   */
  staticExchangeEvaluation(m) {
    if (!m.captured && !m.promotion) return 0;
    const victimVal = m.captured ? SEE_PIECE_VALUES[m.captured] || 100 : 0;
    const promoGain = m.promotion ? (SEE_PIECE_VALUES[m.promotion] || 900) - 100 : 0;
    const attackerVal = m.promotion ? SEE_PIECE_VALUES[m.promotion] : SEE_PIECE_VALUES[m.piece] || 100;

    const us = m.color;
    const them = us === 'w' ? 'b' : 'w';

    const savedFrom = this.board88[m.from];
    const savedTo = this.board88[m.to];
    this.board88[m.from] = null;
    this.board88[m.to] = { type: m.promotion || m.piece, color: us };

    const enemyAttackers = this.getAttackersOfSquare(m.to, them);
    if (enemyAttackers.length === 0) {
      this.board88[m.from] = savedFrom;
      this.board88[m.to] = savedTo;
      return victimVal + promoGain;
    }

    const ourDefenders = this.getAttackersOfSquare(m.to, us);
    this.board88[m.from] = savedFrom;
    this.board88[m.to] = savedTo;

    const gain = [victimVal + promoGain];
    let currentPieceVal = attackerVal;
    let eIdx = 0;
    let dIdx = 0;
    let side = them;
    let depth = 0;

    while (depth < 12) {
      depth++;
      gain[depth] = currentPieceVal - gain[depth - 1];
      if (Math.max(-gain[depth - 1], gain[depth]) < 0) break;

      if (side === them) {
        if (eIdx >= enemyAttackers.length) break;
        currentPieceVal = enemyAttackers[eIdx++].value;
        side = us;
      } else {
        if (dIdx >= ourDefenders.length) break;
        currentPieceVal = ourDefenders[dIdx++].value;
        side = them;
      }
    }

    while (--depth > 0) {
      gain[depth - 1] = -Math.max(-gain[depth - 1], gain[depth]);
    }
    return gain[0];
  }

  isKingAttacked(color = this.stm) {
    const kSq = this.kingSq[color];
    if (kSq === -1) return false;
    const enemy = color === 'w' ? 'b' : 'w';
    return this.isSquareAttacked(kSq, enemy);
  }

  in_check() {
    return this.isKingAttacked(this.stm);
  }

  inCheck() {
    return this.isKingAttacked(this.stm);
  }

  hasNonPawnMaterial(color = this.stm) {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = this.board88[(r << 4) | f];
        if (p && p.color === color && p.type !== 'p' && p.type !== 'k') {
          return true;
        }
      }
    }
    return false;
  }

  makeNullMove() {
    const prevHash = this.hash;
    const prevEpSq = this.epSq;
    const prevHalfMoves = this.halfMoves;

    let h = this.hash;
    h ^= ZOBRIST.epKeys[this.epSq === -1 ? 64 : sq88To64(this.epSq)];
    this.epSq = -1;
    h ^= ZOBRIST.epKeys[64];
    h ^= ZOBRIST.sideKey;

    this.stm = this.stm === 'w' ? 'b' : 'w';
    this.halfMoves++;
    this.hash = h;

    this.stateStack.push({
      isNull: true,
      hash: prevHash,
      epSq: prevEpSq,
      halfMoves: prevHalfMoves
    });
    this.hashHistory.push(h);
  }

  unmakeNullMove() {
    const state = this.stateStack.pop();
    if (!state || !state.isNull) return;
    this.hashHistory.pop();
    this.stm = this.stm === 'w' ? 'b' : 'w';
    this.hash = state.hash;
    this.epSq = state.epSq;
    this.halfMoves = state.halfMoves;
  }

  generatePseudoMoves(onlyCaptures = false, fromSquareFilter = -1) {
    const moves = [];
    const us = this.stm;
    const them = us === 'w' ? 'b' : 'w';
    const pawnDir = us === 'w' ? -16 : 16;
    const startRank = us === 'w' ? 6 : 1;
    const promoRank = us === 'w' ? 0 : 7;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = (r << 4) | f;
        if (fromSquareFilter !== -1 && sq !== fromSquareFilter) continue;
        const piece = this.board88[sq];
        if (!piece || piece.color !== us) continue;

        const type = piece.type;
        if (type === 'p') {
          const capOffsets = us === 'w' ? [-17, -15] : [15, 17];
          for (let i = 0; i < 2; i++) {
            const to = sq + capOffsets[i];
            if (to & 0x88) continue;
            const target = this.board88[to];
            const toRank = to >> 4;
            if (target && target.color === them) {
              if (toRank === promoRank) {
                for (const promo of ['q', 'r', 'b', 'n']) {
                  moves.push({ from: sq, to, piece: 'p', color: us, captured: target.type, promotion: promo, flags: 'cp' });
                }
              } else {
                moves.push({ from: sq, to, piece: 'p', color: us, captured: target.type, promotion: null, flags: 'c' });
              }
            } else if (to === this.epSq) {
              moves.push({ from: sq, to, piece: 'p', color: us, captured: 'p', promotion: null, flags: 'e' });
            }
          }

          const oneStep = sq + pawnDir;
          if (!(oneStep & 0x88) && !this.board88[oneStep]) {
            const toRank = oneStep >> 4;
            if (toRank === promoRank) {
              for (const promo of ['q', 'r', 'b', 'n']) {
                moves.push({ from: sq, to: oneStep, piece: 'p', color: us, captured: null, promotion: promo, flags: 'p' });
              }
            } else if (!onlyCaptures) {
              moves.push({ from: sq, to: oneStep, piece: 'p', color: us, captured: null, promotion: null, flags: 'n' });
              if (r === startRank) {
                const twoStep = sq + pawnDir * 2;
                if (!this.board88[twoStep]) {
                  moves.push({ from: sq, to: twoStep, piece: 'p', color: us, captured: null, promotion: null, flags: 'b' });
                }
              }
            }
          }
        } else if (type === 'n') {
          for (let i = 0; i < 8; i++) {
            const to = sq + KNIGHT_OFFSETS[i];
            if (to & 0x88) continue;
            const target = this.board88[to];
            if (!target) {
              if (!onlyCaptures) {
                moves.push({ from: sq, to, piece: 'n', color: us, captured: null, promotion: null, flags: 'n' });
              }
            } else if (target.color === them) {
              moves.push({ from: sq, to, piece: 'n', color: us, captured: target.type, promotion: null, flags: 'c' });
            }
          }
        } else if (type === 'k') {
          for (let i = 0; i < 8; i++) {
            const to = sq + KING_OFFSETS[i];
            if (to & 0x88) continue;
            const target = this.board88[to];
            if (!target) {
              if (!onlyCaptures) {
                moves.push({ from: sq, to, piece: 'k', color: us, captured: null, promotion: null, flags: 'n' });
              }
            } else if (target.color === them) {
              moves.push({ from: sq, to, piece: 'k', color: us, captured: target.type, promotion: null, flags: 'c' });
            }
          }
          if (!onlyCaptures) {
            if (us === 'w' && sq === 0x74) {
              if ((this.castling & CASTLE_WK) && !this.board88[0x75] && !this.board88[0x76]) {
                if (!this.isSquareAttacked(0x74, 'b') && !this.isSquareAttacked(0x75, 'b') && !this.isSquareAttacked(0x76, 'b')) {
                  moves.push({ from: 0x74, to: 0x76, piece: 'k', color: 'w', captured: null, promotion: null, flags: 'k' });
                }
              }
              if ((this.castling & CASTLE_WQ) && !this.board88[0x73] && !this.board88[0x72] && !this.board88[0x71]) {
                if (!this.isSquareAttacked(0x74, 'b') && !this.isSquareAttacked(0x73, 'b') && !this.isSquareAttacked(0x72, 'b')) {
                  moves.push({ from: 0x74, to: 0x72, piece: 'k', color: 'w', captured: null, promotion: null, flags: 'q' });
                }
              }
            } else if (us === 'b' && sq === 0x04) {
              if ((this.castling & CASTLE_BK) && !this.board88[0x05] && !this.board88[0x06]) {
                if (!this.isSquareAttacked(0x04, 'w') && !this.isSquareAttacked(0x05, 'w') && !this.isSquareAttacked(0x06, 'w')) {
                  moves.push({ from: 0x04, to: 0x06, piece: 'k', color: 'b', captured: null, promotion: null, flags: 'k' });
                }
              }
              if ((this.castling & CASTLE_BQ) && !this.board88[0x03] && !this.board88[0x02] && !this.board88[0x01]) {
                if (!this.isSquareAttacked(0x04, 'w') && !this.isSquareAttacked(0x03, 'w') && !this.isSquareAttacked(0x02, 'w')) {
                  moves.push({ from: 0x04, to: 0x02, piece: 'k', color: 'b', captured: null, promotion: null, flags: 'q' });
                }
              }
            }
          }
        } else {
          const offsets = type === 'b' ? BISHOP_OFFSETS : type === 'r' ? ROOK_OFFSETS : QUEEN_OFFSETS;
          for (let i = 0; i < offsets.length; i++) {
            const step = offsets[i];
            let to = sq + step;
            while (!(to & 0x88)) {
              const target = this.board88[to];
              if (!target) {
                if (!onlyCaptures) {
                  moves.push({ from: sq, to, piece: type, color: us, captured: null, promotion: null, flags: 'n' });
                }
              } else {
                if (target.color === them) {
                  moves.push({ from: sq, to, piece: type, color: us, captured: target.type, promotion: null, flags: 'c' });
                }
                break;
              }
              to += step;
            }
          }
        }
      }
    }

    return moves;
  }

  makeMoveRaw(m) {
    const us = m.color;
    const them = us === 'w' ? 'b' : 'w';
    const prevHash = this.hash;
    const prevCastling = this.castling;
    const prevEpSq = this.epSq;
    const prevHalfMoves = this.halfMoves;
    const prevFullMoves = this.fullMoves;

    let h = this.hash;
    h ^= ZOBRIST.castleKeys[this.castling];
    h ^= ZOBRIST.epKeys[this.epSq === -1 ? 64 : sq88To64(this.epSq)];

    const from64 = sq88To64(m.from);
    const to64 = sq88To64(m.to);

    h ^= ZOBRIST.getPieceKey(us, m.piece, from64);
    this.board88[m.from] = null;

    if (m.flags === 'e') {
      const capSq = us === 'w' ? m.to + 16 : m.to - 16;
      this.board88[capSq] = null;
      h ^= ZOBRIST.getPieceKey(them, 'p', sq88To64(capSq));
    } else if (m.captured) {
      h ^= ZOBRIST.getPieceKey(them, m.captured, to64);
    }

    const placedType = m.promotion ? m.promotion : m.piece;
    this.board88[m.to] = { type: placedType, color: us };
    h ^= ZOBRIST.getPieceKey(us, placedType, to64);

    if (m.piece === 'k') {
      this.kingSq[us] = m.to;
      if (m.flags === 'k') {
        const rookFrom = us === 'w' ? 0x77 : 0x07;
        const rookTo = us === 'w' ? 0x75 : 0x05;
        this.board88[rookFrom] = null;
        this.board88[rookTo] = { type: 'r', color: us };
        h ^= ZOBRIST.getPieceKey(us, 'r', sq88To64(rookFrom));
        h ^= ZOBRIST.getPieceKey(us, 'r', sq88To64(rookTo));
      } else if (m.flags === 'q') {
        const rookFrom = us === 'w' ? 0x70 : 0x00;
        const rookTo = us === 'w' ? 0x73 : 0x03;
        this.board88[rookFrom] = null;
        this.board88[rookTo] = { type: 'r', color: us };
        h ^= ZOBRIST.getPieceKey(us, 'r', sq88To64(rookFrom));
        h ^= ZOBRIST.getPieceKey(us, 'r', sq88To64(rookTo));
      }
    }

    this.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
    h ^= ZOBRIST.castleKeys[this.castling];

    if (m.flags === 'b') {
      this.epSq = us === 'w' ? m.from - 16 : m.from + 16;
    } else {
      this.epSq = -1;
    }
    h ^= ZOBRIST.epKeys[this.epSq === -1 ? 64 : sq88To64(this.epSq)];

    if (m.piece === 'p' || m.captured) {
      this.halfMoves = 0;
    } else {
      this.halfMoves++;
    }
    if (us === 'b') this.fullMoves++;

    this.stm = them;
    h ^= ZOBRIST.sideKey;
    this.hash = h;

    const stateObj = {
      move: m,
      hash: prevHash,
      castling: prevCastling,
      epSq: prevEpSq,
      halfMoves: prevHalfMoves,
      fullMoves: prevFullMoves,
      recordedRep: false
    };
    this.stateStack.push(stateObj);

    if (this.isKingAttacked(us)) {
      this.unmakeMoveRaw();
      return false;
    }

    stateObj.recordedRep = true;
    this.hashHistory.push(h);
    return true;
  }

  unmakeMoveRaw() {
    const state = this.stateStack.pop();
    if (!state) return null;

    if (state.recordedRep) {
      this.hashHistory.pop();
    }

    const m = state.move;
    const us = m.color;
    const them = us === 'w' ? 'b' : 'w';

    this.stm = us;
    this.hash = state.hash;
    this.castling = state.castling;
    this.epSq = state.epSq;
    this.halfMoves = state.halfMoves;
    this.fullMoves = state.fullMoves;

    this.board88[m.from] = { type: m.piece, color: us };
    if (m.piece === 'k') {
      this.kingSq[us] = m.from;
      if (m.flags === 'k') {
        const rookFrom = us === 'w' ? 0x77 : 0x07;
        const rookTo = us === 'w' ? 0x75 : 0x05;
        this.board88[rookFrom] = { type: 'r', color: us };
        this.board88[rookTo] = null;
      } else if (m.flags === 'q') {
        const rookFrom = us === 'w' ? 0x70 : 0x00;
        const rookTo = us === 'w' ? 0x73 : 0x03;
        this.board88[rookFrom] = { type: 'r', color: us };
        this.board88[rookTo] = null;
      }
    }

    if (m.flags === 'e') {
      this.board88[m.to] = null;
      const capSq = us === 'w' ? m.to + 16 : m.to - 16;
      this.board88[capSq] = { type: 'p', color: them };
    } else if (m.captured) {
      this.board88[m.to] = { type: m.captured, color: them };
    } else {
      this.board88[m.to] = null;
    }

    return m;
  }

  generateLegalMovesRaw(onlyCaptures = false, fromSquareFilter = -1) {
    const pseudo = this.generatePseudoMoves(onlyCaptures, fromSquareFilter);
    const legal = [];
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      if (this.makeMoveRaw(m)) {
        legal.push(m);
        this.unmakeMoveRaw();
      }
    }
    return legal;
  }

  moveToSan(m, allLegalRaw) {
    let san = '';
    if (m.flags === 'k') {
      san = 'O-O';
    } else if (m.flags === 'q') {
      san = 'O-O-O';
    } else {
      if (m.piece !== 'p') {
        san += m.piece.toUpperCase();
        let samePieceMoves = 0;
        let sameFile = 0;
        let sameRank = 0;
        const fromFile = m.from & 7;
        const fromRank = m.from >> 4;
        for (let i = 0; i < allLegalRaw.length; i++) {
          const other = allLegalRaw[i];
          if (other.from !== m.from && other.to === m.to && other.piece === m.piece) {
            samePieceMoves++;
            if ((other.from & 7) === fromFile) sameFile++;
            if ((other.from >> 4) === fromRank) sameRank++;
          }
        }
        if (samePieceMoves > 0) {
          if (sameFile === 0) {
            san += FILES[fromFile];
          } else if (sameRank === 0) {
            san += RANKS[fromRank];
          } else {
            san += sq88ToAlgebraic(m.from);
          }
        }
      } else if (m.captured) {
        san += FILES[m.from & 7];
      }

      if (m.captured) san += 'x';
      san += sq88ToAlgebraic(m.to);
      if (m.promotion) san += '=' + m.promotion.toUpperCase();
    }

    this.makeMoveRaw(m);
    if (this.in_check()) {
      const replies = this.generateLegalMovesRaw(false);
      san += replies.length === 0 ? '#' : '+';
    }
    this.unmakeMoveRaw();
    return san;
  }

  moves(options = {}) {
    let filterSq = -1;
    if (options.square) {
      filterSq = algebraicTo88(options.square);
      if (filterSq === -1) return [];
    }
    const allLegal = this.generateLegalMovesRaw(false);
    const targetLegal = filterSq === -1 ? allLegal : allLegal.filter(m => m.from === filterSq);

    if (!options.verbose) {
      return targetLegal.map(m => this.moveToSan(m, allLegal));
    }

    return targetLegal.map(m => {
      const san = this.moveToSan(m, allLegal);
      const fromAlg = sq88ToAlgebraic(m.from);
      const toAlg = sq88ToAlgebraic(m.to);
      return {
        color: m.color,
        from: fromAlg,
        to: toAlg,
        flags: m.flags,
        piece: m.piece,
        captured: m.captured || undefined,
        promotion: m.promotion || undefined,
        san,
        lan: fromAlg + toAlg + (m.promotion || ''),
        raw: m
      };
    });
  }

  move(moveInput, options = {}) {
    if (!moveInput) return null;
    const allLegal = this.generateLegalMovesRaw(false);
    let chosenRaw = null;
    let chosenSan = null;

    if (typeof moveInput === 'string') {
      const cleanInput = moveInput
        .trim()
        .replace(/[+#!?]+$/g, '')
        .replace(/0-0-0/g, 'O-O-O')
        .replace(/0-0/g, 'O-O');
      const normalizedNoEq = cleanInput.replace(/=([QRBNqrbn])$/, (_, p) => '=' + p.toUpperCase());
      for (let i = 0; i < allLegal.length; i++) {
        const m = allLegal[i];
        const san = this.moveToSan(m, allLegal);
        const cleanSan = san.replace(/[+#!?]+$/g, '');
        const cleanSanNoEq = cleanSan.replace('=', '');
        const lan = sq88ToAlgebraic(m.from) + sq88ToAlgebraic(m.to) + (m.promotion || '');
        if (
          san === moveInput.trim() ||
          cleanSan === cleanInput ||
          cleanSan === normalizedNoEq ||
          cleanSanNoEq === cleanInput ||
          lan.toLowerCase() === cleanInput.toLowerCase()
        ) {
          chosenRaw = m;
          chosenSan = san;
          break;
        }
      }
    } else if (typeof moveInput === 'object') {
      const from88 = typeof moveInput.from === 'number' ? moveInput.from : algebraicTo88(moveInput.from);
      const to88 = typeof moveInput.to === 'number' ? moveInput.to : algebraicTo88(moveInput.to);
      const promo = moveInput.promotion ? moveInput.promotion.toLowerCase() : null;
      for (let i = 0; i < allLegal.length; i++) {
        const m = allLegal[i];
        if (m.from === from88 && m.to === to88) {
          if (m.promotion) {
            if (options.requireExplicitPromotion && !promo) {
              return null;
            }
            if ((promo || 'q') === m.promotion) {
              chosenRaw = m;
              chosenSan = this.moveToSan(m, allLegal);
              break;
            }
          } else {
            if (promo) continue;
            chosenRaw = m;
            chosenSan = this.moveToSan(m, allLegal);
            break;
          }
        }
      }
    }

    if (!chosenRaw) return null;

    const beforeFen = this.fen();
    this.makeMoveRaw(chosenRaw);
    const afterFen = this.fen();

    const fromAlg = sq88ToAlgebraic(chosenRaw.from);
    const toAlg = sq88ToAlgebraic(chosenRaw.to);

    const verboseMove = {
      color: chosenRaw.color,
      from: fromAlg,
      to: toAlg,
      flags: chosenRaw.flags,
      piece: chosenRaw.piece,
      captured: chosenRaw.captured || undefined,
      promotion: chosenRaw.promotion || undefined,
      san: chosenSan,
      lan: fromAlg + toAlg + (chosenRaw.promotion || ''),
      before: beforeFen,
      after: afterFen,
      raw: chosenRaw
    };

    this.moveHistoryList.push(verboseMove);
    if (!options.preserveRedo) {
      this.redoStack = [];
    }
    return verboseMove;
  }

  undo() {
    if (this.moveHistoryList.length === 0) return null;
    const lastVerbose = this.moveHistoryList.pop();
    this.unmakeMoveRaw();
    this.redoStack.push(lastVerbose);
    return lastVerbose;
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const nextVerbose = this.redoStack.pop();
    const applied = this.move(
      { from: nextVerbose.from, to: nextVerbose.to, promotion: nextVerbose.promotion },
      { preserveRedo: true }
    );
    return applied;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Reconstructs an authoritative ChessGame instance at any historical ply (0 .. moveHistoryList.length).
   */
  getPositionAtPly(targetPly) {
    const clampedPly = Math.max(0, Math.min(this.moveHistoryList.length, targetPly));
    const copy = new ChessGame(this.initialFen);
    for (let i = 0; i < clampedPly; i++) {
      const m = this.moveHistoryList[i];
      copy.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
    return copy;
  }

  history(options = {}) {
    if (options.verbose) {
      return this.moveHistoryList.map(m => ({ ...m }));
    }
    return this.moveHistoryList.map(m => m.san);
  }

  in_checkmate() {
    if (!this.in_check()) return false;
    return this.generateLegalMovesRaw(false).length === 0;
  }

  isCheckmate() {
    return this.in_checkmate();
  }

  in_stalemate() {
    if (this.in_check()) return false;
    return this.generateLegalMovesRaw(false).length === 0;
  }

  isStalemate() {
    return this.in_stalemate();
  }

  insufficient_material() {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = (r << 4) | f;
        const p = this.board88[sq];
        if (p && p.type !== 'k') {
          if (p.type === 'p' || p.type === 'r' || p.type === 'q') return false;
          pieces.push({ ...p, sqColor: (r + f) & 1 });
        }
      }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) return true;
    if (pieces.length === 2) {
      if (pieces[0].type === 'b' && pieces[1].type === 'b' && pieces[0].sqColor === pieces[1].sqColor) {
        return true;
      }
    }
    return false;
  }

  isInsufficientMaterial() {
    return this.insufficient_material();
  }

  in_threefold_repetition() {
    if (this.halfMoves < 4) return false;
    const target = this.hash;
    const len = this.hashHistory.length;
    const minIdx = Math.max(0, len - 1 - this.halfMoves);
    let count = 1;
    for (let i = len - 3; i >= minIdx; i -= 2) {
      if (this.hashHistory[i] === target) {
        count++;
        if (count >= 3) return true;
      }
    }
    return false;
  }

  isSearchRepetition(rootHistoryLength = 1) {
    if (this.halfMoves < 4) return false;
    const target = this.hash;
    const len = this.hashHistory.length;
    const minIdx = Math.max(0, len - 1 - this.halfMoves);
    let count = 1;
    for (let i = len - 3; i >= minIdx; i -= 2) {
      if (this.hashHistory[i] === target) {
        if (i >= rootHistoryLength - 1) return true;
        count++;
        if (count >= 3) return true;
      }
    }
    return false;
  }

  isThreefoldRepetition() {
    return this.in_threefold_repetition();
  }

  in_fifty_move_rule() {
    return this.halfMoves >= 100;
  }

  isFiftyMoveRule() {
    return this.in_fifty_move_rule();
  }

  in_draw() {
    return (
      this.in_fifty_move_rule() ||
      this.in_stalemate() ||
      this.insufficient_material() ||
      this.in_threefold_repetition()
    );
  }

  isDraw() {
    return this.in_draw();
  }

  game_over() {
    return this.in_checkmate() || this.in_draw();
  }

  isGameOver() {
    return this.game_over();
  }

  header(...args) {
    for (let i = 0; i < args.length; i += 2) {
      if (typeof args[i] === 'string' && typeof args[i + 1] === 'string') {
        this.headers[args[i]] = args[i + 1];
      }
    }
    return this.headers;
  }

  pgn(options = {}) {
    const newline = options.newline_char || '\n';
    const lines = [];
    const hdrs = { ...this.headers };
    if (this.initialFen !== DEFAULT_FEN) {
      hdrs.SetUp = '1';
      hdrs.FEN = this.initialFen;
    }
    for (const [k, v] of Object.entries(hdrs)) {
      lines.push(`[${k} "${v}"]`);
    }
    if (lines.length > 0) lines.push('');

    const startTurn = this.initialFen.split(' ')[1] || 'w';
    const startMoveNum = parseInt(this.initialFen.split(' ')[5] || '1', 10);

    const moveTokens = [];
    for (let i = 0; i < this.moveHistoryList.length; i++) {
      const m = this.moveHistoryList[i];
      if (i === 0 && startTurn === 'b') {
        moveTokens.push(`${startMoveNum}... ${m.san}`);
      } else if (m.color === 'w') {
        const moveNum = startMoveNum + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
        moveTokens.push(`${moveNum}. ${m.san}`);
      } else {
        moveTokens.push(m.san);
      }
    }

    if (hdrs.Result) {
      moveTokens.push(hdrs.Result);
    } else if (this.in_checkmate()) {
      moveTokens.push(this.stm === 'w' ? '0-1' : '1-0');
    } else if (this.in_draw()) {
      moveTokens.push('1/2-1/2');
    }

    lines.push(moveTokens.join(' ').trim());
    return lines.join(newline).trim();
  }

  load_pgn(pgnString) {
    if (!pgnString || typeof pgnString !== 'string') return false;
    if (pgnString.length > 100000) return false;
    const headers = {};
    const headerRegex = /^\s*\[\s*([A-Za-z0-9_]+)\s+"([^"]*)"\s*\]\s*$/gm;
    let match;
    while ((match = headerRegex.exec(pgnString)) !== null) {
      headers[match[1]] = match[2];
    }

    let startFen = DEFAULT_FEN;
    if (headers.FEN && (headers.SetUp === '1' || headers.FEN !== DEFAULT_FEN)) {
      const v = validateFen(headers.FEN);
      if (!v.valid) return false;
      startFen = headers.FEN;
    }

    let body = pgnString.replace(/^\s*\[[^\]]*\]\s*$/gm, '');
    body = body.replace(/\{[^}]*\}/g, ' ');
    body = body.replace(/;[^\n]*/g, ' ');
    let prevBody;
    let guard = 0;
    do {
      prevBody = body;
      body = body.replace(/\([^()]*\)/g, ' ');
      guard++;
    } while (body !== prevBody && guard < 20);

    body = body.replace(/\$\d+/g, ' ');
    body = body.replace(/\b\d+\.(\.\.)?/g, ' ');
    body = body.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\s*$/g, ' ');

    const tokens = body
      .trim()
      .split(/\s+/)
      .filter(t => t && !['1-0', '0-1', '1/2-1/2', '*'].includes(t));

    if (tokens.length > 1000) return false;

    const temp = new ChessGame(startFen);
    for (const tok of tokens) {
      const moved = temp.move(tok);
      if (!moved) return false;
    }

    this.load(startFen);
    this.headers = headers;
    for (const tok of tokens) {
      this.move(tok);
    }
    return true;
  }

  loadPgn(pgnString) {
    return this.load_pgn(pgnString);
  }

  perft(depth) {
    if (depth === 0) return 1;
    const moves = this.generatePseudoMoves(false);
    let nodes = 0;
    for (let i = 0; i < moves.length; i++) {
      if (this.makeMoveRaw(moves[i])) {
        nodes += depth === 1 ? 1 : this.perft(depth - 1);
        this.unmakeMoveRaw();
      }
    }
    return nodes;
  }
}
