/**
 * Move Review, Heuristic Classification, Progressive 5-Tier Hints, Post-Game Summary,
 * Opening Reference, and Verified Tactical Puzzles
 * Grounded in actual Cathedral Engine centipawn evaluations and search depth.
 */

import { explainPosition } from '../engine/evaluation.js';
import { computeXRayAnalysis, PIECE_LABELS } from '../xray/xrayEngine.js';

export const MOVE_CLASSIFICATIONS = {
  BEST: {
    id: 'best',
    label: 'Best Find',
    badge: '★',
    color: '#2563eb',
    description: 'Matches the Cathedral Engine’s top choice at the searched depth.'
  },
  EXCELLENT: {
    id: 'excellent',
    label: 'Excellent',
    badge: '!',
    color: '#059669',
    description: 'Within 18 centipawns of the engine’s top recommendation.'
  },
  GOOD: {
    id: 'good',
    label: 'Good',
    badge: '✓',
    color: '#16a34a',
    description: 'Solid continuation losing less than 45 centipawns.'
  },
  INACCURACY: {
    id: 'inaccuracy',
    label: 'Inaccuracy',
    badge: '?!',
    color: '#d97706',
    description: 'Suboptimal move losing between 45 and 100 centipawns.'
  },
  MISTAKE: {
    id: 'mistake',
    label: 'Mistake',
    badge: '?',
    color: '#ea580c',
    description: 'Significant concession losing between 100 and 220 centipawns.'
  },
  BLUNDER: {
    id: 'blunder',
    label: 'Blunder',
    badge: '??',
    color: '#dc2626',
    description: 'Severe tactical or material oversight losing over 220 centipawns or allowing forced mate.'
  },
  UNCERTAIN: {
    id: 'uncertain',
    label: 'Unverified / Shallow',
    badge: '…',
    color: '#64748b',
    description: 'Search depth < 2; deeper analysis required for a confident classification.'
  }
};

/**
 * Classify a played move given the engine's evaluation before the move (best possible)
 * and the evaluation after the played move (from the mover's perspective).
 */
export function classifyPlayedMove({
  playedSan,
  bestSan,
  bestScoreForMoverCp,
  playedScoreForMoverCp,
  searchDepth
}) {
  if (!searchDepth || searchDepth < 2) {
    return {
      ...MOVE_CLASSIFICATIONS.UNCERTAIN,
      cpLoss: 0,
      uncertain: true
    };
  }

  const cpLoss = Math.max(0, bestScoreForMoverCp - playedScoreForMoverCp);

  if (playedSan === bestSan || cpLoss <= 3) {
    return { ...MOVE_CLASSIFICATIONS.BEST, cpLoss, uncertain: false };
  }
  if (cpLoss <= 18) {
    return { ...MOVE_CLASSIFICATIONS.EXCELLENT, cpLoss, uncertain: false };
  }
  if (cpLoss <= 45) {
    return { ...MOVE_CLASSIFICATIONS.GOOD, cpLoss, uncertain: false };
  }
  if (cpLoss <= 100) {
    return { ...MOVE_CLASSIFICATIONS.INACCURACY, cpLoss, uncertain: false };
  }
  if (cpLoss <= 220) {
    return { ...MOVE_CLASSIFICATIONS.MISTAKE, cpLoss, uncertain: false };
  }
  return { ...MOVE_CLASSIFICATIONS.BLUNDER, cpLoss, uncertain: false };
}

/**
 * Generates the 5-Tier Progressive Hint system from actual position state, X-Ray, and engine search.
 * Every suggested move is verified against `game.moves({ verbose: true })`.
 */
export function computeProgressiveHints(game, engineResult = null, existingXray = null) {
  const allLegal = game.moves({ verbose: true });
  if (allLegal.length === 0) {
    return {
      available: false,
      tiers: []
    };
  }

  const xray = existingXray || computeXRayAnalysis(game, engineResult);
  const posExp = explainPosition(game);
  const turnColor = game.turn();
  const sideName = turnColor === 'w' ? 'White' : 'Black';

  let bestVerbose = null;
  if (engineResult && engineResult.bestMoveSan) {
    bestVerbose = allLegal.find(m => m.san === engineResult.bestMoveSan) || null;
  }
  if (!bestVerbose && engineResult && engineResult.bestMove) {
    bestVerbose =
      allLegal.find(
        m =>
          m.from === engineResult.bestMove.from &&
          m.to === engineResult.bestMove.to &&
          (m.promotion || undefined) === (engineResult.bestMove.promotion || undefined)
      ) || null;
  }
  if (!bestVerbose) {
    // Choose a strong tactical or centralizing move deterministically from legal moves
    bestVerbose =
      allLegal.find(m => m.san.includes('#')) ||
      allLegal.find(m => m.promotion === 'q') ||
      allLegal.find(m => m.captured) ||
      allLegal.find(m => m.san === 'O-O' || m.san === 'O-O-O') ||
      allLegal[0];
  }

  // Tier 1: Strategic Hint
  let strategicText = posExp.bullets[0] || `${sideName} should focus on improving piece coordination and king safety.`;
  if (game.in_check()) {
    strategicText = `${sideName}'s King is in check! Your primary goal is to resolve the check safely by moving the King, blocking the ray, or capturing the checking piece.`;
  } else if (bestVerbose.san === 'O-O' || bestVerbose.san === 'O-O-O') {
    strategicText = `Focus on King safety and rook activation—castling tucking your King away while connecting your rooks is a top strategic priority.`;
  } else if (posExp.phase === 'Opening') {
    strategicText = `Opening strategy: contest the central squares (d4, e4, d5, e5), develop knights and bishops toward active squares, and prepare to castle.`;
  } else if (posExp.phase === 'Endgame') {
    strategicText = `Endgame strategy: centralize your King, push passed pawns, and place rooks behind passed pawns or on open files.`;
  }

  // Tier 2: Tactical Hint
  let tacticalText = 'No immediate hanging pieces—look for ways to increase pressure on enemy targets.';
  const ourHanging = xray.hangingPieces.filter(h => h.color === turnColor);
  const enemyHanging = xray.hangingPieces.filter(h => h.color !== turnColor);
  const ourMotifs = xray.motifs.filter(m => m.color === turnColor);

  if (game.in_check()) {
    tacticalText = `Immediate tactical necessity: Neutralize the check against your King (${allLegal.length} legal evasion(s) available).`;
  } else if (bestVerbose.san.includes('#')) {
    tacticalText = `Direct mating pattern on the board! Look for a move that delivers immediate checkmate.`;
  } else if (engineResult?.mateIn && engineResult.mateIn.movesForSideToMove > 0) {
    tacticalText = `Forced checkmate sequence available in ${engineResult.mateIn.movesForSideToMove} move(s)! Look for forcing checks.`;
  } else if (ourHanging.length > 0 && bestVerbose.from === ourHanging[0].square) {
    tacticalText = `Defensive alert: Your ${PIECE_LABELS[ourHanging[0].piece]} on ${ourHanging[0].square} is under attack (${ourHanging[0].description}).`;
  } else if (bestVerbose.captured) {
    tacticalText = `Tactical capture opportunity: An enemy ${PIECE_LABELS[bestVerbose.captured]} on ${bestVerbose.to} can be targeted favorably.`;
  } else if (ourMotifs.length > 0) {
    tacticalText = `Active motif on the board: ${ourMotifs[0].description}`;
  } else if (enemyHanging.length > 0) {
    tacticalText = `Target spotted: Enemy ${PIECE_LABELS[enemyHanging[0].piece]} on ${enemyHanging[0].square} is vulnerable.`;
  }

  // Tier 3: Square Hint
  const squareText = `Focus on your ${PIECE_LABELS[bestVerbose.piece]} currently stationed on ${bestVerbose.from}. Consider its most active destination square.`;

  // Tier 4: Move Hint
  const moveText = `Candidate Move: Play ${bestVerbose.san} (${PIECE_LABELS[bestVerbose.piece]} from ${bestVerbose.from} to ${bestVerbose.to}${bestVerbose.promotion ? `, promoting to ${PIECE_LABELS[bestVerbose.promotion]}` : ''}).`;

  // Tier 5: Explanation & Principal Variation
  const pvLine = engineResult?.pv && engineResult.pv.length > 0 ? engineResult.pv.join(' → ') : bestVerbose.san;
  const depthNote = engineResult?.depth ? `verified at depth ${engineResult.depth}` : 'static tactical evaluation';
  const evalNote =
    engineResult?.scoreWhiteCp !== undefined
      ? `(${engineResult.scoreWhiteCp >= 0 ? '+' : ''}${(engineResult.scoreWhiteCp / 100).toFixed(2)} for White)`
      : '';
  let reasonDetail = `improves ${sideName}'s piece activity and coordination`;
  if (bestVerbose.san.includes('#')) reasonDetail = 'delivers immediate checkmate';
  else if (bestVerbose.promotion) reasonDetail = `promotes the pawn to a ${PIECE_LABELS[bestVerbose.promotion]}`;
  else if (bestVerbose.captured) reasonDetail = `captures the ${PIECE_LABELS[bestVerbose.captured]} on ${bestVerbose.to}`;
  else if (bestVerbose.san.includes('+')) reasonDetail = 'delivers a forcing check to seize the initiative';
  else if (bestVerbose.san === 'O-O' || bestVerbose.san === 'O-O-O') reasonDetail = 'castles the King to safety and activates the Rook';

  const explanationText = `${bestVerbose.san} ${reasonDetail} ${evalNote} (${depthNote}). Principal continuation: ${pvLine}.`;

  return {
    available: true,
    recommendedMove: bestVerbose,
    originSquare: bestVerbose.from,
    targetSquare: bestVerbose.to,
    pv: engineResult?.pv || [bestVerbose.san],
    depth: engineResult?.depth || 1,
    tiers: [
      { level: 1, title: '1. Strategic Goal', badge: 'Strategy', text: strategicText },
      { level: 2, title: '2. Tactical Alert', badge: 'Tactics', text: tacticalText },
      { level: 3, title: '3. Origin Square', badge: `Square ${bestVerbose.from}`, text: squareText },
      { level: 4, title: '4. Candidate Move', badge: bestVerbose.san, text: moveText },
      { level: 5, title: '5. Principal Continuation', badge: `Depth ${engineResult?.depth || 1}`, text: explanationText }
    ]
  };
}

/**
 * Computes a complete Post-Game Review Summary from move history and move metadata.
 */
export function computeGameReviewSummary(sanHistory, moveMeta = []) {
  const summary = {
    w: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, uncertain: 0, totalAnalysed: 0, totalCpLoss: 0, acpl: 0, accuracy: null },
    b: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, uncertain: 0, totalAnalysed: 0, totalCpLoss: 0, acpl: 0, accuracy: null },
    evalSeries: [{ ply: 0, san: 'Start', whiteCp: 15, classification: null }],
    criticalMoments: []
  };

  for (let i = 0; i < sanHistory.length; i++) {
    const side = i % 2 === 0 ? 'w' : 'b';
    const meta = moveMeta[i] || null;
    const cl = meta?.classification || null;
    const whiteCp = typeof meta?.scoreWhiteCp === 'number' ? meta.scoreWhiteCp : null;

    summary.evalSeries.push({
      ply: i + 1,
      san: sanHistory[i],
      side,
      whiteCp,
      classification: cl
    });

    if (!cl || cl.uncertain || cl.id === 'uncertain') {
      summary[side].uncertain++;
    } else {
      summary[side][cl.id] = (summary[side][cl.id] || 0) + 1;
      summary[side].totalAnalysed++;
      summary[side].totalCpLoss += cl.cpLoss || 0;
      if (cl.id === 'blunder' || cl.id === 'mistake') {
        summary.criticalMoments.push({
          ply: i + 1,
          moveNumber: Math.floor(i / 2) + 1,
          side,
          san: sanHistory[i],
          label: cl.label,
          cpLoss: cl.cpLoss,
          bestSan: meta?.bestSan || null
        });
      }
    }
  }

  for (const side of ['w', 'b']) {
    const s = summary[side];
    if (s.totalAnalysed > 0) {
      s.acpl = Math.round(s.totalCpLoss / s.totalAnalysed);
      s.accuracy = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-0.004 * s.acpl))));
    }
  }

  return summary;
}

/**
 * Compact, verified Opening Book reference.
 */
export const OPENING_BOOK = [
  { eco: 'C50', name: 'Italian Game: Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { eco: 'C55', name: 'Italian Game: Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C60', name: 'Ruy Lopez (Spanish Opening)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C65', name: 'Ruy Lopez: Berlin Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'C44', name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C42', name: "Petrov's Defense", moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { eco: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  { eco: 'B50', name: 'Sicilian Defense: Open', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'] },
  { eco: 'C00', name: 'French Defense', moves: ['e4', 'e6'] },
  { eco: 'B10', name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
  { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
  { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D10', name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D02', name: 'London System', moves: ['d4', 'd5', 'Bf4'] },
  { eco: 'E60', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'A10', name: 'English Opening', moves: ['c4'] },
  { eco: 'A04', name: 'Zukertort / Réti Opening', moves: ['Nf3'] }
];

export function detectOpening(sanHistory) {
  if (!sanHistory || sanHistory.length === 0) return null;
  let bestMatch = null;
  for (const entry of OPENING_BOOK) {
    if (sanHistory.length >= entry.moves.length) {
      let match = true;
      for (let i = 0; i < entry.moves.length; i++) {
        if (sanHistory[i] !== entry.moves[i]) {
          match = false;
          break;
        }
      }
      if (match && (!bestMatch || entry.moves.length > bestMatch.moves.length)) {
        bestMatch = entry;
      }
    }
  }
  return bestMatch;
}

export const VERIFIED_PUZZLES = [
  {
    id: 'cathedral-01',
    title: 'Sanctuary Back-Rank Strike',
    theme: 'Back-Rank Checkmate (Mate in 1)',
    difficulty: 'Learner',
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    solutionSan: ['Re8#'],
    explanation: 'Black’s king is trapped behind its own pawns on f7, g7, and h7. Re8# delivers immediate checkmate along the open e-file.'
  },
  {
    id: 'cathedral-02',
    title: 'Scholar’s Rose Window',
    theme: 'f7 Battery Mate (Mate in 1)',
    difficulty: 'Learner',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    solutionSan: ['Qxf7#'],
    explanation: 'The White Queen and Bishop converge on f7, which is defended only by the Black King. Qxf7# ends the game immediately.'
  },
  {
    id: 'cathedral-03',
    title: 'Obsidian Smothered Vault',
    theme: 'Smothered Mate (Mate in 1)',
    difficulty: 'ClubPlayer',
    fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1',
    solutionSan: ['Nf7#'],
    explanation: 'Black’s King on h8 is completely hemmed in by its own Rook on g8 and pawns on g7 and h7. Nf7# delivers a classic smothered checkmate.'
  },
  {
    id: 'cathedral-04',
    title: 'The Archbishop’s Tempo',
    theme: 'Developing with Tempo on Queen',
    difficulty: 'ClubPlayer',
    fen: 'rnb1kbnr/ppp2ppp/8/3qp3/8/5N2/PPPPBPPP/RNBQK2R w KQkq - 0 4',
    solutionSan: ['Nc3'],
    explanation: 'Developing the Knight to c3 attacks the centralized Black Queen on d5 with tempo while preparing rapid castling.'
  },
  {
    id: 'cathedral-05',
    title: 'Twin Spires Mate in Two',
    theme: 'Rook Clearance into Back-Rank Mate (Mate in 2)',
    difficulty: 'Competitor',
    fen: 'r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1',
    solutionSan: ['Re8+', 'Rxe8', 'Rxe8#'],
    explanation: '1. Re8+ forces Black’s sole back-rank defender to capture (1...Rxe8), allowing 2. Rxe8# checkmate.'
  },
  {
    id: 'cathedral-06',
    title: 'Cathedral Queen Sacrifice',
    theme: 'Queen Sacrifice & Back-Rank Mate (Mate in 2)',
    difficulty: 'Expert',
    fen: 'r5k1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1',
    solutionSan: ['Qe8+', 'Rxe8', 'Rxe8#'],
    explanation: '1. Qe8+! sacrifices the Queen on the e-file battery, forcing 1...Rxe8 and allowing 2. Rxe8# checkmate.'
  }
];

export const ENDGAME_LESSONS = [
  {
    id: 'endgame-opposition',
    title: 'Endgame Lesson 1: Direct King Opposition',
    theme: 'King & Pawn Endgame Fundamental',
    difficulty: 'ClubPlayer',
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    solutionSan: ['Kd6'],
    explanation: 'White steps to d6 (or f6), outflanking the Black King and securing the e7/e8 promotion path.'
  },
  {
    id: 'endgame-lucena',
    title: 'Endgame Lesson 2: Building the Lucena Bridge',
    theme: 'Rook & Pawn vs Rook Winning Technique',
    difficulty: 'Competitor',
    fen: '1K6/1P2k3/8/8/8/8/r7/3R4 w - - 0 1',
    solutionSan: ['Rd4'],
    explanation: '1. Rd4! drives the Black King away or prepares the 4th-rank bridge to shield the White King from checks when emerging from b8.'
  },
  {
    id: 'endgame-queen-vs-pawn',
    title: 'Endgame Lesson 3: Queen vs 7th-Rank Pawn',
    theme: 'Forcing King In Front of Pawn',
    difficulty: 'Expert',
    fen: '8/8/8/3Q4/8/8/3p4/3K1k2 w - - 0 1',
    solutionSan: ['Qf3+'],
    explanation: '1. Qf3+ forces the Black King to e1 or g1, allowing White to centralize and win the d2 pawn.'
  }
];

export function extractBlunderPuzzlesFromTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];
  const generated = [];
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    const mv = item.moveVerbose;
    const cl = item.classification;
    if (mv && cl && (cl.id === 'blunder' || cl.id === 'mistake' || cl.id === 'inaccuracy')) {
      generated.push({
        id: `game-blunder-${i + 1}`,
        title: `Ply #${i + 1}: Improve on ${mv.san} (${cl.label})`,
        theme: `Game Blunder Review (${cl.cpLoss || 90} cp loss)`,
        difficulty: 'Custom',
        fen: mv.before,
        playedBadMove: mv.san,
        solutionSan: item.bestSan ? [item.bestSan] : [],
        explanation: `In the game, ${mv.san} was played (${cl.label}). Find a stronger continuation from this position.`
      });
    }
  }
  return generated;
}
