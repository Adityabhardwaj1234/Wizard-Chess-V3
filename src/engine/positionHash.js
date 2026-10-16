/**
 * Incremental 64-bit Zobrist Hashing for Cathedral Engine
 * Uses deterministic splitmix64 PRNG so keys are identical across main thread and Web Worker.
 */

export const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];
export const PIECE_INDEX = {
  wp: 0, wn: 1, wb: 2, wr: 3, wq: 4, wk: 5,
  bp: 6, bn: 7, bb: 8, br: 9, bq: 10, bk: 11
};

// Castle rights bitmask: WK=1, WQ=2, BK=4, BQ=8 (0..15)
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

class ZobristTables {
  constructor() {
    let seed = 0x9E3779B97F4A7C15n;
    const nextRand64 = () => {
      seed = (seed + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
      let z = seed;
      z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
      z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
      return (z ^ (z >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
    };

    // 12 piece types * 64 squares
    this.pieceKeys = Array.from({ length: 12 }, () =>
      Array.from({ length: 64 }, () => nextRand64())
    );
    // 16 castling states
    this.castleKeys = Array.from({ length: 16 }, () => nextRand64());
    // 65 en-passant states (0..63 square, 64 = none)
    this.epKeys = Array.from({ length: 65 }, () => nextRand64());
    // Side to move (black to move XORs sideKey)
    this.sideKey = nextRand64();
  }

  getPieceKey(color, type, sq64) {
    const idx = PIECE_INDEX[color + type];
    return this.pieceKeys[idx][sq64];
  }
}

export const ZOBRIST = new ZobristTables();
