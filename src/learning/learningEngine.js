/**
 * Experimental Learning Engine & Parallel Headless Self-Play Training Laboratory
 * Implements:
 * - Parameterized 24-weight evaluation vector with documented safe bounds
 * - Seeded SplitMix32 PRNG for 100% reproducible experiments
 * - SPSA / Adaptive Evolutionary Parameter Perturbation
 * - 16 Diverse Opening Book Roots with Balanced Color-Swapped Match Pairs
 * - 8-Position Mandatory Tactical Regression Gate
 * - Multiple Opponent Modes (Current Champion, Self-Play Diagnostic, Previous Checkpoints, Built-in Difficulty Tiers)
 * - Statistical Promotion Gate with Confidence Margin & Rollback Protection
 * - Engine Ladder Calibration & Benchmark Suite
 */

import { ChessGame } from '../game/ChessGame.js';
import { DEFAULT_EVAL_PARAMS, PARAM_BOUNDS, evaluatePositionWhite } from '../engine/evaluation.js';
import { CathedralEngine, DIFFICULTY_PRESETS, resolveDifficultyPreset } from '../engine/CathedralEngine.js';

const LEARNING_STORAGE_KEY = 'wizards_chess_cathedral_learning_state_v2';

export const TRAINING_OPENING_SUITE = [
  { eco: 'C50', name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { eco: 'C65', name: 'Ruy Lopez: Berlin', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'C42', name: "Petrov's Defense", moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { eco: 'C44', name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4'] },
  { eco: 'B50', name: 'Sicilian Defense: Open', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'] },
  { eco: 'B23', name: 'Sicilian: Closed', moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6'] },
  { eco: 'C11', name: 'French Defense: Classical', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'] },
  { eco: 'B12', name: 'Caro-Kann: Advance', moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'] },
  { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'] },
  { eco: 'D35', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'] },
  { eco: 'D15', name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6'] },
  { eco: 'D02', name: 'London System', moves: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5'] },
  { eco: 'E61', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'] },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'A20', name: 'English Opening', moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6'] },
  { eco: 'A07', name: "King's Indian Attack", moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'c6'] }
];

export const TACTICAL_REGRESSION_SUITE = [
  {
    id: 'reg-mate-1-backrank',
    name: 'Back-Rank Mate in 1',
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    expectedSan: ['Re8#']
  },
  {
    id: 'reg-mate-1-scholar',
    name: 'f7 Battery Mate in 1',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    expectedSan: ['Qxf7#']
  },
  {
    id: 'reg-mate-1-smothered',
    name: 'Smothered Mate in 1',
    fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1',
    expectedSan: ['Nf7#']
  },
  {
    id: 'reg-mate-2-battery',
    name: 'Rook Clearance Mate in 2',
    fen: 'r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1',
    expectedSan: ['Re8+']
  },
  {
    id: 'reg-mate-2-queen-sac',
    name: 'Queen Sacrifice Mate in 2',
    fen: 'r5k1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1',
    expectedSan: ['Qe8+']
  },
  {
    id: 'reg-defend-mate',
    name: 'Defend Immediate Mate Threat',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
    forbiddenNextWhiteSan: 'Qxf7#'
  },
  {
    id: 'reg-win-queen',
    name: 'Capture Undefended Central Queen',
    fen: '4k3/8/8/3q4/8/2N5/P7/4K3 w - - 0 1',
    expectedSan: ['Nxd5']
  },
  {
    id: 'reg-promote-pawn',
    name: 'Unstoppable Pawn Promotion',
    fen: '7k/2P5/8/8/8/8/8/4K3 w - - 0 1',
    expectedSan: ['c8=Q', 'c8=Q+', 'c8=R', 'c8=R#']
  }
];

export class SeededRandom {
  constructor(seed = 42) {
    this.state = (Number(seed) || 42) >>> 0;
  }

  nextFloat() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextRange(min, max) {
    return min + this.nextFloat() * (max - min);
  }
}

/**
 * Perturb a champion parameter vector using SPSA / evolutionary perturbation within safe bounds.
 */
export function generateCandidateParams(championParams, seed = Date.now(), explorationPct = 8) {
  const rng = new SeededRandom(seed);
  const candidate = { ...DEFAULT_EVAL_PARAMS, ...championParams };
  const changes = [];
  const scale = Math.max(2, Math.min(25, explorationPct)) / 100;

  const keys = Object.keys(PARAM_BOUNDS);
  for (const key of keys) {
    if (rng.nextFloat() < 0.48) {
      const bound = PARAM_BOUNDS[key];
      const span = bound.max - bound.min;
      const delta = Math.round((rng.nextFloat() * 2 - 1) * span * scale);
      if (delta !== 0) {
        const oldVal = candidate[key];
        const newVal = Math.max(bound.min, Math.min(bound.max, oldVal + delta));
        if (newVal !== oldVal) {
          candidate[key] = newVal;
          changes.push({
            key,
            label: bound.label,
            oldValue: oldVal,
            newValue: newVal,
            delta: newVal - oldVal
          });
        }
      }
    }
  }

  if (changes.length === 0) {
    const key = keys[Math.floor(rng.nextFloat() * keys.length)];
    const bound = PARAM_BOUNDS[key];
    const oldVal = candidate[key];
    const step = oldVal + 4 <= bound.max ? 4 : -4;
    candidate[key] = oldVal + step;
    changes.push({
      key,
      label: bound.label,
      oldValue: oldVal,
      newValue: candidate[key],
      delta: step
    });
  }

  return { candidateParams: candidate, parameterChanges: changes };
}

/**
 * Run the 8-Position Mandatory Tactical Regression Suite on `candidateParams`.
 */
export function runTacticalRegressionSuite(candidateParams) {
  const engine = new CathedralEngine(1 << 14);
  const results = [];
  let passedCount = 0;

  for (const testCase of TACTICAL_REGRESSION_SUITE) {
    const res = engine.search(testCase.fen, {
      difficulty: 'Competitor',
      maxDepth: 3,
      timeLimitMs: 180,
      nodeLimit: 5000,
      evalParams: candidateParams
    });

    let passed = false;
    if (testCase.expectedSan) {
      passed = Boolean(res.bestMoveSan && testCase.expectedSan.includes(res.bestMoveSan));
    } else if (testCase.forbiddenNextWhiteSan) {
      const g = new ChessGame(testCase.fen);
      if (res.bestMove) {
        g.move(res.bestMove);
        passed = !g.moves().includes(testCase.forbiddenNextWhiteSan);
      }
    }

    if (passed) passedCount++;
    results.push({
      id: testCase.id,
      name: testCase.name,
      bestMoveSan: res.bestMoveSan,
      passed
    });
  }

  return {
    passedAll: passedCount === TACTICAL_REGRESSION_SUITE.length,
    passedCount,
    totalCount: TACTICAL_REGRESSION_SUITE.length,
    results
  };
}

/**
 * Simulate a single headless self-play game between Candidate and Opponent
 * with zero DOM overhead and bounded memory.
 */
export function simulateSingleHeadlessGame({
  gameIndex = 0,
  openingIndex = 0,
  candidateColor = 'w',
  candidateParams,
  championParams,
  opponentPresetId = null,
  maxDepth = 2,
  timeLimitMs = 20,
  maxPlies = 96,
  seed = 101
}) {
  const opening = TRAINING_OPENING_SUITE[(openingIndex || gameIndex) % TRAINING_OPENING_SUITE.length];
  const game = new ChessGame();
  const moveSanList = [];
  const moveEvalsWhite = [];

  for (const san of opening.moves) {
    const mv = game.move(san);
    if (mv) {
      moveSanList.push(mv.san);
      moveEvalsWhite.push(evaluatePositionWhite(game, false, candidateParams));
    }
  }

  // Deterministic diversification on ply 7 so pairs from the same root explore distinct lines
  const rng = new SeededRandom(seed + Math.floor(gameIndex / 2) * 7919);
  if (!game.game_over()) {
    const legals = game.moves({ verbose: true });
    if (legals.length > 1) {
      const pick = legals[Math.floor(rng.nextFloat() * Math.min(legals.length, 4))];
      const mv = game.move(pick);
      if (mv) {
        moveSanList.push(mv.san);
        moveEvalsWhite.push(evaluatePositionWhite(game, false, candidateParams));
      }
    }
  }

  const startTime = performance.now();
  const engineW = new CathedralEngine(1 << 13);
  const engineB = new CathedralEngine(1 << 13);

  const oppPreset = opponentPresetId ? resolveDifficultyPreset(opponentPresetId) : null;

  let totalNodes = 0;
  let depthSum = 0;
  let searchMovesCount = 0;
  let terminationReason = 'Checkmate';

  while (!game.game_over() && moveSanList.length < maxPlies) {
    const stm = game.turn();
    const isCand = stm === candidateColor;
    const activeEngine = stm === 'w' ? engineW : engineB;
    const activeParams = isCand ? candidateParams : championParams;

    const searchOpts =
      !isCand && oppPreset
        ? {
            difficulty: oppPreset.id,
            maxDepth: Math.min(oppPreset.maxDepth, maxDepth + 1),
            timeLimitMs: Math.min(oppPreset.timeLimitMs, timeLimitMs * 2),
            nodeLimit: Math.min(oppPreset.nodeLimit, 6000),
            evalParams: championParams,
            hashHistory: game.hashHistory,
            fastSelfPlay: true
          }
        : {
            difficulty: maxDepth >= 4 ? 'Competitor' : 'ClubPlayer',
            maxDepth,
            timeLimitMs,
            nodeLimit: maxDepth >= 4 ? 8000 : maxDepth === 3 ? 1800 : 550,
            evalParams: activeParams,
            hashHistory: game.hashHistory,
            fastSelfPlay: true
          };

    const res = activeEngine.search(game.fen(), searchOpts);

    if (!res.bestMove) break;
    const applied = game.move(res.bestMove);
    if (!applied) break;

    moveSanList.push(applied.san);
    moveEvalsWhite.push(res.scoreWhiteCp);
    totalNodes += res.nodes || 0;
    depthSum += res.depth || 1;
    searchMovesCount++;
  }

  let winnerColor = 'draw';
  if (game.in_checkmate()) {
    winnerColor = game.turn() === 'w' ? 'b' : 'w';
    terminationReason = 'Checkmate';
  } else if (game.in_stalemate()) {
    terminationReason = 'Stalemate';
  } else if (game.in_threefold_repetition()) {
    terminationReason = 'Threefold Repetition';
  } else if (game.in_fifty_move_rule()) {
    terminationReason = '50-Move Rule';
  } else if (game.insufficient_material()) {
    terminationReason = 'Insufficient Material';
  } else {
    const finalEvalWhite = evaluatePositionWhite(game, false, DEFAULT_EVAL_PARAMS);
    if (finalEvalWhite >= 180) {
      winnerColor = 'w';
      terminationReason = `Adjudicated (+${(finalEvalWhite / 100).toFixed(2)})`;
    } else if (finalEvalWhite <= -180) {
      winnerColor = 'b';
      terminationReason = `Adjudicated (${(finalEvalWhite / 100).toFixed(2)})`;
    } else {
      terminationReason = 'Max Plies Draw';
    }
  }

  const candidateOutcome =
    winnerColor === 'draw' ? 'draw' : winnerColor === candidateColor ? 'win' : 'loss';

  const durationMs = Math.max(1, Math.round(performance.now() - startTime));

  return {
    gameIndex,
    openingEco: opening.eco,
    openingName: opening.name,
    candidateColor,
    winnerColor,
    candidateOutcome,
    terminationReason,
    plies: moveSanList.length,
    moves: moveSanList,
    pgn: game.pgn(),
    evalsWhite: moveEvalsWhite,
    finalFen: game.fen(),
    totalNodes,
    avgDepth: searchMovesCount > 0 ? Number((depthSum / searchMovesCount).toFixed(1)) : maxDepth,
    durationMs
  };
}

/**
 * Evaluates whether a Candidate should be promoted to Champion based on match score
 * and mandatory tactical regression suite results.
 */
export function evaluatePromotionDecision({
  wins,
  draws,
  losses,
  regressionResult
}) {
  const totalGames = wins + draws + losses;
  const points = wins + draws * 0.5;
  const scorePct = totalGames > 0 ? Number(((points / totalGames) * 100).toFixed(1)) : 50.0;
  const stdErrPct = totalGames > 0 ? Number((50 / Math.sqrt(totalGames)).toFixed(1)) : 50.0;
  const eloDeltaEst =
    scorePct > 1 && scorePct < 99
      ? Math.round(-400 * Math.log10(1 / (scorePct / 100) - 1))
      : wins > losses
      ? 150
      : -150;

  if (!regressionResult.passedAll) {
    return {
      status: 'rejected',
      promoted: false,
      scorePct,
      stdErrPct,
      eloDeltaEst,
      reason: `Rejected: Candidate failed ${regressionResult.totalCount - regressionResult.passedCount} mandatory tactical regression test(s). Champion retained.`
    };
  }

  if (wins > losses && scorePct >= 52.0) {
    return {
      status: 'promoted',
      promoted: true,
      scorePct,
      stdErrPct,
      eloDeltaEst,
      reason: `Promoted to New Champion: Candidate scored ${scorePct}% (±${stdErrPct}%) with ${wins}W–${draws}D–${losses}L across ${totalGames} balanced games and passed 100% of tactical regression tests.`
    };
  }

  if (wins < losses) {
    return {
      status: 'rejected',
      promoted: false,
      scorePct,
      stdErrPct,
      eloDeltaEst,
      reason: `Rejected: Candidate underperformed the baseline (${wins}W–${draws}D–${losses}L, ${scorePct}%). Champion retained.`
    };
  }

  return {
    status: 'inconclusive',
    promoted: false,
    scorePct,
    stdErrPct,
    eloDeltaEst,
    reason: `Inconclusive (${scorePct}% ±${stdErrPct}%, ${wins}W–${draws}D–${losses}L): Match margin did not exceed the promotion threshold (>52.0% with net win lead). Reigning Champion preserved.`
  };
}

export function createInitialLearningState() {
  return {
    experimentName: 'Sanctuary Self-Play Evolution',
    methodName: 'Seeded SPSA / Evolutionary Evaluation Vector Optimisation (24 Parameters)',
    currentVersion: 'v1.0',
    generation: 0,
    seed: 202610,
    totalGamesSimulated: 0,
    totalPliesSimulated: 0,
    totalNodesSearched: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    inconclusiveCount: 0,
    championParams: { ...DEFAULT_EVAL_PARAMS },
    checkpoints: [
      {
        version: 'v1.0',
        generation: 0,
        timestamp: new Date().toISOString(),
        params: { ...DEFAULT_EVAL_PARAMS },
        scorePct: 50.0,
        summary: 'Baseline Handcrafted Cathedral Evaluation',
        parameterChanges: []
      }
    ],
    generationHistory: [],
    sampleGames: [],
    lastBatchReport: null
  };
}

export function loadLearningState() {
  try {
    if (typeof localStorage === 'undefined') return createInitialLearningState();
    const raw = localStorage.getItem(LEARNING_STORAGE_KEY);
    if (!raw) return createInitialLearningState();
    const parsed = JSON.parse(raw);
    return {
      ...createInitialLearningState(),
      ...parsed,
      championParams: { ...DEFAULT_EVAL_PARAMS, ...(parsed.championParams || {}) }
    };
  } catch (_e) {
    return createInitialLearningState();
  }
}

export function saveLearningState(state) {
  try {
    if (typeof localStorage === 'undefined') return false;
    const compact = {
      ...state,
      checkpoints: (state.checkpoints || []).slice(0, 25),
      generationHistory: (state.generationHistory || []).slice(-50),
      sampleGames: (state.sampleGames || []).slice(0, 24)
    };
    localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(compact));
    return true;
  } catch (_e) {
    return false;
  }
}
