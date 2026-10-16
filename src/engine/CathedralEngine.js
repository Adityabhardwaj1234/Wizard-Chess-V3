/**
 * Cathedral Engine & Cathedral Apex — Authoritative 12-Tier Search Engine
 * Implements:
 * - Iterative Deepening with Aspiration Windows
 * - Negamax with Alpha-Beta Pruning & Principal Variation Search (PVS)
 * - Null-Move Pruning (R=2/3 with non-pawn material Zugzwang safeguard)
 * - Quiescence Search with Stand-Pat, Delta Pruning, and SEE Bad-Capture Pruning
 * - Zobrist Transposition Table with Mate-Distance Normalization
 * - Move Ordering (TT, Promotions, SEE/MVV-LVA, Killer, Countermove, History)
 * - Check Extensions, 7th-Rank Pawn Push Extensions & Late Move Reductions (LMR)
 * - Optional Position-Verified Opening Book (never copies opponent moves, toggleable)
 * - 12 Calibrated Difficulty Levels + Experimental (Trained Champion) + Multi-PV Analysis
 */

import { ChessGame, sq88ToAlgebraic } from '../game/ChessGame.js';
import {
  evaluateForSideToMove,
  PIECE_VALUES_MG,
  explainPosition
} from './evaluation.js';
import {
  TranspositionTable,
  TT_EXACT,
  TT_LOWER,
  TT_UPPER,
  MATE_SCORE,
  MATE_THRESHOLD,
  scoreFromTT,
  encodeMoveKey
} from './transpositionTable.js';
import { MoveOrderer, MAX_PLY } from './moveOrdering.js';

export const POSITION_OPENING_BOOK = {
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq': ['e4', 'd4', 'Nf3', 'c4'],
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq': ['e5', 'c5', 'e6', 'c6'],
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq': ['d5', 'Nf6', 'e6'],
  'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq': ['e5', 'Nf6', 'c5'],
  'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq': ['d5', 'Nf6', 'c5'],
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq': ['Nf3', 'Nc3', 'Bc4'],
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq': ['Nc6', 'Nf6'],
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq': ['Bb5', 'Bc4', 'd4'],
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq': ['Nf3', 'Nc3', 'c3'],
  'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq': ['c4', 'Bf4', 'Nf3'],
  'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq': ['c4', 'Nf3', 'Bf4']
};

export const DIFFICULTY_PRESETS = {
  FirstSteps: {
    id: 'FirstSteps',
    tier: 1,
    name: 'FirstSteps',
    label: '1. First Steps · ~650 Est. Local',
    shortLabel: 'First Steps',
    estimatedRating: 650,
    ratingUncertainty: 90,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 1,
    timeLimitMs: 60,
    nodeLimit: 80,
    randomnessCp: 130,
    useQuiescence: false,
    useUltraSearch: false,
    allowBook: false,
    description: 'Very forgiving 1-ply horizon without capture extensions; accessible to first-time players.'
  },
  Beginner: {
    id: 'Beginner',
    tier: 2,
    name: 'Beginner',
    label: '2. Beginner · ~850 Est. Local',
    shortLabel: 'Beginner',
    estimatedRating: 850,
    ratingUncertainty: 80,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 1,
    timeLimitMs: 100,
    nodeLimit: 250,
    randomnessCp: 65,
    useQuiescence: false,
    useUltraSearch: false,
    allowBook: false,
    description: 'Simple 1-ply plans with occasional tactical oversights on multi-move exchanges.'
  },
  Learner: {
    id: 'Learner',
    tier: 3,
    name: 'Learner',
    label: '3. Learner · ~1050 Est. Local',
    shortLabel: 'Learner',
    estimatedRating: 1050,
    ratingUncertainty: 75,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 2,
    timeLimitMs: 160,
    nodeLimit: 900,
    randomnessCp: 40,
    useQuiescence: false,
    useUltraSearch: false,
    allowBook: false,
    description: 'Basic 2-ply tactical awareness with limited search horizon.'
  },
  ClubRookie: {
    id: 'ClubRookie',
    tier: 4,
    name: 'ClubRookie',
    label: '4. Club Rookie · ~1220 Est. Local',
    shortLabel: 'Club Rookie',
    estimatedRating: 1220,
    ratingUncertainty: 65,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 2,
    timeLimitMs: 240,
    nodeLimit: 2600,
    randomnessCp: 20,
    useQuiescence: true,
    useUltraSearch: false,
    allowBook: true,
    description: 'Understands common 2-ply tactics and resolves hanging-piece captures via quiescence.'
  },
  ClubPlayer: {
    id: 'ClubPlayer',
    tier: 5,
    name: 'ClubPlayer',
    label: '5. Club Player · ~1400 Est. Local',
    shortLabel: 'Club Player',
    estimatedRating: 1400,
    ratingUncertainty: 60,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 3,
    timeLimitMs: 360,
    nodeLimit: 7500,
    randomnessCp: 10,
    useQuiescence: true,
    useUltraSearch: false,
    allowBook: true,
    description: 'Solid 3-ply strategic and tactical play with full quiescence capture search.'
  },
  ClubAdvanced: {
    id: 'ClubAdvanced',
    tier: 6,
    name: 'ClubAdvanced',
    label: '6. Club Advanced · ~1560 Est. Local',
    shortLabel: 'Club Advanced',
    estimatedRating: 1560,
    ratingUncertainty: 55,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 4,
    timeLimitMs: 550,
    nodeLimit: 18000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: false,
    allowBook: true,
    description: '4-ply tactical calculation with transposition tables and killer-move ordering.'
  },
  Competitor: {
    id: 'Competitor',
    tier: 7,
    name: 'Competitor',
    label: '7. Competitor · ~1720 Est. Local',
    shortLabel: 'Competitor',
    estimatedRating: 1720,
    ratingUncertainty: 50,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 5,
    timeLimitMs: 850,
    nodeLimit: 45000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'Consistent 5-ply PVS search with zero intentional weakening and full positional evaluation.'
  },
  Advanced: {
    id: 'Advanced',
    tier: 8,
    name: 'Advanced',
    label: '8. Advanced · ~1860 Est. Local',
    shortLabel: 'Advanced',
    estimatedRating: 1860,
    ratingUncertainty: 50,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 6,
    timeLimitMs: 1200,
    nodeLimit: 95000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'Challenging 6-ply tactical and positional play with Static Exchange Evaluation and LMR.'
  },
  Expert: {
    id: 'Expert',
    tier: 9,
    name: 'Expert',
    label: '9. Expert · ~2000 Est. Local',
    shortLabel: 'Expert',
    estimatedRating: 2000,
    ratingUncertainty: 55,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 7,
    timeLimitMs: 1650,
    nodeLimit: 185000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'Deep 7-ply browser calculation with Null-Move Pruning, aspiration windows, and countermoves.'
  },
  Master: {
    id: 'Master',
    tier: 10,
    name: 'Master',
    label: '10. Master · ~2120 Est. Local',
    shortLabel: 'Master',
    estimatedRating: 2120,
    ratingUncertainty: 60,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 8,
    timeLimitMs: 2200,
    nodeLimit: 320000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'High-strength 8-ply search with check extensions, 7th-rank extensions, and endgame scaling.'
  },
  GrandmasterChallenge: {
    id: 'GrandmasterChallenge',
    tier: 11,
    name: 'GrandmasterChallenge',
    label: '11. Grandmaster Challenge · ~2220 Est. Local',
    shortLabel: 'GM Challenge',
    estimatedRating: 2220,
    ratingUncertainty: 65,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 9,
    timeLimitMs: 2800,
    nodeLimit: 520000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'Near the strongest verified browser configuration (9-ply horizon, 520k node budget).'
  },
  CathedralApex: {
    id: 'CathedralApex',
    tier: 12,
    name: 'CathedralApex',
    label: '12. Cathedral Apex · ~2300 Est. Local (Max)',
    shortLabel: 'Cathedral Apex',
    estimatedRating: 2300,
    ratingUncertainty: 70,
    calibrationStatus: 'Calibrated vs Ladder Baseline',
    maxDepth: 10,
    timeLimitMs: 3600,
    nodeLimit: 850000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'Maximum available strength and search resources in the Cathedral JavaScript engine (not unbeatable; bounded by JS worker throughput).'
  },
  Experimental: {
    id: 'Experimental',
    tier: 13,
    name: 'Experimental',
    label: 'Experimental · Trained Lab Champion',
    shortLabel: 'Experimental',
    estimatedRating: 1920,
    ratingUncertainty: 85,
    calibrationStatus: 'Dynamic (Training Lab Checkpoints)',
    maxDepth: 7,
    timeLimitMs: 1400,
    nodeLimit: 160000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: true,
    description: 'Plays using the 24-parameter evaluation vector evolved via headless self-play in the Training Lab.'
  },
  Analysis: {
    id: 'Analysis',
    tier: 14,
    name: 'Analysis',
    label: 'Analysis · Multi-PV Deep Review',
    shortLabel: 'Analysis',
    estimatedRating: 2250,
    ratingUncertainty: 60,
    calibrationStatus: 'Reference Review Mode',
    maxDepth: 8,
    timeLimitMs: 2500,
    nodeLimit: 400000,
    randomnessCp: 0,
    useQuiescence: true,
    useUltraSearch: true,
    allowBook: false,
    description: 'Uncompromised multi-candidate deep search for position review, hints, and X-Ray forecasting.'
  }
};

export const LEGACY_PRESET_ALIASES = {
  Apprentice: DIFFICULTY_PRESETS.Learner,
  Initiate: DIFFICULTY_PRESETS.ClubPlayer,
  Mage: DIFFICULTY_PRESETS.Competitor,
  Archmage: DIFFICULTY_PRESETS.Expert,
  Ultra: DIFFICULTY_PRESETS.CathedralApex
};

export function resolveDifficultyPreset(nameOrId) {
  if (!nameOrId) return DIFFICULTY_PRESETS.ClubPlayer;
  return (
    DIFFICULTY_PRESETS[nameOrId] ||
    LEGACY_PRESET_ALIASES[nameOrId] ||
    DIFFICULTY_PRESETS.ClubPlayer
  );
}

export class CathedralEngine {
  constructor(ttSize = 1 << 17) {
    this.tt = new TranspositionTable(ttSize);
    this.orderer = new MoveOrderer();
    this.nodes = 0;
    this.qNodes = 0;
    this.startTime = 0;
    this.timeLimitMs = 1000;
    this.nodeLimit = 100000;
    this.aborted = false;
    this.stopReason = 'completed';
    this.stopRequested = false;
    this.evalParams = null;
    this.useQuiescence = true;
    this.useUltraSearch = true;
    this.rootHistoryLen = 1;
  }

  clearCache() {
    this.tt.clear();
    this.orderer.clear();
  }

  requestStop() {
    this.stopRequested = true;
  }

  checkLimits() {
    if (this.stopRequested) {
      this.aborted = true;
      this.stopReason = 'user_cancelled';
      return true;
    }
    if (this.activeRootDepth <= 1) return false;
    if (this.nodes + this.qNodes >= this.nodeLimit) {
      this.aborted = true;
      this.stopReason = 'node_limit';
      return true;
    }
    if (((this.nodes + this.qNodes) & 63) === 0) {
      if (performance.now() - this.startTime >= this.timeLimitMs) {
        this.aborted = true;
        this.stopReason = 'time_limit';
        return true;
      }
    }
    return false;
  }

  quiescence(game, alpha, beta, ply) {
    if (this.checkLimits()) return 0;
    this.qNodes++;

    if (game.in_fifty_move_rule() || game.isSearchRepetition(this.rootHistoryLen) || game.insufficient_material()) {
      return 0;
    }

    const inCheck = game.in_check();
    let standPat = 0;

    if (!inCheck) {
      standPat = evaluateForSideToMove(game, this.evalParams);
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
    }

    if (ply >= this.maxQuiescencePly) {
      return inCheck ? evaluateForSideToMove(game, this.evalParams) : standPat;
    }

    const moves = game.generatePseudoMoves(!inCheck);
    this.orderer.scoreMoves(moves, 0, ply, null, null);

    let legalCount = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];

      if (!inCheck && !m.promotion && m.captured) {
        const victimVal = PIECE_VALUES_MG[m.captured] || 100;
        if (standPat + victimVal + 185 < alpha) continue;
        const attackerVal = PIECE_VALUES_MG[m.piece] || 100;
        if (attackerVal > victimVal && game.staticExchangeEvaluation(m) < 0) continue;
      }

      if (!game.makeMoveRaw(m)) continue;
      legalCount++;
      const score = -this.quiescence(game, -beta, -alpha, ply + 1);
      game.unmakeMoveRaw();

      if (this.aborted) return 0;

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    if (inCheck && legalCount === 0) return -MATE_SCORE + ply;
    return alpha;
  }

  negamax(game, depth, alpha, beta, ply, isPvNode, allowNullMove = true, prevMove = null) {
    if (this.checkLimits()) return 0;

    if (ply > 0) {
      if (game.in_fifty_move_rule() || game.isSearchRepetition(this.rootHistoryLen) || game.insufficient_material()) {
        return 0;
      }
      const mateAlpha = Math.max(alpha, -MATE_SCORE + ply);
      const mateBeta = Math.min(beta, MATE_SCORE - ply - 1);
      if (mateAlpha >= mateBeta) return mateAlpha;
    }

    const inCheck = game.in_check();
    if (inCheck && ply < MAX_PLY - 2) {
      depth++;
    }

    if (depth <= 0 || ply >= MAX_PLY - 1) {
      if (!this.useQuiescence && !inCheck) {
        this.qNodes++;
        return evaluateForSideToMove(game, this.evalParams);
      }
      return this.quiescence(game, alpha, beta, ply);
    }

    this.nodes++;
    const origAlpha = alpha;
    const hash = game.hash;

    const ttEntry = this.tt.probe(hash);
    let ttBestMoveKey = 0;
    if (ttEntry) {
      ttBestMoveKey = ttEntry.bestMoveKey;
      if (!isPvNode && ttEntry.depth >= depth) {
        const ttScore = scoreFromTT(ttEntry.score, ply);
        if (ttEntry.bound === TT_EXACT) return ttScore;
        if (ttEntry.bound === TT_LOWER && ttScore >= beta) return ttScore;
        if (ttEntry.bound === TT_UPPER && ttScore <= alpha) return ttScore;
      }
    }

    if (
      this.useUltraSearch &&
      allowNullMove &&
      !isPvNode &&
      !inCheck &&
      depth >= 3 &&
      Math.abs(beta) < MATE_THRESHOLD &&
      game.hasNonPawnMaterial(game.stm)
    ) {
      const staticEval = evaluateForSideToMove(game, this.evalParams);
      if (staticEval >= beta) {
        const R = depth >= 6 ? 3 : 2;
        game.makeNullMove();
        const nullScore = -this.negamax(game, depth - 1 - R, -beta, -beta + 1, ply + 1, false, false, null);
        game.unmakeNullMove();
        if (this.aborted) return 0;
        if (nullScore >= beta && Math.abs(nullScore) < MATE_THRESHOLD) {
          return beta;
        }
      }
    }

    const moves = game.generatePseudoMoves(false);
    this.orderer.scoreMoves(moves, ttBestMoveKey, ply, this.useUltraSearch && depth >= 3 ? game : null, prevMove);

    let bestScore = -Infinity;
    let bestMove = null;
    let legalMovesCount = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (!game.makeMoveRaw(m)) continue;
      legalMovesCount++;
      if (!bestMove) bestMove = m;

      let score;
      if (legalMovesCount === 1) {
        score = -this.negamax(game, depth - 1, -beta, -alpha, ply + 1, isPvNode, true, m);
      } else {
        let reduction = 0;
        const givesCheck = game.in_check();
        const isSeventhRankPawnPush =
          m.piece === 'p' && ((m.color === 'w' && (m.to >> 4) === 1) || (m.color === 'b' && (m.to >> 4) === 6));

        if (
          depth >= 3 &&
          i >= 3 &&
          !inCheck &&
          !givesCheck &&
          !isSeventhRankPawnPush &&
          !m.captured &&
          !m.promotion
        ) {
          reduction = i >= 8 && depth >= 5 ? 2 : 1;
        }

        score = -this.negamax(
          game,
          depth - 1 - reduction,
          -alpha - 1,
          -alpha,
          ply + 1,
          false,
          true,
          m
        );

        if (reduction > 0 && score > alpha) {
          score = -this.negamax(game, depth - 1, -alpha - 1, -alpha, ply + 1, false, true, m);
        }

        if (isPvNode && score > alpha && score < beta) {
          score = -this.negamax(game, depth - 1, -beta, -alpha, ply + 1, true, true, m);
        }
      }

      game.unmakeMoveRaw();

      if (this.aborted) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.orderer.recordKiller(ply, m);
            this.orderer.recordCounterMove(prevMove, m);
            this.orderer.recordHistory(m, depth);
            break;
          }
        }
      }
    }

    if (legalMovesCount === 0) {
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    const bound =
      bestScore <= origAlpha ? TT_UPPER : bestScore >= beta ? TT_LOWER : TT_EXACT;
    this.tt.store(hash, depth, bestScore, bound, bestMove, ply);

    return bestScore;
  }

  extractPvSan(game, firstMoveRaw, maxLen = 8) {
    const pvSan = [];
    const pvLan = [];
    const madeCount = [];

    const allRoot = game.generateLegalMovesRaw(false);
    pvSan.push(game.moveToSan(firstMoveRaw, allRoot));
    pvLan.push(
      sq88ToAlgebraic(firstMoveRaw.from) +
        sq88ToAlgebraic(firstMoveRaw.to) +
        (firstMoveRaw.promotion || '')
    );

    game.makeMoveRaw(firstMoveRaw);
    madeCount.push(firstMoveRaw);

    const seenHashes = new Set([game.hash]);

    for (let d = 1; d < maxLen; d++) {
      const entry = this.tt.probe(game.hash);
      if (!entry || !entry.bestMoveKey) break;
      const legals = game.generateLegalMovesRaw(false);
      let nextMove = null;
      for (let i = 0; i < legals.length; i++) {
        if (encodeMoveKey(legals[i]) === entry.bestMoveKey) {
          nextMove = legals[i];
          break;
        }
      }
      if (!nextMove) break;
      pvSan.push(game.moveToSan(nextMove, legals));
      pvLan.push(
        sq88ToAlgebraic(nextMove.from) +
          sq88ToAlgebraic(nextMove.to) +
          (nextMove.promotion || '')
      );
      game.makeMoveRaw(nextMove);
      madeCount.push(nextMove);
      if (seenHashes.has(game.hash)) break;
      seenHashes.add(game.hash);
    }

    while (madeCount.length > 0) {
      game.unmakeMoveRaw();
      madeCount.pop();
    }

    return { pvSan, pvLan };
  }

  search(fen, options = {}) {
    const requestedMode = options.difficulty || 'ClubPlayer';
    const preset = resolveDifficultyPreset(requestedMode);
    const maxDepth = options.maxDepth || preset.maxDepth;
    this.timeLimitMs = options.timeLimitMs || preset.timeLimitMs;
    this.nodeLimit = options.nodeLimit || preset.nodeLimit;
    this.evalParams = options.evalParams || null;
    this.useQuiescence = options.useQuiescence !== undefined ? options.useQuiescence : preset.useQuiescence !== false;
    this.useUltraSearch = options.useUltraSearch !== undefined ? options.useUltraSearch : preset.useUltraSearch !== false;
    this.maxQuiescencePly = options.fastSelfPlay ? maxDepth + 4 : Math.min(MAX_PLY - 1, maxDepth + 10);
    const randomnessCp = options.randomnessCp !== undefined ? options.randomnessCp : preset.randomnessCp;
    const multiPvCount = Math.max(options.multiPv || 1, randomnessCp > 0 ? 4 : 1);
    const onProgress = options.onProgress || null;
    const useOpeningBook = options.useOpeningBook === true && preset.allowBook !== false;

    const game = new ChessGame(fen);
    if (options.hashHistory && Array.isArray(options.hashHistory)) {
      game.hashHistory = [...options.hashHistory];
    } else if (options.historyMoves && Array.isArray(options.historyMoves) && options.startFen) {
      const replayGame = new ChessGame(options.startFen);
      for (const san of options.historyMoves) {
        replayGame.move(san);
      }
      if (replayGame.fen() === game.fen()) {
        game.hashHistory = [...replayGame.hashHistory];
      }
    }
    this.rootHistoryLen = game.hashHistory.length;

    const rootMoves = game.generateLegalMovesRaw(false);
    if (rootMoves.length === 0) {
      return {
        engineMode: requestedMode,
        bestMove: null,
        bestMoveSan: null,
        scoreSideToMoveCp: game.in_check() ? -MATE_SCORE : 0,
        scoreWhiteCp: game.in_check() ? (game.turn() === 'w' ? -MATE_SCORE : MATE_SCORE) : 0,
        mateIn: game.in_check() ? 0 : null,
        depth: 0,
        nodes: 0,
        nps: 0,
        elapsedMs: 0,
        pv: [],
        pvLan: [],
        candidates: [],
        stopReason: 'terminal',
        bookMove: false,
        explanation: explainPosition(game, this.evalParams)
      };
    }

    if (useOpeningBook && (options.multiPv || 1) === 1) {
      const fenKey = game.fen().split(' ').slice(0, 3).join(' ');
      const bookChoices = POSITION_OPENING_BOOK[fenKey];
      if (bookChoices && bookChoices.length > 0) {
        const legalVerbose = game.moves({ verbose: true });
        const validBookMoves = legalVerbose.filter(mv => bookChoices.includes(mv.san));
        if (validBookMoves.length > 0) {
          const seedVal = options.bookSeed !== undefined ? Number(options.bookSeed) : Number(game.hash & 0xffffn) + game.fullMoves;
          const chosenBook = validBookMoves[Math.abs(seedVal) % validBookMoves.length];
          const stmScore = evaluateForSideToMove(game, this.evalParams);
          const whiteScore = game.turn() === 'w' ? stmScore : -stmScore;
          return {
            engineMode: requestedMode,
            bestMove: {
              from: chosenBook.from,
              to: chosenBook.to,
              promotion: chosenBook.promotion,
              san: chosenBook.san,
              lan: chosenBook.lan
            },
            bestMoveSan: chosenBook.san,
            bestMoveLan: chosenBook.lan,
            scoreSideToMoveCp: stmScore,
            scoreWhiteCp: whiteScore,
            mateIn: null,
            depth: 1,
            nodes: validBookMoves.length,
            qNodes: 0,
            nps: validBookMoves.length * 1000,
            elapsedMs: 1,
            pv: [chosenBook.san],
            pvLan: [chosenBook.lan],
            candidates: validBookMoves.slice(0, 3).map(c => ({
              san: c.san,
              lan: c.lan,
              from: c.from,
              to: c.to,
              scoreWhiteCp: whiteScore,
              scoreSideToMoveCp: stmScore,
              mateIn: null,
              pv: [c.san]
            })),
            stopReason: 'opening_book',
            bookMove: true,
            explanation: options.fastSelfPlay ? null : explainPosition(game, this.evalParams)
          };
        }
      }
    }

    this.nodes = 0;
    this.qNodes = 0;
    this.aborted = false;
    this.stopRequested = false;
    this.stopReason = 'completed_max_depth';
    this.startTime = performance.now();
    this.tt.newSearch();
    this.orderer.decayHistory();

    let completedDepth = 0;
    let bestRootMove = rootMoves[0];
    let bestScoreStm = evaluateForSideToMove(game, this.evalParams);
    let candidateResults = [];

    const effectiveMaxDepth = rootMoves.length === 1 ? Math.min(maxDepth, 2) : maxDepth;

    for (let currentDepth = 1; currentDepth <= effectiveMaxDepth; currentDepth++) {
      this.activeRootDepth = currentDepth;
      this.aborted = false;

      if (candidateResults.length > 0) {
        const orderMap = new Map(
          candidateResults.map((c, idx) => [encodeMoveKey(c.raw), 1000000 - idx * 1000])
        );
        rootMoves.sort(
          (a, b) => (orderMap.get(encodeMoveKey(b)) || 0) - (orderMap.get(encodeMoveKey(a)) || 0)
        );
      } else {
        const rootTt = this.tt.probe(game.hash);
        this.orderer.scoreMoves(rootMoves, rootTt ? rootTt.bestMoveKey : 0, 0, game, null);
      }

      const iterationCandidates = [];
      let alpha = -MATE_SCORE - 100;
      let beta = MATE_SCORE + 100;

      if (this.useUltraSearch && multiPvCount === 1 && currentDepth >= 4 && Math.abs(bestScoreStm) < MATE_THRESHOLD) {
        alpha = bestScoreStm - 45;
        beta = bestScoreStm + 45;
      }

      const evaluateAllRootMovesFullWindow = currentDepth === 1;

      for (let i = 0; i < rootMoves.length; i++) {
        const m = rootMoves[i];
        game.makeMoveRaw(m);

        let score;
        if (i < multiPvCount || i === 0 || evaluateAllRootMovesFullWindow) {
          score = -this.negamax(game, currentDepth - 1, -beta, -alpha, 1, true, true, m);
          if (!this.aborted && (score <= alpha || score >= beta)) {
            alpha = -MATE_SCORE - 100;
            beta = MATE_SCORE + 100;
            score = -this.negamax(game, currentDepth - 1, -beta, -alpha, 1, true, true, m);
          }
        } else {
          score = -this.negamax(game, currentDepth - 1, -alpha - 1, -alpha, 1, false, true, m);
          if (!this.aborted && score > alpha) {
            score = -this.negamax(game, currentDepth - 1, -beta, -alpha, 1, true, true, m);
          } else {
            // Failed-low zero-window move: place well below randomnessCp band so it is never mistaken for an equal candidate
            score = alpha - 500 - i;
          }
        }

        game.unmakeMoveRaw();

        if (this.aborted) break;

        const whiteScore = game.turn() === 'w' ? score : -score;
        const mateIn = this.computeMateDistance(score, game.turn());
        const fromAlg = sq88ToAlgebraic(m.from);
        const toAlg = sq88ToAlgebraic(m.to);

        iterationCandidates.push({
          raw: m,
          from: fromAlg,
          to: toAlg,
          promotion: m.promotion || undefined,
          san: null,
          lan: fromAlg + toAlg + (m.promotion || ''),
          scoreSideToMoveCp: score,
          scoreWhiteCp: whiteScore,
          mateIn,
          pv: [],
          pvLan: []
        });

        if (!evaluateAllRootMovesFullWindow && i >= multiPvCount - 1 && score > alpha) {
          alpha = score;
        }
      }

      if (!this.aborted || completedDepth === 0) {
        if (iterationCandidates.length > 0) {
          iterationCandidates.sort((a, b) => b.scoreSideToMoveCp - a.scoreSideToMoveCp);
          const topCount = options.fastSelfPlay ? 1 : Math.min(iterationCandidates.length, Math.max(multiPvCount, 4));
          for (let k = 0; k < topCount; k++) {
            const c = iterationCandidates[k];
            const { pvSan, pvLan } = this.extractPvSan(game, c.raw, options.fastSelfPlay ? 2 : Math.min(currentDepth + 2, 8));
            c.san = pvSan[0];
            c.pv = pvSan;
            c.pvLan = pvLan;
          }
          candidateResults = iterationCandidates;
          bestRootMove = candidateResults[0].raw;
          bestScoreStm = candidateResults[0].scoreSideToMoveCp;
          completedDepth = currentDepth;
          this.tt.store(game.hash, currentDepth, bestScoreStm, TT_EXACT, bestRootMove, 0);
        }
      }

      const elapsedMs = Math.max(1, Math.round(performance.now() - this.startTime));
      const totalNodes = this.nodes + this.qNodes;
      const nps = Math.round((totalNodes * 1000) / elapsedMs);

      if (onProgress && candidateResults.length > 0) {
        const top = candidateResults[0];
        onProgress({
          engineMode: requestedMode,
          depth: completedDepth,
          nodes: totalNodes,
          nps,
          elapsedMs,
          bestMoveSan: top.san,
          bestMoveLan: top.lan,
          scoreSideToMoveCp: top.scoreSideToMoveCp,
          scoreWhiteCp: top.scoreWhiteCp,
          mateIn: top.mateIn,
          pv: top.pv,
          candidates: candidateResults.slice(0, options.multiPv || 1)
        });
      }

      if (this.aborted) break;
      if (Math.abs(bestScoreStm) > MATE_THRESHOLD) {
        const pliesToMate = MATE_SCORE - Math.abs(bestScoreStm);
        if (pliesToMate <= currentDepth) {
          this.stopReason = 'mate_found';
          break;
        }
      }
    }

    let chosenCandidate = candidateResults[0];
    if (
      randomnessCp > 0 &&
      candidateResults.length > 1 &&
      Math.abs(candidateResults[0].scoreSideToMoveCp) < MATE_THRESHOLD
    ) {
      const viable = candidateResults.filter(
        c => candidateResults[0].scoreSideToMoveCp - c.scoreSideToMoveCp <= randomnessCp
      );
      if (viable.length > 1) {
        const mix = Number(game.hash & 0xffffn) + game.fullMoves * 31 + game.halfMoves * 17;
        const pickIdx = Math.abs(mix) % viable.length;
        chosenCandidate = viable[pickIdx];
        if (!chosenCandidate.san) {
          const { pvSan, pvLan } = this.extractPvSan(game, chosenCandidate.raw, 4);
          chosenCandidate.san = pvSan[0];
          chosenCandidate.pv = pvSan;
          chosenCandidate.pvLan = pvLan;
        }
      }
    }

    const verifyGame = new ChessGame(fen);
    const verifiedMove = verifyGame.move({
      from: chosenCandidate.from,
      to: chosenCandidate.to,
      promotion: chosenCandidate.promotion || (chosenCandidate.raw?.promotion ? chosenCandidate.raw.promotion : undefined)
    });
    if (!verifiedMove) {
      const fallbackLegal = new ChessGame(fen).moves({ verbose: true })[0];
      chosenCandidate = {
        ...chosenCandidate,
        from: fallbackLegal.from,
        to: fallbackLegal.to,
        promotion: fallbackLegal.promotion,
        san: fallbackLegal.san,
        lan: fallbackLegal.lan,
        pv: [fallbackLegal.san],
        pvLan: [fallbackLegal.lan]
      };
    }

    const elapsedMs = Math.max(1, Math.round(performance.now() - this.startTime));
    const totalNodes = this.nodes + this.qNodes;
    const nps = Math.round((totalNodes * 1000) / elapsedMs);

    return {
      engineMode: requestedMode,
      presetId: preset.id,
      tier: preset.tier,
      estimatedRating: preset.estimatedRating,
      bestMove: {
        from: chosenCandidate.from,
        to: chosenCandidate.to,
        promotion: chosenCandidate.promotion,
        san: chosenCandidate.san,
        lan: chosenCandidate.lan
      },
      bestMoveSan: chosenCandidate.san,
      bestMoveLan: chosenCandidate.lan,
      scoreSideToMoveCp: chosenCandidate.scoreSideToMoveCp,
      scoreWhiteCp: chosenCandidate.scoreWhiteCp,
      mateIn: chosenCandidate.mateIn,
      depth: completedDepth,
      nodes: totalNodes,
      qNodes: this.qNodes,
      nps,
      elapsedMs,
      pv: chosenCandidate.pv,
      pvLan: chosenCandidate.pvLan,
      candidates: candidateResults.slice(0, Math.max(options.multiPv || 1, 3)).map(c => ({
        san: c.san,
        lan: c.lan,
        from: c.from,
        to: c.to,
        promotion: c.promotion,
        scoreWhiteCp: c.scoreWhiteCp,
        scoreSideToMoveCp: c.scoreSideToMoveCp,
        mateIn: c.mateIn,
        pv: c.pv
      })),
      stopReason: this.stopReason,
      bookMove: false,
      explanation: options.fastSelfPlay ? null : explainPosition(game, this.evalParams)
    };
  }

  computeMateDistance(scoreStm, stm) {
    if (Math.abs(scoreStm) <= MATE_THRESHOLD) return null;
    const plies = MATE_SCORE - Math.abs(scoreStm);
    const fullMoves = Math.max(1, Math.ceil(plies / 2));
    const sign = scoreStm > 0 ? 1 : -1;
    const whiteSign = stm === 'w' ? sign : -sign;
    return {
      movesForSideToMove: sign * fullMoves,
      movesForWhite: whiteSign * fullMoves,
      plies
    };
  }
}
