/**
 * Move Ordering for Cathedral Ultra & Experimental Engine
 * Prioritizes:
 * 1. Transposition Table Best Move (+2,000,000)
 * 2. Pawn Promotions (+900,000)
 * 3. Winning/Equal Captures via SEE & MVV-LVA (+250,000 + SEE)
 * 4. Killer Moves (2 slots per ply, +130,000 / +120,000)
 * 5. Countermove Heuristic (+110,000)
 * 6. History Heuristic (+0..40,000) & PST positional gain
 * 7. Losing Captures via SEE < 0 (-50,000 + SEE)
 */

import { PIECE_VALUES_MG, getPstValue } from './evaluation.js';
import { encodeMoveKey } from './transpositionTable.js';
import { sq88To64 } from '../game/ChessGame.js';

export const MAX_PLY = 64;

export class MoveOrderer {
  constructor() {
    this.killers = Array.from({ length: MAX_PLY }, () => [0, 0]);
    this.counterMoves = new Int32Array(64 * 64);
    this.history = {
      w: new Int32Array(64 * 64),
      b: new Int32Array(64 * 64)
    };
  }

  clear() {
    for (let i = 0; i < MAX_PLY; i++) {
      this.killers[i][0] = 0;
      this.killers[i][1] = 0;
    }
    this.counterMoves.fill(0);
    this.history.w.fill(0);
    this.history.b.fill(0);
  }

  decayHistory() {
    for (let i = 0; i < 4096; i++) {
      this.history.w[i] >>= 1;
      this.history.b[i] >>= 1;
    }
  }

  recordKiller(ply, move) {
    if (ply >= MAX_PLY || move.captured || move.promotion) return;
    const key = encodeMoveKey(move);
    if (this.killers[ply][0] !== key) {
      this.killers[ply][1] = this.killers[ply][0];
      this.killers[ply][0] = key;
    }
  }

  recordCounterMove(prevMove, move) {
    if (!prevMove || !move || move.captured || move.promotion) return;
    const pFrom64 = sq88To64(prevMove.from);
    const pTo64 = sq88To64(prevMove.to);
    this.counterMoves[(pFrom64 << 6) | pTo64] = encodeMoveKey(move);
  }

  recordHistory(move, depth) {
    if (move.captured || move.promotion) return;
    const from64 = sq88To64(move.from);
    const to64 = sq88To64(move.to);
    const idx = (from64 << 6) | to64;
    const bonus = depth * depth;
    const table = this.history[move.color];
    table[idx] = Math.min(40000, table[idx] + bonus);
  }

  scoreMoves(moves, ttBestMoveKey, ply, game = null, prevMove = null) {
    const k0 = ply < MAX_PLY ? this.killers[ply][0] : 0;
    const k1 = ply < MAX_PLY ? this.killers[ply][1] : 0;
    let counterKey = 0;
    if (prevMove) {
      const pf = sq88To64(prevMove.from);
      const pt = sq88To64(prevMove.to);
      counterKey = this.counterMoves[(pf << 6) | pt];
    }

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const key = encodeMoveKey(m);

      if (ttBestMoveKey && key === ttBestMoveKey) {
        m.orderScore = 2000000;
        continue;
      }

      let s = 0;
      if (m.promotion) {
        s += 900000 + (PIECE_VALUES_MG[m.promotion] || 900);
      }

      if (m.captured) {
        const victimVal = PIECE_VALUES_MG[m.captured] || 100;
        const attackerVal = PIECE_VALUES_MG[m.piece] || 100;
        const mvvLva = victimVal * 12 - attackerVal;
        if (game && victimVal < attackerVal) {
          const seeScore = game.staticExchangeEvaluation(m);
          m.seeScore = seeScore;
          if (seeScore >= 0) {
            s += 250000 + mvvLva + seeScore;
          } else {
            s += -50000 + seeScore;
          }
        } else {
          m.seeScore = victimVal - attackerVal;
          s += 250000 + mvvLva;
        }
      } else {
        if (key === k0) {
          s += 130000;
        } else if (key === k1) {
          s += 120000;
        } else if (counterKey && key === counterKey) {
          s += 110000;
        } else {
          const from64 = sq88To64(m.from);
          const to64 = sq88To64(m.to);
          const hist = this.history[m.color][(from64 << 6) | to64];
          const pstDelta =
            getPstValue(m.piece, m.color, to64, false) -
            getPstValue(m.piece, m.color, from64, false);
          s += hist + pstDelta;
        }
      }
      m.orderScore = s;
    }

    moves.sort((a, b) => b.orderScore - a.orderScore);
    return moves;
  }
}
