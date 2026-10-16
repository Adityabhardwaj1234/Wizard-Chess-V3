/**
 * Cathedral Ultra & Experimental Learning Engine — Zero-Allocation Parameterized Evaluation
 * Uses static typed-array scratchpads in the fast search path (`detailed = false`)
 * so zero heap objects or arrays are allocated per leaf evaluation node.
 */

import { sq88ToAlgebraic, KNIGHT_OFFSETS } from '../game/ChessGame.js';

export const DEFAULT_EVAL_PARAMS = {
  pawnMg: 100,
  knightMg: 320,
  bishopMg: 335,
  rookMg: 500,
  queenMg: 920,
  pawnEg: 115,
  knightEg: 310,
  bishopEg: 340,
  rookEg: 530,
  queenEg: 940,
  pstScaleMg: 100,
  pstScaleEg: 100,
  bishopPairMg: 34,
  bishopPairEg: 46,
  mobilityWeight: 4,
  kingShieldBonus: 13,
  kingZoneAttack: 11,
  isolatedPawnPen: 14,
  doubledPawnPen: 14,
  passedPawnScale: 105,
  rookOpenFile: 24,
  rookSeventh: 24,
  outpostBonus: 18,
  tempoBonus: 12
};

export const PARAM_BOUNDS = {
  pawnMg: { min: 85, max: 115, label: 'Pawn Value (MG)' },
  knightMg: { min: 280, max: 360, label: 'Knight Value (MG)' },
  bishopMg: { min: 295, max: 375, label: 'Bishop Value (MG)' },
  rookMg: { min: 450, max: 560, label: 'Rook Value (MG)' },
  queenMg: { min: 860, max: 1020, label: 'Queen Value (MG)' },
  pawnEg: { min: 95, max: 140, label: 'Pawn Value (EG)' },
  knightEg: { min: 270, max: 350, label: 'Knight Value (EG)' },
  bishopEg: { min: 300, max: 380, label: 'Bishop Value (EG)' },
  rookEg: { min: 480, max: 590, label: 'Rook Value (EG)' },
  queenEg: { min: 880, max: 1040, label: 'Queen Value (EG)' },
  pstScaleMg: { min: 70, max: 135, label: 'PST Weight (MG %)' },
  pstScaleEg: { min: 70, max: 135, label: 'PST Weight (EG %)' },
  bishopPairMg: { min: 15, max: 60, label: 'Bishop Pair (MG)' },
  bishopPairEg: { min: 20, max: 75, label: 'Bishop Pair (EG)' },
  mobilityWeight: { min: 1, max: 9, label: 'Piece Mobility' },
  kingShieldBonus: { min: 5, max: 28, label: 'King Pawn Shield' },
  kingZoneAttack: { min: 4, max: 26, label: 'King Attack Pressure' },
  isolatedPawnPen: { min: 5, max: 28, label: 'Isolated Pawn Penalty' },
  doubledPawnPen: { min: 5, max: 28, label: 'Doubled Pawn Penalty' },
  passedPawnScale: { min: 70, max: 150, label: 'Passed Pawn Scale (%)' },
  rookOpenFile: { min: 10, max: 42, label: 'Rook Open File' },
  rookSeventh: { min: 10, max: 45, label: 'Rook on 7th Rank' },
  outpostBonus: { min: 6, max: 35, label: 'Knight/Bishop Outpost' },
  tempoBonus: { min: 5, max: 22, label: 'Side-to-Move Tempo' }
};

export const PIECE_VALUES_MG = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 920,
  k: 20000
};

export const PIECE_VALUES_EG = {
  p: 115,
  n: 310,
  b: 340,
  r: 530,
  q: 940,
  k: 20000
};

export const PHASE_WEIGHTS = {
  p: 0,
  n: 1,
  b: 1,
  r: 2,
  q: 4,
  k: 0
};
export const MAX_PHASE = 24;

const PAWN_PST_MG = new Int16Array([
   0,   0,   0,   0,   0,   0,   0,   0,
  50,  50,  50,  50,  50,  50,  50,  50,
  12,  12,  22,  32,  32,  22,  12,  12,
   6,   6,  12,  27,  27,  12,   6,   6,
   0,   0,   4,  24,  24,   4,   0,   0,
   5,  -4,  -8,   2,   2,  -8,  -4,   5,
   5,  10,  10, -22, -22,  10,  10,   5,
   0,   0,   0,   0,   0,   0,   0,   0
]);

const PAWN_PST_EG = new Int16Array([
   0,   0,   0,   0,   0,   0,   0,   0,
  85,  85,  85,  85,  85,  85,  85,  85,
  52,  52,  52,  52,  52,  52,  52,  52,
  30,  30,  30,  30,  30,  30,  30,  30,
  15,  15,  15,  15,  15,  15,  15,  15,
   6,   6,   6,   6,   6,   6,   6,   6,
   0,   0,   0,   0,   0,   0,   0,   0,
   0,   0,   0,   0,   0,   0,   0,   0
]);

const KNIGHT_PST = new Int16Array([
 -50, -40, -30, -30, -30, -30, -40, -50,
 -40, -20,   0,   4,   4,   0, -20, -40,
 -30,   4,  12,  16,  16,  12,   4, -30,
 -30,   6,  16,  22,  22,  16,   6, -30,
 -30,   4,  16,  22,  22,  16,   4, -30,
 -30,   6,  12,  16,  16,  12,   6, -30,
 -40, -20,   0,   4,   4,   0, -20, -40,
 -50, -35, -30, -30, -30, -30, -35, -50
]);

const BISHOP_PST = new Int16Array([
 -20, -10, -10, -10, -10, -10, -10, -20,
 -10,   2,   0,   0,   0,   0,   2, -10,
 -10,   4,   8,  12,  12,   8,   4, -10,
 -10,   6,   8,  14,  14,   8,   6, -10,
 -10,   4,  12,  14,  14,  12,   4, -10,
 -10,  10,  10,  12,  12,  10,  10, -10,
 -10,   8,   0,   2,   2,   0,   8, -10,
 -20, -10, -12, -10, -10, -12, -10, -20
]);

const ROOK_PST = new Int16Array([
   0,   2,   4,   6,   6,   4,   2,   0,
  12,  16,  16,  16,  16,  16,  16,  12,
  -4,   0,   0,   2,   2,   0,   0,  -4,
  -4,   0,   0,   2,   2,   0,   0,  -4,
  -4,   0,   0,   2,   2,   0,   0,  -4,
  -4,   0,   0,   2,   2,   0,   0,  -4,
  -4,   0,   0,   2,   2,   0,   0,  -4,
   0,   0,   4,   8,   8,   4,   0,   0
]);

const QUEEN_PST = new Int16Array([
 -20, -10, -10,  -5,  -5, -10, -10, -20,
 -10,   0,   2,   0,   0,   0,   0, -10,
 -10,   2,   6,   6,   6,   6,   2, -10,
  -5,   0,   6,   8,   8,   6,   0,  -5,
   0,   0,   6,   8,   8,   6,   0,  -5,
 -10,   4,   6,   6,   6,   6,   2, -10,
 -10,   0,   4,   0,   0,   0,   0, -10,
 -20, -10, -10,  -5,  -5, -10, -10, -20
]);

const KING_PST_MG = new Int16Array([
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -30, -40, -40, -50, -50, -40, -40, -30,
 -20, -30, -30, -40, -40, -30, -30, -20,
 -10, -20, -20, -20, -20, -20, -20, -10,
  20,  22,   0,   0,   0,   0,  22,  20,
  22,  34,  14,   0,   0,  12,  34,  22
]);

const KING_PST_EG = new Int16Array([
 -50, -35, -25, -20, -20, -25, -35, -50,
 -30, -15,  -5,   0,   0,  -5, -15, -30,
 -25,  -5,  18,  24,  24,  18,  -5, -25,
 -20,   0,  24,  32,  32,  24,   0, -20,
 -20,   0,  24,  32,  32,  24,   0, -20,
 -25,  -5,  18,  24,  24,  18,  -5, -25,
 -30, -15,  -5,   0,   0,  -5, -15, -30,
 -50, -35, -25, -20, -20, -25, -35, -50
]);

const PASSED_PAWN_BONUS_MG = new Int16Array([0, 65, 42, 26, 14, 6, 0, 0]);
const PASSED_PAWN_BONUS_EG = new Int16Array([0, 115, 78, 48, 26, 12, 0, 0]);

// Pre-allocated static buffers for zero-allocation fast evaluation
const W_PAWNS_FILE = new Int8Array(8);
const B_PAWNS_FILE = new Int8Array(8);
const W_PAWN_MAX_R = new Int8Array(8);
const B_PAWN_MIN_R = new Int8Array(8);
const W_PAWN_SQS = new Int8Array(16);
const B_PAWN_SQS = new Int8Array(16);
const ROOK_SQS = new Int8Array(16);
const ROOK_COLS = new Int8Array(16);

export function getPstValue(type, color, sq64, isEndgame = false) {
  const idx = color === 'w' ? sq64 : ((7 - (sq64 >> 3)) << 3) | (sq64 & 7);
  switch (type) {
    case 'p':
      return isEndgame ? PAWN_PST_EG[idx] : PAWN_PST_MG[idx];
    case 'n':
      return KNIGHT_PST[idx];
    case 'b':
      return BISHOP_PST[idx];
    case 'r':
      return ROOK_PST[idx];
    case 'q':
      return QUEEN_PST[idx];
    case 'k':
      return isEndgame ? KING_PST_EG[idx] : KING_PST_MG[idx];
    default:
      return 0;
  }
}

/**
 * Fast zero-allocation static evaluation when `detailed === false`.
 */
export function evaluatePositionWhite(game, detailed = false, customParams = null) {
  const P = customParams || DEFAULT_EVAL_PARAMS;

  let mgWhite = 0;
  let mgBlack = 0;
  let egWhite = 0;
  let egBlack = 0;
  let phase = 0;

  let wBishops = 0;
  let bBishops = 0;
  let wPawnCount = 0;
  let bPawnCount = 0;
  let rookCount = 0;

  for (let i = 0; i < 8; i++) {
    W_PAWNS_FILE[i] = 0;
    B_PAWNS_FILE[i] = 0;
    W_PAWN_MAX_R[i] = -1;
    B_PAWN_MIN_R[i] = 8;
  }

  const wkSq = game.kingSq.w;
  const bkSq = game.kingSq.b;

  const breakdown = detailed
    ? {
        materialWhite: 0,
        materialBlack: 0,
        positionalWhite: 0,
        positionalBlack: 0,
        mobilityWhite: 0,
        mobilityBlack: 0,
        pawnStructureWhite: 0,
        pawnStructureBlack: 0,
        kingSafetyWhite: 0,
        kingSafetyBlack: 0,
        passedPawnsWhite: [],
        passedPawnsBlack: [],
        hangingWhite: [],
        hangingBlack: [],
        bishopPairWhite: false,
        bishopPairBlack: false,
        centerControlWhite: 0,
        centerControlBlack: 0
      }
    : null;

  const pstMgScale = (P.pstScaleMg || 100) / 100;
  const pstEgScale = (P.pstScaleEg || 100) / 100;
  const mobW = P.mobilityWeight || 4;
  const outpostB = P.outpostBonus || 18;
  const kingZoneW = P.kingZoneAttack || 11;

  const board88 = game.board88;

  for (let r = 0; r < 8; r++) {
    const rowOff = r << 4;
    const row64 = r << 3;
    for (let f = 0; f < 8; f++) {
      const sq88 = rowOff | f;
      const p = board88[sq88];
      if (!p) continue;

      const sq64 = row64 | f;
      const type = p.type;
      const isWhite = p.color === 'w';
      const idx = isWhite ? sq64 : ((7 - r) << 3) | f;

      let matMg = 0;
      let matEg = 0;
      let pstMg = 0;
      let pstEg = 0;

      if (type === 'p') {
        matMg = P.pawnMg || 100;
        matEg = P.pawnEg || 115;
        pstMg = PAWN_PST_MG[idx];
        pstEg = PAWN_PST_EG[idx];
        if (isWhite) {
          W_PAWNS_FILE[f]++;
          if (r > W_PAWN_MAX_R[f]) W_PAWN_MAX_R[f] = r;
          W_PAWN_SQS[wPawnCount++] = sq88;
        } else {
          B_PAWNS_FILE[f]++;
          if (r < B_PAWN_MIN_R[f]) B_PAWN_MIN_R[f] = r;
          B_PAWN_SQS[bPawnCount++] = sq88;
        }
      } else if (type === 'n') {
        phase += 1;
        matMg = P.knightMg || 320;
        matEg = P.knightEg || 310;
        pstMg = KNIGHT_PST[idx];
        pstEg = pstMg;

        // Fast knight mobility & outpost
        let mob = 0;
        for (let i = 0; i < 8; i++) {
          const to = sq88 + KNIGHT_OFFSETS[i];
          if (!(to & 0x88)) {
            const tp = board88[to];
            if (!tp || tp.color !== p.color) mob++;
          }
        }
        const mBonus = (mob - 4) * mobW;
        if (isWhite) {
          mgWhite += mBonus;
          egWhite += mBonus;
          if (r >= 2 && r <= 4 && f >= 1 && f <= 6) {
            const pL = board88[sq88 + 15];
            const pR = board88[sq88 + 17];
            if ((pL && pL.color === 'w' && pL.type === 'p') || (pR && pR.color === 'w' && pR.type === 'p')) {
              mgWhite += outpostB;
            }
          }
        } else {
          mgBlack += mBonus;
          egBlack += mBonus;
          if (r >= 3 && r <= 5 && f >= 1 && f <= 6) {
            const pL = board88[sq88 - 15];
            const pR = board88[sq88 - 17];
            if ((pL && pL.color === 'b' && pL.type === 'p') || (pR && pR.color === 'b' && pR.type === 'p')) {
              mgBlack += outpostB;
            }
          }
        }
      } else if (type === 'b') {
        phase += 1;
        matMg = P.bishopMg || 335;
        matEg = P.bishopEg || 340;
        pstMg = BISHOP_PST[idx];
        pstEg = pstMg;
        if (isWhite) wBishops++;
        else bBishops++;
      } else if (type === 'r') {
        phase += 2;
        matMg = P.rookMg || 500;
        matEg = P.rookEg || 530;
        pstMg = ROOK_PST[idx];
        pstEg = pstMg;
        ROOK_SQS[rookCount] = sq88;
        ROOK_COLS[rookCount] = isWhite ? 1 : 0;
        rookCount++;
      } else if (type === 'q') {
        phase += 4;
        matMg = P.queenMg || 920;
        matEg = P.queenEg || 940;
        pstMg = QUEEN_PST[idx];
        pstEg = pstMg;
        // Queen tropism to enemy king
        const ek = isWhite ? bkSq : wkSq;
        if (ek !== -1) {
          const dist = Math.abs(r - (ek >> 4)) + Math.abs(f - (ek & 7));
          const trop = Math.max(0, 8 - dist) * (kingZoneW >> 1);
          if (isWhite) mgWhite += trop;
          else mgBlack += trop;
        }
      } else if (type === 'k') {
        pstMg = KING_PST_MG[idx];
        pstEg = KING_PST_EG[idx];
      }

      if (pstMgScale !== 1) pstMg = (pstMg * pstMgScale) | 0;
      if (pstEgScale !== 1) pstEg = (pstEg * pstEgScale) | 0;

      if (isWhite) {
        mgWhite += matMg + pstMg;
        egWhite += matEg + pstEg;
        if (detailed) {
          breakdown.materialWhite += matMg;
          breakdown.positionalWhite += pstMg;
        }
      } else {
        mgBlack += matMg + pstMg;
        egBlack += matEg + pstEg;
        if (detailed) {
          breakdown.materialBlack += matMg;
          breakdown.positionalBlack += pstMg;
        }
      }

      if ((r === 3 || r === 4) && (f === 3 || f === 4)) {
        if (isWhite) {
          mgWhite += 8;
          if (detailed) breakdown.centerControlWhite += 8;
        } else {
          mgBlack += 8;
          if (detailed) breakdown.centerControlBlack += 8;
        }
      }
    }
  }

  // 2. Bishop pair
  if (wBishops >= 2) {
    mgWhite += P.bishopPairMg || 34;
    egWhite += P.bishopPairEg || 46;
    if (detailed) breakdown.bishopPairWhite = true;
  }
  if (bBishops >= 2) {
    mgBlack += P.bishopPairMg || 34;
    egBlack += P.bishopPairEg || 46;
    if (detailed) breakdown.bishopPairBlack = true;
  }

  // 3. Pawn structure: doubled & isolated
  const dblPen = P.doubledPawnPen || 14;
  const isoPen = P.isolatedPawnPen || 14;
  for (let f = 0; f < 8; f++) {
    const wc = W_PAWNS_FILE[f];
    if (wc > 1) {
      const pen = (wc - 1) * dblPen;
      mgWhite -= pen;
      egWhite -= pen;
      if (detailed) breakdown.pawnStructureWhite -= pen;
    }
    if (wc > 0) {
      const hasN = (f > 0 && W_PAWNS_FILE[f - 1] > 0) || (f < 7 && W_PAWNS_FILE[f + 1] > 0);
      if (!hasN) {
        mgWhite -= isoPen;
        egWhite -= isoPen + 2;
        if (detailed) breakdown.pawnStructureWhite -= isoPen;
      }
    }

    const bc = B_PAWNS_FILE[f];
    if (bc > 1) {
      const pen = (bc - 1) * dblPen;
      mgBlack -= pen;
      egBlack -= pen;
      if (detailed) breakdown.pawnStructureBlack -= pen;
    }
    if (bc > 0) {
      const hasN = (f > 0 && B_PAWNS_FILE[f - 1] > 0) || (f < 7 && B_PAWNS_FILE[f + 1] > 0);
      if (!hasN) {
        mgBlack -= isoPen;
        egBlack -= isoPen + 2;
        if (detailed) breakdown.pawnStructureBlack -= isoPen;
      }
    }
  }

  // Passed pawns using pre-computed min/max rank arrays
  const passedScale = (P.passedPawnScale || 105) / 100;
  for (let i = 0; i < wPawnCount; i++) {
    const sq88 = W_PAWN_SQS[i];
    const r = sq88 >> 4;
    const f = sq88 & 7;
    const minB0 = f > 0 ? B_PAWN_MIN_R[f - 1] : 8;
    const minB1 = B_PAWN_MIN_R[f];
    const minB2 = f < 7 ? B_PAWN_MIN_R[f + 1] : 8;
    if (minB0 >= r && minB1 >= r && minB2 >= r) {
      const bMg = (PASSED_PAWN_BONUS_MG[r] * passedScale) | 0;
      const bEg = (PASSED_PAWN_BONUS_EG[r] * passedScale) | 0;
      mgWhite += bMg;
      egWhite += bEg;
      if (detailed) {
        breakdown.pawnStructureWhite += bMg;
        breakdown.passedPawnsWhite.push(sq88ToAlgebraic(sq88));
      }
    }
  }

  for (let i = 0; i < bPawnCount; i++) {
    const sq88 = B_PAWN_SQS[i];
    const r = sq88 >> 4;
    const f = sq88 & 7;
    const maxW0 = f > 0 ? W_PAWN_MAX_R[f - 1] : -1;
    const maxW1 = W_PAWN_MAX_R[f];
    const maxW2 = f < 7 ? W_PAWN_MAX_R[f + 1] : -1;
    if (maxW0 <= r && maxW1 <= r && maxW2 <= r) {
      const invR = 7 - r;
      const bMg = (PASSED_PAWN_BONUS_MG[invR] * passedScale) | 0;
      const bEg = (PASSED_PAWN_BONUS_EG[invR] * passedScale) | 0;
      mgBlack += bMg;
      egBlack += bEg;
      if (detailed) {
        breakdown.pawnStructureBlack += bMg;
        breakdown.passedPawnsBlack.push(sq88ToAlgebraic(sq88));
      }
    }
  }

  // 4. Rooks open files & 7th rank
  const openB = P.rookOpenFile || 24;
  const sevB = P.rookSeventh || 24;
  for (let i = 0; i < rookCount; i++) {
    const sq88 = ROOK_SQS[i];
    const r = sq88 >> 4;
    const f = sq88 & 7;
    if (ROOK_COLS[i] === 1) {
      if (W_PAWNS_FILE[f] === 0) {
        const bonus = B_PAWNS_FILE[f] === 0 ? openB : openB >> 1;
        mgWhite += bonus;
        egWhite += bonus;
      }
      if (r === 1) {
        mgWhite += sevB;
        egWhite += sevB + 8;
      }
    } else {
      if (B_PAWNS_FILE[f] === 0) {
        const bonus = W_PAWNS_FILE[f] === 0 ? openB : openB >> 1;
        mgBlack += bonus;
        egBlack += bonus;
      }
      if (r === 6) {
        mgBlack += sevB;
        egBlack += sevB + 8;
      }
    }
  }

  // 5. King safety & Endgame Mop-Up
  const shieldB = P.kingShieldBonus || 13;
  if (wkSq !== -1 && bkSq !== -1) {
    const wkr = wkSq >> 4;
    const wkf = wkSq & 7;
    const bkr = bkSq >> 4;
    const bkf = bkSq & 7;

    if (wkr >= 6) {
      let shield = 0;
      for (let df = Math.max(0, wkf - 1); df <= Math.min(7, wkf + 1); df++) {
        const s1 = ((wkr - 1) << 4) | df;
        const p1 = board88[s1];
        if (p1 && p1.color === 'w' && p1.type === 'p') shield += shieldB;
        if (W_PAWNS_FILE[df] === 0) shield -= shieldB;
      }
      mgWhite += shield;
      if (detailed) breakdown.kingSafetyWhite += shield;
    }

    if (bkr <= 1) {
      let shield = 0;
      for (let df = Math.max(0, bkf - 1); df <= Math.min(7, bkf + 1); df++) {
        const s1 = ((bkr + 1) << 4) | df;
        const p1 = board88[s1];
        if (p1 && p1.color === 'b' && p1.type === 'p') shield += shieldB;
        if (B_PAWNS_FILE[df] === 0) shield -= shieldB;
      }
      mgBlack += shield;
      if (detailed) breakdown.kingSafetyBlack += shield;
    }

    const matDiff = mgWhite - mgBlack;
    const kingDist = Math.abs(wkr - bkr) + Math.abs(wkf - bkf);
    if (matDiff >= 300) {
      const bCenterDist = Math.max(Math.abs(bkr - 3.5), Math.abs(bkf - 3.5));
      egWhite += (bCenterDist * 16 + (14 - kingDist) * 7) | 0;
    } else if (matDiff <= -300) {
      const wCenterDist = Math.max(Math.abs(wkr - 3.5), Math.abs(wkf - 3.5));
      egBlack += (wCenterDist * 16 + (14 - kingDist) * 7) | 0;
    }
  }

  if (detailed) {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq88 = (r << 4) | f;
        const p = board88[sq88];
        if (!p || p.type === 'k') continue;
        const enemy = p.color === 'w' ? 'b' : 'w';
        if (game.isSquareAttacked(sq88, enemy) && !game.isSquareAttacked(sq88, p.color)) {
          const sqAlg = sq88ToAlgebraic(sq88);
          if (p.color === 'w') breakdown.hangingWhite.push({ piece: p.type, square: sqAlg });
          else breakdown.hangingBlack.push({ piece: p.type, square: sqAlg });
        }
      }
    }
  }

  const clampedPhase = phase > MAX_PHASE ? MAX_PHASE : phase;
  const mgWeight = clampedPhase;
  const egWeight = MAX_PHASE - clampedPhase;

  const mgDiff = mgWhite - mgBlack;
  const egDiff = egWhite - egBlack;
  let totalWhiteCp = ((mgDiff * mgWeight + egDiff * egWeight) / MAX_PHASE) | 0;

  const tempo = P.tempoBonus || 12;
  totalWhiteCp += game.stm === 'w' ? tempo : -tempo;

  if (detailed) {
    const phaseLabel =
      clampedPhase >= 18 ? 'Opening' : clampedPhase >= 8 ? 'Middlegame' : 'Endgame';
    return {
      scoreWhiteCp: totalWhiteCp,
      scoreSideToMoveCp: game.stm === 'w' ? totalWhiteCp : -totalWhiteCp,
      phase: phaseLabel,
      phaseNumeric: clampedPhase,
      breakdown
    };
  }

  return totalWhiteCp;
}

export function evaluateForSideToMove(game, customParams = null) {
  const whiteScore = evaluatePositionWhite(game, false, customParams);
  return game.stm === 'w' ? whiteScore : -whiteScore;
}

const PIECE_NAMES = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King'
};

export function explainPosition(game, customParams = null) {
  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'Black' : 'White';
    return {
      scoreWhiteCp: game.turn() === 'w' ? -10000 : 10000,
      phase: 'Terminal',
      bullets: [`Checkmate on the board — ${winner} wins.`],
      components: { material: 0, positional: 0, structure: 0, kingSafety: 0 }
    };
  }
  if (game.in_draw()) {
    return {
      scoreWhiteCp: 0,
      phase: 'Terminal',
      bullets: ['The position is drawn under standard FIDE chess rules.'],
      components: { material: 0, positional: 0, structure: 0, kingSafety: 0 }
    };
  }

  const info = evaluatePositionWhite(game, true, customParams);
  const b = info.breakdown;
  const bullets = [];

  if (game.in_check()) {
    const checkedSide = game.turn() === 'w' ? 'White' : 'Black';
    bullets.push(`${checkedSide}'s King is currently in check and must respond immediately.`);
  }

  const matDiff = b.materialWhite - b.materialBlack;
  if (Math.abs(matDiff) >= 100) {
    const leader = matDiff > 0 ? 'White' : 'Black';
    const pawnsEq = (Math.abs(matDiff) / 100).toFixed(1);
    bullets.push(`${leader} holds a material advantage of ${pawnsEq} pawns (${Math.abs(matDiff)} cp).`);
  } else {
    bullets.push('Material is currently balanced between Sacred Marble and Polished Obsidian.');
  }

  if (b.hangingWhite.length > 0) {
    const items = b.hangingWhite.map(h => `White ${PIECE_NAMES[h.piece]} on ${h.square}`).join(', ');
    bullets.push(`Unprotected piece alert: ${items} is attacked and undefended.`);
  }
  if (b.hangingBlack.length > 0) {
    const items = b.hangingBlack.map(h => `Black ${PIECE_NAMES[h.piece]} on ${h.square}`).join(', ');
    bullets.push(`Tactical target: ${items} is attacked and undefended.`);
  }

  if (b.passedPawnsWhite.length > 0) {
    bullets.push(`White has passed pawn potential on ${b.passedPawnsWhite.join(', ')}.`);
  }
  if (b.passedPawnsBlack.length > 0) {
    bullets.push(`Black has passed pawn potential on ${b.passedPawnsBlack.join(', ')}.`);
  }

  if (b.bishopPairWhite && !b.bishopPairBlack) {
    bullets.push('White retains the Bishop pair, increasing long-diagonal influence.');
  } else if (b.bishopPairBlack && !b.bishopPairWhite) {
    bullets.push('Black retains the Bishop pair, controlling both diagonal complexes.');
  }

  if (b.kingSafetyWhite - b.kingSafetyBlack >= 20) {
    bullets.push('White’s King shelter is safer than Black’s.');
  } else if (b.kingSafetyBlack - b.kingSafetyWhite >= 20) {
    bullets.push('Black’s King shelter is safer than White’s.');
  }

  return {
    scoreWhiteCp: info.scoreWhiteCp,
    phase: info.phase,
    bullets: bullets.slice(0, 5),
    components: {
      material: matDiff,
      positional: b.positionalWhite - b.positionalBlack,
      structure: b.pawnStructureWhite - b.pawnStructureBlack,
      kingSafety: b.kingSafetyWhite - b.kingSafetyBlack
    }
  };
}
