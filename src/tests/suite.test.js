/**
 * Master Automated Verification & Benchmark Test Suite (`src/tests/suite.test.js`)
 *
 * Runs via `node --test src/tests/suite.test.js` and verifies:
 * 1. Orthodox FIDE chess rules, Perft(1..3), Kiwipete Perft, castling, en passant, check/pin legality
 * 2. Mandatory Pawn Promotion Regression (Q/R/B/N, capture-promotions, underpromotion, atomic lock)
 * 3. Undo, Redo, Capture Trays, and Move-by-Move Replay (`getPositionAtPly`)
 * 4. Engine Opening Imitation Regression (both colours, book on/off, turn isolation)
 * 5. 12-Tier Difficulty Ladder Benchmarks, Tactical Suite, and Colour-Balanced Match Verification
 * 6. 5-Tier Progressive Hints, 11-Layer X-Ray Tactical Intelligence, and Post-Game Review Summary
 * 7. Experimental Learning Engine Determinism, Regression Gating, and Promotion Rules
 * 8. Serverless URL Sharing (`#cathedral=...` & `#fen=...`), Safe URL Size Guard, and Local ELO Rating
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ChessGame, validateFen, DEFAULT_FEN, sq88ToAlgebraic } from '../game/ChessGame.js';
import {
  CathedralEngine,
  resolveDifficultyPreset
} from '../engine/CathedralEngine.js';
import { explainPosition, DEFAULT_EVAL_PARAMS, PARAM_BOUNDS } from '../engine/evaluation.js';
import {
  VERIFIED_PUZZLES,
  ENDGAME_LESSONS,
  classifyPlayedMove,
  detectOpening,
  computeProgressiveHints,
  computeGameReviewSummary,
  extractBlunderPuzzlesFromTimeline
} from '../analysis/moveReview.js';
import { computeXRayAnalysis, evaluateBeforeMoveWarning } from '../xray/xrayEngine.js';
import {
  generateCandidateParams,
  runTacticalRegressionSuite,
  simulateSingleHeadlessGame,
  evaluatePromotionDecision
} from '../learning/learningEngine.js';
import {
  decodeGameFromUrlHash,
  buildSafeSharePayload
} from '../sharing/shareUrl.js';
import { validateGameRecord, updatePlayerRating } from '../persistence/storage.js';
import { GameClock } from '../game/gameClock.js';

test('1. Rules: Initial board contains 64 squares and 32 pieces', () => {
  const game = new ChessGame();
  const b = game.board();
  assert.equal(b.length, 8);
  let squares = 0;
  let pieces = 0;
  for (const row of b) {
    assert.equal(row.length, 8);
    for (const cell of row) {
      squares++;
      if (cell) pieces++;
    }
  }
  assert.equal(squares, 64);
  assert.equal(pieces, 32);
});

test('2. Rules: Initial position has 20 legal moves and 1.e4 updates state accurately', () => {
  const game = new ChessGame();
  const legal = game.moves();
  assert.equal(legal.length, 20);

  const mv = game.move('e4');
  assert.ok(mv);
  assert.equal(mv.from, 'e2');
  assert.equal(mv.to, 'e4');
  assert.equal(game.turn(), 'b');
  assert.deepEqual(game.get('e4'), { type: 'p', color: 'w' });
  assert.equal(game.get('e2'), null);
});

test('3. Rules: Perft(1)=20, Perft(2)=400, Perft(3)=8,902 from initial position', () => {
  const game = new ChessGame();
  assert.equal(game.perft(1), 20);
  assert.equal(game.perft(2), 400);
  assert.equal(game.perft(3), 8902);
});

test('4. Rules: Kiwipete complex position Perft(1)=48, Perft(2)=2,039', () => {
  const game = new ChessGame('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(game.perft(1), 48);
  assert.equal(game.perft(2), 2039);
});

test('5. Rules: Rejects illegal moves and prevents moving King into check or moving pinned piece', () => {
  const game = new ChessGame('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
  const illegalBishop = game.move({ from: 'e2', to: 'd3' });
  assert.equal(illegalBishop, null);

  const game2 = new ChessGame('4k3/4r3/8/8/8/8/8/3K4 w - - 0 1');
  const illegalKing = game2.move({ from: 'd1', to: 'e1' });
  assert.equal(illegalKing, null);
});

test('6. Rules: Both kingside and queenside castling work and update castling rights', () => {
  const game = new ChessGame('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  const castleK = game.move('O-O');
  assert.ok(castleK);
  assert.deepEqual(game.get('g1'), { type: 'k', color: 'w' });
  assert.deepEqual(game.get('f1'), { type: 'r', color: 'w' });

  const castleQBlack = game.move('O-O-O');
  assert.ok(castleQBlack);
  assert.deepEqual(game.get('c8'), { type: 'k', color: 'b' });
  assert.deepEqual(game.get('d8'), { type: 'r', color: 'b' });
  assert.ok(game.fen().includes(' - - '));

  game.undo();
  game.undo();
  assert.equal(game.fen(), 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
});

test('7. Rules: En passant works and removes the captured pawn from its actual square', () => {
  const game = new ChessGame();
  game.move('e4');
  game.move('a6');
  game.move('e5');
  game.move('d5');
  const ep = game.move('exd6');
  assert.ok(ep);
  assert.equal(ep.flags, 'e');
  assert.deepEqual(game.get('d6'), { type: 'p', color: 'w' });
  assert.equal(game.get('d5'), null);

  game.undo();
  assert.deepEqual(game.get('d5'), { type: 'p', color: 'b' });
  assert.deepEqual(game.get('e5'), { type: 'p', color: 'w' });
});

test('8. Mandatory Regression: Pawn Promotion (Q, R, B, N), Capture-Promotions, Both Directions, and Explicit Promotion Lock', () => {
  const whitePromoFen = '3r1b1k/4P3/8/8/8/8/8/4K3 w - - 0 1';
  const probeGame = new ChessGame(whitePromoFen);
  assert.equal(probeGame.isPromotionMove('e7', 'e8'), true);
  assert.equal(probeGame.isPromotionMove('e7', 'd8'), true);
  assert.equal(probeGame.isPromotionMove('e7', 'f8'), true);
  assert.equal(probeGame.getPromotionMoves('e7', 'd8').length, 4);

  const lockedAttempt = probeGame.move({ from: 'e7', to: 'e8' }, { requireExplicitPromotion: true });
  assert.equal(lockedAttempt, null, 'Move must not commit before explicit promotion piece is chosen');
  assert.equal(probeGame.turn(), 'w', 'Turn must remain White while promotion choice is pending');
  assert.deepEqual(probeGame.get('e7'), { type: 'p', color: 'w' });

  for (const promo of ['q', 'r', 'b', 'n']) {
    const gPush = new ChessGame(whitePromoFen);
    const mvPush = gPush.move({ from: 'e7', to: 'e8', promotion: promo }, { requireExplicitPromotion: true });
    assert.ok(mvPush);
    assert.equal(mvPush.promotion, promo);
    assert.deepEqual(gPush.get('e8'), { type: promo, color: 'w' });
    assert.equal(gPush.turn(), 'b');

    const gCapLeft = new ChessGame(whitePromoFen);
    const mvCapLeft = gCapLeft.move({ from: 'e7', to: 'd8', promotion: promo }, { requireExplicitPromotion: true });
    assert.ok(mvCapLeft);
    assert.equal(mvCapLeft.captured, 'r');
    assert.equal(mvCapLeft.promotion, promo);
    assert.deepEqual(gCapLeft.get('d8'), { type: promo, color: 'w' });
    assert.deepEqual(gCapLeft.getCapturedPieces().capturedByWhite, ['r']);

    const gCapRight = new ChessGame(whitePromoFen);
    const mvCapRight = gCapRight.move({ from: 'e7', to: 'f8', promotion: promo }, { requireExplicitPromotion: true });
    assert.ok(mvCapRight);
    assert.equal(mvCapRight.captured, 'b');
    assert.equal(mvCapRight.promotion, promo);
    assert.deepEqual(gCapRight.get('f8'), { type: promo, color: 'w' });
  }

  const blackPromoFen = '4k3/8/8/8/8/8/4p3/3R1N1K b - - 0 1';
  for (const promo of ['q', 'r', 'b', 'n']) {
    const gBlack = new ChessGame(blackPromoFen);
    const mvB = gBlack.move({ from: 'e2', to: 'd1', promotion: promo }, { requireExplicitPromotion: true });
    assert.ok(mvB);
    assert.equal(mvB.captured, 'r');
    assert.equal(mvB.promotion, promo);
    assert.deepEqual(gBlack.get('d1'), { type: promo, color: 'b' });
    assert.deepEqual(gBlack.getCapturedPieces().capturedByBlack, ['r']);
  }

  const gSan = new ChessGame(whitePromoFen);
  assert.ok(gSan.move('exd8=N'));
  assert.deepEqual(gSan.get('d8'), { type: 'n', color: 'w' });
});

test('9. Rules: Undo, Redo, Capture Trays, and Replay Position Reconstruction (`getPositionAtPly`)', () => {
  const game = new ChessGame();
  game.move('e4');
  game.move('d5');
  game.move('exd5');
  game.move('Qxd5');

  const capsAt4 = game.getCapturedPieces();
  assert.deepEqual(capsAt4.capturedByWhite, ['p']);
  assert.deepEqual(capsAt4.capturedByBlack, ['p']);

  const posAt3 = game.getPositionAtPly(3);
  assert.deepEqual(posAt3.get('d5'), { type: 'p', color: 'w' });
  assert.deepEqual(game.getCapturedPieces(3).capturedByWhite, ['p']);
  assert.deepEqual(game.getCapturedPieces(3).capturedByBlack, []);

  game.undo();
  assert.equal(game.canRedo(), true);
  assert.deepEqual(game.get('d5'), { type: 'p', color: 'w' });
  const redone = game.redo();
  assert.ok(redone);
  assert.equal(redone.san, 'Qxd5');
  assert.deepEqual(game.get('d5'), { type: 'q', color: 'b' });
});

test('10. Rules: Checkmate, stalemate, threefold repetition, 50-move rule, and insufficient material', () => {
  const fools = new ChessGame();
  fools.move('f3');
  fools.move('e5');
  fools.move('g4');
  fools.move('Qh4#');
  assert.equal(fools.in_checkmate(), true);
  assert.equal(fools.game_over(), true);

  const stale = new ChessGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stale.in_stalemate(), true);
  assert.equal(stale.in_draw(), true);

  const insuff = new ChessGame('4k3/8/8/8/8/8/4B3/4K3 w - - 0 1');
  assert.equal(insuff.insufficient_material(), true);
  assert.equal(insuff.in_draw(), true);

  const fifty = new ChessGame('4k3/8/8/8/8/8/R7/4K3 w - - 100 60');
  assert.equal(fifty.in_fifty_move_rule(), true);
  assert.equal(fifty.in_draw(), true);

  const rep = new ChessGame();
  for (let i = 0; i < 2; i++) {
    rep.move('Nf3');
    rep.move('Nf6');
    rep.move('Ng1');
    rep.move('Ng8');
  }
  assert.equal(rep.in_threefold_repetition(), true);
  assert.equal(rep.in_draw(), true);
});

test('11. Rules: PGN and FEN import and export preserve position and move history', () => {
  const game = new ChessGame();
  const seq = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'];
  for (const s of seq) game.move(s);
  const exportedPgn = game.pgn();
  const exportedFen = game.fen();

  const reloaded = new ChessGame();
  assert.equal(reloaded.load_pgn(exportedPgn), true);
  assert.equal(reloaded.fen(), exportedFen);
  assert.deepEqual(reloaded.history(), seq);
});

test('12. Mandatory Regression: Engine Opening Imitation Bug & Turn Verification (Book On & Off, Both Colours)', () => {
  const engine = new CathedralEngine();
  for (const useOpeningBook of [true, false]) {
    for (const firstMove of ['e4', 'd4', 'Nf3', 'c4']) {
      const game = new ChessGame();
      const humanMoved = game.move(firstMove);
      assert.ok(humanMoved);
      assert.equal(game.turn(), 'b');

      const reply = engine.search(game.fen(), {
        difficulty: 'ClubPlayer',
        useOpeningBook
      });
      assert.ok(reply.bestMove);
      assert.notEqual(
        reply.bestMove.from,
        humanMoved.from,
        'Engine reply for Black must originate from a Black square, never copying White’s origin square'
      );
      const applied = game.move(reply.bestMove);
      assert.ok(applied, `Engine reply ${reply.bestMoveSan} must be legal for Black`);
      assert.equal(applied.color, 'b');
      assert.equal(game.turn(), 'w');
    }
  }
});

test('13. Engine Ladder: All 12 Difficulty Tiers + Experimental Return Legal Moves and Increasing Search Depth/Nodes', () => {
  const engine = new CathedralEngine();
  const testFen = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 6';
  const tierIds = [
    'FirstSteps',
    'Beginner',
    'Learner',
    'ClubRookie',
    'ClubPlayer',
    'ClubAdvanced',
    'Competitor',
    'Advanced',
    'Expert',
    'Master',
    'GrandmasterChallenge',
    'CathedralApex',
    'Experimental'
  ];

  const metrics = [];
  for (const id of tierIds) {
    const preset = resolveDifficultyPreset(id);
    assert.ok(preset);
    const res = engine.search(testFen, {
      difficulty: id,
      timeLimitMs: Math.min(preset.timeLimitMs, 260),
      nodeLimit: Math.min(preset.nodeLimit, 25000),
      useOpeningBook: false
    });
    assert.ok(res.bestMove, `Tier ${id} must return a move`);
    const verify = new ChessGame(testFen);
    assert.ok(verify.move(res.bestMove), `Tier ${id} returned illegal move ${res.bestMoveSan}`);
    metrics.push({ id, tier: preset.tier, depth: res.depth, nodes: res.nodes });
  }

  const firstStepsMetric = metrics.find(m => m.id === 'FirstSteps');
  const apexMetric = metrics.find(m => m.id === 'CathedralApex');
  assert.ok(apexMetric.depth > firstStepsMetric.depth);
  assert.ok(apexMetric.nodes > firstStepsMetric.nodes);
});

test('14. Engine Tactical Quality: Finds Mate in 1, Mate in 2, Defends Mate Threat, and Discriminates Winning/Losing SEE', () => {
  const engine = new CathedralEngine();
  const m1 = engine.search('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', { difficulty: 'Competitor', maxDepth: 3 });
  assert.equal(m1.bestMoveSan, 'Re8#');
  assert.equal(m1.mateIn.movesForWhite, 1);

  const m2 = engine.search('r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1', {
    difficulty: 'Expert',
    maxDepth: 4,
    timeLimitMs: 1200
  });
  assert.equal(m2.bestMoveSan, 'Re8+');
  assert.equal(m2.mateIn.movesForWhite, 2);

  const threatFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
  const def = engine.search(threatFen, { difficulty: 'Competitor', maxDepth: 4, timeLimitMs: 800 });
  const g = new ChessGame(threatFen);
  g.move(def.bestMove);
  assert.equal(g.moves().includes('Qxf7#'), false);

  const seeGame = new ChessGame('4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1');
  const qxd5 = seeGame.generateLegalMovesRaw(true).find(m => m.piece === 'q' && sq88ToAlgebraic(m.to) === 'd5');
  assert.ok(seeGame.staticExchangeEvaluation(qxd5) < -500);
});

test('15. 5-Tier Progressive Hints & 11-Layer X-Ray Tactical Intelligence', () => {
  const pinGame = new ChessGame('r1b1kbnr/ppp2ppp/2n5/1B2p3/3qP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4');
  const engine = new CathedralEngine();
  const engRes = engine.search(pinGame.fen(), { difficulty: 'ClubPlayer', maxDepth: 3 });
  const xray = computeXRayAnalysis(pinGame, engRes);

  assert.ok(xray.attackMap['d4'].whiteCount >= 1);
  assert.ok(xray.hangingPieces.length >= 1);
  for (const h of xray.hangingPieces) {
    assert.ok(typeof h.description === 'string' && h.description.length > 5);
  }
  assert.ok(xray.pinsAndDiscovered.some(m => m.type === 'Pin' && m.square === 'c6'));
  assert.ok(xray.candidateArrows.length >= 1);
  assert.ok(xray.pvArrows.length >= 1);

  const hints = computeProgressiveHints(pinGame, engRes, xray);
  assert.equal(hints.available, true);
  assert.equal(hints.tiers.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(hints.tiers[i].level, i + 1);
    assert.ok(hints.tiers[i].text.length > 10);
  }
  const checkHintLegal = new ChessGame(pinGame.fen());
  assert.ok(checkHintLegal.move(hints.recommendedMove));

  const hangQueenGame = new ChessGame('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3');
  const warn = evaluateBeforeMoveWarning(hangQueenGame, { from: 'd1', to: 'g4' }, engine);
  assert.ok(warn);
  assert.ok(warn.cpDrop >= 200);
});

test('16. Post-Game Review Summary & Move Classifications', () => {
  const sanHistory = ['e4', 'e5', 'Nf3', 'Nc6'];
  const moveMeta = [
    {
      san: 'e4',
      byPlayer: 'w',
      scoreWhiteCp: 25,
      classification: classifyPlayedMove({
        playedSan: 'e4',
        bestSan: 'e4',
        bestScoreForMoverCp: 25,
        playedScoreForMoverCp: 25,
        searchDepth: 4
      })
    },
    {
      san: 'e5',
      byPlayer: 'b',
      scoreWhiteCp: 20,
      classification: classifyPlayedMove({
        playedSan: 'e5',
        bestSan: 'e5',
        bestScoreForMoverCp: -20,
        playedScoreForMoverCp: -20,
        searchDepth: 4
      })
    },
    {
      san: 'Nf3',
      byPlayer: 'w',
      scoreWhiteCp: 30,
      classification: classifyPlayedMove({
        playedSan: 'Nf3',
        bestSan: 'd4',
        bestScoreForMoverCp: 30,
        playedScoreForMoverCp: 18,
        searchDepth: 4
      })
    },
    {
      san: 'Nc6',
      byPlayer: 'b',
      scoreWhiteCp: 280,
      classification: classifyPlayedMove({
        playedSan: 'Nc6',
        bestSan: 'Nf6',
        bestScoreForMoverCp: -20,
        playedScoreForMoverCp: -280,
        searchDepth: 4
      })
    }
  ];

  const summary = computeGameReviewSummary(sanHistory, moveMeta);
  assert.equal(summary.w.best, 1);
  assert.equal(summary.w.excellent, 1);
  assert.equal(summary.b.blunder, 1);
  assert.ok(summary.w.accuracy >= 90);
  assert.equal(summary.criticalMoments.length, 1);
});

test('17. Experimental Learning Engine: Seeded Determinism, Regression Suite, and Promotion Gate', () => {
  const run1 = generateCandidateParams(DEFAULT_EVAL_PARAMS, 98765, 10);
  const run2 = generateCandidateParams(DEFAULT_EVAL_PARAMS, 98765, 10);
  assert.deepEqual(run1.candidateParams, run2.candidateParams);
  assert.deepEqual(run1.parameterChanges, run2.parameterChanges);

  for (const [k, bound] of Object.entries(PARAM_BOUNDS)) {
    assert.ok(run1.candidateParams[k] >= bound.min && run1.candidateParams[k] <= bound.max);
  }

  const reg = runTacticalRegressionSuite(DEFAULT_EVAL_PARAMS);
  assert.equal(reg.passedAll, true);

  const g1 = simulateSingleHeadlessGame({
    gameIndex: 0,
    openingIndex: 1,
    candidateColor: 'w',
    candidateParams: run1.candidateParams,
    championParams: DEFAULT_EVAL_PARAMS,
    maxDepth: 2,
    timeLimitMs: 50,
    maxPlies: 24,
    seed: 555
  });
  const g2 = simulateSingleHeadlessGame({
    gameIndex: 0,
    openingIndex: 1,
    candidateColor: 'w',
    candidateParams: run1.candidateParams,
    championParams: DEFAULT_EVAL_PARAMS,
    maxDepth: 2,
    timeLimitMs: 50,
    maxPlies: 24,
    seed: 555
  });
  assert.deepEqual(g1.moves, g2.moves);
  assert.ok(g1.pgn.length > 10);

  const rejectDecision = evaluatePromotionDecision({ wins: 3, draws: 4, losses: 5, regressionResult: reg });
  assert.equal(rejectDecision.promoted, false);

  const promoteDecision = evaluatePromotionDecision({ wins: 8, draws: 2, losses: 2, regressionResult: reg });
  assert.equal(promoteDecision.promoted, true);
});

test('18. Sharing, Safe URL Limits, Storage Validation, and Local ELO Rating', () => {
  const g = new ChessGame();
  g.move('e4');
  g.move('c5');
  g.move('Nf3');
  g.move('d6');

  const sharePayload = buildSafeSharePayload({
    pgn: g.pgn(),
    startFen: DEFAULT_FEN,
    fen: g.fen(),
    title: 'Sicilian Match',
    notes: 'Clean test'
  });
  assert.equal(sharePayload.fitsInUrl, true);
  assert.ok(sharePayload.url);

  const decoded = decodeGameFromUrlHash('#' + sharePayload.url.split('#')[1]);
  assert.ok(decoded);
  assert.equal(decoded.fen, g.fen());
  assert.equal(decoded.moves.length, 4);

  const decodedPos = decodeGameFromUrlHash('#' + sharePayload.positionUrl.split('#')[1]);
  assert.ok(decodedPos);
  assert.equal(decodedPos.fen, g.fen());

  const validated = validateGameRecord({
    id: 'gm-test-1',
    title: '<script>alert(1)</script>Match',
    fen: g.fen(),
    pgn: g.pgn(),
    moveCount: 4
  });
  assert.ok(validated);
  assert.equal(validated.title.includes('<script>'), false);

  const ratingAfterWin = updatePlayerRating({
    opponentId: 'ClubPlayer',
    opponentRating: 1400,
    outcome: 'win',
    usedHints: false,
    usedTakeback: false,
    plies: 20
  });
  assert.ok(ratingAfterWin.rating > 1200);
  assert.equal(ratingAfterWin.lastGameEligible, true);
});

test('19. Verified Puzzles, Endgame Lessons, and Clock Formatting', () => {
  for (const p of VERIFIED_PUZZLES) {
    assert.equal(validateFen(p.fen).valid, true);
    const g = new ChessGame(p.fen);
    for (const san of p.solutionSan) assert.ok(g.move(san));
  }
  for (const lesson of ENDGAME_LESSONS) {
    assert.equal(validateFen(lesson.fen).valid, true);
    const g = new ChessGame(lesson.fen);
    for (const san of lesson.solutionSan) assert.ok(g.move(san));
  }
  assert.equal(GameClock.formatMs(180000), '3:00');
  assert.equal(GameClock.formatMs(9500), '0:09.5');
  assert.equal(detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']).eco, 'C60');
  const exp = explainPosition(new ChessGame());
  assert.ok(exp.bullets.length > 0);
  const puzzles = extractBlunderPuzzlesFromTimeline([
    {
      moveVerbose: { san: 'Qh5', before: DEFAULT_FEN },
      classification: { id: 'blunder', label: 'Blunder', cpLoss: 250 },
      bestSan: 'Nf3'
    }
  ]);
  assert.equal(puzzles.length, 1);
});

test('20. Calibration Verification: Higher Difficulty Tier Outperforms Beginner Tier in Balanced Pair', () => {
  // Play 2 colour-swapped games between Competitor (depth 3 fast budget) and FirstSteps (depth 1)
  let competitorScore = 0;
  for (const compColor of ['w', 'b']) {
    const res = simulateSingleHeadlessGame({
      gameIndex: compColor === 'w' ? 0 : 1,
      openingIndex: 0,
      candidateColor: compColor,
      candidateParams: DEFAULT_EVAL_PARAMS,
      championParams: DEFAULT_EVAL_PARAMS,
      opponentPresetId: 'FirstSteps',
      maxDepth: 3,
      timeLimitMs: 35,
      maxPlies: 64,
      seed: 1024
    });
    if (res.candidateOutcome === 'win') competitorScore += 1;
    else if (res.candidateOutcome === 'draw') competitorScore += 0.5;
  }
  assert.ok(competitorScore >= 1.5, `Expected Competitor to score >= 1.5/2 vs FirstSteps, got ${competitorScore}/2`);
});
