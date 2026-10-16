/**
 * Bounded Transposition Table for Cathedral Engine
 * Stores Zobrist position keys, search depth, normalized mate scores,
 * bound types (EXACT, LOWER_BOUND, UPPER_BOUND), best move, and generation.
 */

export const TT_EXACT = 0;
export const TT_LOWER = 1;
export const TT_UPPER = 2;

export const MATE_SCORE = 29000;
export const MATE_THRESHOLD = 28000;

export function scoreToTT(score, ply) {
  if (score > MATE_THRESHOLD) return score + ply;
  if (score < -MATE_THRESHOLD) return score - ply;
  return score;
}

export function scoreFromTT(score, ply) {
  if (score > MATE_THRESHOLD) return score - ply;
  if (score < -MATE_THRESHOLD) return score + ply;
  return score;
}

export function encodeMoveKey(m) {
  if (!m) return 0;
  const promoCode = m.promotion
    ? m.promotion === 'q'
      ? 1
      : m.promotion === 'r'
      ? 2
      : m.promotion === 'b'
      ? 3
      : 4
    : 0;
  return (m.from & 0x7f) | ((m.to & 0x7f) << 7) | (promoCode << 14);
}

export class TranspositionTable {
  constructor(sizePowerOfTwo = 1 << 17) {
    this.size = sizePowerOfTwo;
    this.mask = BigInt(sizePowerOfTwo - 1);
    this.keys = new BigUint64Array(sizePowerOfTwo);
    this.depths = new Int16Array(sizePowerOfTwo);
    this.scores = new Int32Array(sizePowerOfTwo);
    this.bounds = new Uint8Array(sizePowerOfTwo);
    this.bestMoves = new Uint32Array(sizePowerOfTwo);
    this.ages = new Uint8Array(sizePowerOfTwo);
    this.generation = 1;
  }

  newSearch() {
    this.generation = (this.generation + 1) & 0xff;
  }

  clear() {
    this.keys.fill(0n);
    this.depths.fill(-1);
    this.scores.fill(0);
    this.bounds.fill(0);
    this.bestMoves.fill(0);
    this.ages.fill(0);
  }

  probe(hash) {
    const idx = Number(hash & this.mask);
    if (this.depths[idx] !== -1 && this.keys[idx] === hash) {
      return {
        depth: this.depths[idx],
        score: this.scores[idx],
        bound: this.bounds[idx],
        bestMoveKey: this.bestMoves[idx]
      };
    }
    return null;
  }

  store(hash, depth, score, bound, bestMove, ply) {
    const idx = Number(hash & this.mask);
    const existingDepth = this.depths[idx];
    const existingAge = this.ages[idx];

    // Replace if empty, older search generation, exact bound, or deeper/equal search
    if (
      existingDepth === -1 ||
      existingAge !== this.generation ||
      this.keys[idx] !== hash ||
      depth >= existingDepth ||
      bound === TT_EXACT
    ) {
      this.keys[idx] = hash;
      this.depths[idx] = depth;
      this.scores[idx] = scoreToTT(score, ply);
      this.bounds[idx] = bound;
      if (bestMove) {
        this.bestMoves[idx] = encodeMoveKey(bestMove);
      } else if (this.keys[idx] !== hash) {
        this.bestMoves[idx] = 0;
      }
      this.ages[idx] = this.generation;
    }
  }
}
