/**
 * X-RAY: 11-Layer Tactical Awareness & Position Intelligence Engine
 * Separately controllable layers:
 * 1. attackedSquares      — Square control & attack counts (White/Black/Contested) [Current Fact]
 * 2. defendedPieces       — Friendly pieces with active defenders [Current Fact]
 * 3. hangingPieces        — Undefended or unfavorable-SEE pieces [Current Fact]
 * 4. pinsAndDiscovered    — Absolute/relative pins & discovered attack batteries [Current Fact]
 * 5. forksAndSkewers      — Active double attacks (forks) and skewers [Current Fact]
 * 6. overloadedDefenders  — Pieces simultaneously guarding 2+ attacked friendly pieces [Current Fact]
 * 7. kingThreats          — Check rays, candidate checks, and exposed king zone squares [Current Fact]
 * 8. candidateMoves       — Engine candidate moves [Candidate Line]
 * 9. pvArrows             — Principal variation continuation arrows [Candidate Line]
 * 10. predictedReplies    — Plausible opponent response from PV[1] [Prediction]
 * 11. preMoveWarnings     — Blunder / tactical refutation warning [Candidate Line / Uncertainty]
 */

import {
  ChessGame,
  FILES,
  RANKS,
  sq88ToAlgebraic,
  SEE_PIECE_VALUES,
  BISHOP_OFFSETS,
  ROOK_OFFSETS
} from '../game/ChessGame.js';

export const PIECE_LABELS = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King'
};

export const DEFAULT_XRAY_CONFIG = {
  enabled: true,
  attackedSquares: false,
  defendedPieces: false,
  hangingPieces: true,
  pinsAndDiscovered: true,
  forksAndSkewers: true,
  overloadedDefenders: true,
  kingThreats: true,
  candidateMoves: true,
  pvArrows: true,
  predictedReplies: true,
  preMoveWarnings: true,
  // Legacy aliases for compatibility
  attackMap: false,
  vulnerable: true,
  kingSafety: true,
  motifs: true,
  prediction: true
};

/**
 * Computes comprehensive tactical X-Ray data directly from the authoritative ChessGame state.
 */
export function computeXRayAnalysis(game, engineResult = null) {
  const attackMap = {};
  const defendedPieces = [];
  const hangingPieces = [];
  const overloadedDefenders = [];
  const vulnerablePieces = [];
  const pinsAndDiscovered = [];
  const forksAndSkewers = [];
  const motifs = [];

  const kingSafety = {
    whiteInCheck: game.isKingAttacked('w'),
    blackInCheck: game.isKingAttacked('b'),
    whiteKingSquare: game.kingSq.w !== -1 ? sq88ToAlgebraic(game.kingSq.w) : null,
    blackKingSquare: game.kingSq.b !== -1 ? sq88ToAlgebraic(game.kingSq.b) : null,
    checkAttackers: [],
    candidateChecks: [],
    exposedKingZones: []
  };

  const whiteProtectedTargets = new Map();
  const blackProtectedTargets = new Map();

  // 1. Layer 1: Full 64-square Attack Map
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const sqAlg = FILES[f] + RANKS[r];
      const wAtt = game.getAttackersOfSquare(sq88, 'w');
      const bAtt = game.getAttackersOfSquare(sq88, 'b');

      let control = 'neutral';
      if (wAtt.length > 0 && bAtt.length === 0) control = 'white';
      else if (bAtt.length > 0 && wAtt.length === 0) control = 'black';
      else if (wAtt.length > 0 && bAtt.length > 0) control = 'contested';

      attackMap[sqAlg] = {
        square: sqAlg,
        whiteAttackers: wAtt,
        blackAttackers: bAtt,
        whiteCount: wAtt.length,
        blackCount: bAtt.length,
        netControl: wAtt.length - bAtt.length,
        control,
        epistemicType: 'fact'
      };

      const occupant = game.board88[sq88];
      if (occupant && occupant.type !== 'k') {
        const friendlyAtt = occupant.color === 'w' ? wAtt : bAtt;
        const enemyAtt = occupant.color === 'w' ? bAtt : wAtt;
        if (friendlyAtt.length > 0) {
          defendedPieces.push({
            square: sqAlg,
            type: occupant.type,
            piece: occupant.type,
            color: occupant.color,
            defenders: friendlyAtt.length,
            attackers: enemyAtt.length,
            defenderSquares: friendlyAtt.map(d => d.square),
            epistemicType: 'fact',
            description: `${occupant.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[occupant.type]} on ${sqAlg} is defended by ${friendlyAtt.length} piece(s) (${friendlyAtt.map(d => d.square).join(', ')}).`
          });
        }

        if (occupant.color === 'w' && bAtt.length > 0) {
          for (const d of wAtt) {
            if (!whiteProtectedTargets.has(d.square)) whiteProtectedTargets.set(d.square, []);
            whiteProtectedTargets.get(d.square).push(sqAlg);
          }
        } else if (occupant.color === 'b' && wAtt.length > 0) {
          for (const d of bAtt) {
            if (!blackProtectedTargets.has(d.square)) blackProtectedTargets.set(d.square, []);
            blackProtectedTargets.get(d.square).push(sqAlg);
          }
        }
      }
    }
  }

  // 2. Layers 3 & 6: Hanging / Insufficiently Defended Pieces & Overloaded Defenders
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const sqAlg = FILES[f] + RANKS[r];
      const piece = game.board88[sq88];
      if (!piece || piece.type === 'k') continue;

      const info = attackMap[sqAlg];
      const enemyAttackers = piece.color === 'w' ? info.blackAttackers : info.whiteAttackers;
      const ourDefenders = piece.color === 'w' ? info.whiteAttackers : info.blackAttackers;
      const pieceVal = SEE_PIECE_VALUES[piece.type] || 100;

      if (enemyAttackers.length > 0) {
        const minEnemyVal = enemyAttackers[0].value;
        if (ourDefenders.length === 0) {
          const desc = `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} on ${sqAlg} is attacked by ${enemyAttackers[0].square} and completely undefended.`;
          const item = {
            square: sqAlg,
            piece: piece.type,
            type: piece.type,
            color: piece.color,
            status: 'hanging',
            severity: 'high',
            attackers: enemyAttackers.length,
            defenders: 0,
            netPressure: enemyAttackers.length,
            attackerSquare: enemyAttackers[0].square,
            epistemicType: 'fact',
            reason: desc,
            description: desc
          };
          hangingPieces.push(item);
          vulnerablePieces.push(item);
        } else if (minEnemyVal < pieceVal) {
          const desc = `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} (${pieceVal} cp) on ${sqAlg} is attacked by a lower-value ${PIECE_LABELS[enemyAttackers[0].type]} (${minEnemyVal} cp) from ${enemyAttackers[0].square}.`;
          const item = {
            square: sqAlg,
            piece: piece.type,
            type: piece.type,
            color: piece.color,
            status: 'unfavorable_exchange',
            severity: 'high',
            attackers: enemyAttackers.length,
            defenders: ourDefenders.length,
            netPressure: enemyAttackers.length - ourDefenders.length,
            attackerSquare: enemyAttackers[0].square,
            epistemicType: 'fact',
            reason: desc,
            description: desc
          };
          hangingPieces.push(item);
          vulnerablePieces.push(item);
        } else if (enemyAttackers.length > ourDefenders.length) {
          const desc = `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} on ${sqAlg} has ${enemyAttackers.length} attackers vs ${ourDefenders.length} defenders.`;
          const item = {
            square: sqAlg,
            piece: piece.type,
            type: piece.type,
            color: piece.color,
            status: 'outnumbered_defense',
            severity: 'medium',
            attackers: enemyAttackers.length,
            defenders: ourDefenders.length,
            netPressure: enemyAttackers.length - ourDefenders.length,
            attackerSquare: enemyAttackers[0].square,
            epistemicType: 'fact',
            reason: desc,
            description: desc
          };
          hangingPieces.push(item);
          vulnerablePieces.push(item);
        }
      }

      const guardedMap = piece.color === 'w' ? whiteProtectedTargets : blackProtectedTargets;
      const guardedList = guardedMap.get(sqAlg) || [];
      if (guardedList.length >= 2) {
        const desc = `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} on ${sqAlg} is overloaded defending both ${guardedList.slice(0, 2).join(' and ')}.`;
        const overloadedItem = {
          square: sqAlg,
          piece: piece.type,
          type: piece.type,
          color: piece.color,
          status: 'overloaded',
          severity: 'medium',
          attackers: enemyAttackers.length,
          defenders: ourDefenders.length,
          netPressure: guardedList.length,
          guardedSquares: guardedList,
          epistemicType: 'fact',
          reason: desc,
          description: desc
        };
        overloadedDefenders.push(overloadedItem);
        vulnerablePieces.push(overloadedItem);
      }
    }
  }

  // 3. Layer 7: King Safety, Check Threats & Mating Threats
  for (const side of ['w', 'b']) {
    const kSq = game.kingSq[side];
    if (kSq === -1) continue;
    const enemy = side === 'w' ? 'b' : 'w';
    const kAlg = sq88ToAlgebraic(kSq);
    const directAtt = game.getAttackersOfSquare(kSq, enemy);
    for (const att of directAtt) {
      kingSafety.checkAttackers.push({
        from: att.square,
        to: kAlg,
        color: enemy,
        piece: att.type,
        description: `${enemy === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[att.type]} on ${att.square} checks the ${side === 'w' ? 'White' : 'Black'} King on ${kAlg}.`
      });
    }
  }

  const allLegalVerbose = game.moves({ verbose: true });
  for (const mv of allLegalVerbose) {
    if (mv.san.includes('+') || mv.san.includes('#')) {
      const isMate = mv.san.includes('#');
      const desc = `${mv.color === 'w' ? 'White' : 'Black'} can play ${mv.san} (${PIECE_LABELS[mv.piece]} ${mv.from}→${mv.to})${isMate ? ' — immediate checkmate!' : ' — checking the enemy King.'}`;
      kingSafety.candidateChecks.push({
        from: mv.from,
        to: mv.to,
        square: mv.to,
        san: mv.san,
        piece: mv.piece,
        color: mv.color,
        isMate,
        epistemicType: 'fact',
        description: desc
      });
    }
  }

  for (const side of ['w', 'b']) {
    const kSq = game.kingSq[side];
    if (kSq === -1) continue;
    const kr = kSq >> 4;
    const kf = kSq & 7;
    const enemy = side === 'w' ? 'b' : 'w';
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        const nr = kr + dr;
        const nf = kf + df;
        if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const sqAlg = FILES[nf] + RANKS[nr];
        const att = enemy === 'w' ? attackMap[sqAlg].whiteAttackers : attackMap[sqAlg].blackAttackers;
        if (att.length > 0) {
          kingSafety.exposedKingZones.push({
            square: sqAlg,
            defendingKingSide: side,
            attackersCount: att.length,
            attackerSquare: att[0].square
          });
        }
      }
    }
  }

  // 4. Layers 4 & 5: Pins, Discovered Attacks, Skewers, and Active Forks
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const p = game.board88[sq88];
      if (!p || (p.type !== 'b' && p.type !== 'r' && p.type !== 'q')) continue;

      const dirs =
        p.type === 'b'
          ? BISHOP_OFFSETS
          : p.type === 'r'
          ? ROOK_OFFSETS
          : [...BISHOP_OFFSETS, ...ROOK_OFFSETS];

      const enemy = p.color === 'w' ? 'b' : 'w';
      const pSqAlg = sq88ToAlgebraic(sq88);

      for (const step of dirs) {
        let cur = sq88 + step;
        let firstHit = null;
        let secondHit = null;
        while (!(cur & 0x88)) {
          const occ = game.board88[cur];
          if (occ) {
            if (!firstHit) {
              firstHit = { sq88: cur, sqAlg: sq88ToAlgebraic(cur), ...occ };
            } else {
              secondHit = { sq88: cur, sqAlg: sq88ToAlgebraic(cur), ...occ };
              break;
            }
          }
          cur += step;
        }

        if (firstHit && secondHit) {
          if (firstHit.color === enemy && secondHit.color === enemy) {
            const v1 = SEE_PIECE_VALUES[firstHit.type] || 100;
            const v2 = SEE_PIECE_VALUES[secondHit.type] || 100;
            if (secondHit.type === 'k' || v2 > v1) {
              const pinKind = secondHit.type === 'k' ? 'Absolute Pin' : 'Relative Pin';
              const item = {
                type: 'Pin',
                subType: pinKind,
                confidence: 'Confirmed',
                epistemicType: 'fact',
                color: p.color,
                square: firstHit.sqAlg,
                attackerSquare: pSqAlg,
                targetSquares: [firstHit.sqAlg, secondHit.sqAlg],
                description: `${pinKind}: ${p.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[p.type]} on ${pSqAlg} pins ${PIECE_LABELS[firstHit.type]} on ${firstHit.sqAlg} to ${PIECE_LABELS[secondHit.type]} on ${secondHit.sqAlg}.`
              };
              pinsAndDiscovered.push(item);
              motifs.push(item);
            } else if (v1 > v2 && (firstHit.type === 'k' || firstHit.type === 'q' || firstHit.type === 'r')) {
              const item = {
                type: 'Skewer',
                confidence: 'Confirmed',
                epistemicType: 'fact',
                color: p.color,
                square: firstHit.sqAlg,
                attackerSquare: pSqAlg,
                targetSquares: [firstHit.sqAlg, secondHit.sqAlg],
                description: `Skewer: ${p.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[p.type]} on ${pSqAlg} skewers ${PIECE_LABELS[firstHit.type]} on ${firstHit.sqAlg} in front of ${PIECE_LABELS[secondHit.type]} on ${secondHit.sqAlg}.`
              };
              forksAndSkewers.push(item);
              motifs.push(item);
            }
          } else if (firstHit.color === p.color && secondHit.color === enemy && (secondHit.type === 'k' || secondHit.type === 'q')) {
            const item = {
              type: 'Discovered',
              confidence: 'Possible',
              epistemicType: 'fact',
              color: p.color,
              square: firstHit.sqAlg,
              attackerSquare: pSqAlg,
              targetSquares: [firstHit.sqAlg, secondHit.sqAlg],
              description: `Discovered Attack Battery: Moving ${PIECE_LABELS[firstHit.type]} from ${firstHit.sqAlg} unmasks ${PIECE_LABELS[p.type]} on ${pSqAlg} toward ${PIECE_LABELS[secondHit.type]} on ${secondHit.sqAlg}.`
            };
            pinsAndDiscovered.push(item);
            motifs.push(item);
          }
        }
      }
    }
  }

  // Active Forks
  const attackerToEnemyTargets = new Map();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const targetPiece = game.board88[sq88];
      if (!targetPiece) continue;
      const targetSqAlg = FILES[f] + RANKS[r];
      const info = attackMap[targetSqAlg];
      const enemyAttackers = targetPiece.color === 'w' ? info.blackAttackers : info.whiteAttackers;
      const ourDefenders = targetPiece.color === 'w' ? info.whiteAttackers : info.blackAttackers;
      const targetVal = SEE_PIECE_VALUES[targetPiece.type] || 100;

      for (const att of enemyAttackers) {
        const attVal = att.value;
        if (targetPiece.type === 'k' || targetVal > attVal || ourDefenders.length === 0) {
          if (!attackerToEnemyTargets.has(att.square)) {
            attackerToEnemyTargets.set(att.square, {
              square: att.square,
              type: att.type,
              color: att.color,
              targets: []
            });
          }
          attackerToEnemyTargets.get(att.square).targets.push({
            square: targetSqAlg,
            type: targetPiece.type
          });
        }
      }
    }
  }

  for (const [, forkInfo] of attackerToEnemyTargets.entries()) {
    if (forkInfo.targets.length >= 2) {
      const tNames = forkInfo.targets.map(t => `${PIECE_LABELS[t.type]} on ${t.square}`).join(' & ');
      const item = {
        type: 'Fork',
        confidence: 'Confirmed',
        epistemicType: 'fact',
        color: forkInfo.color,
        square: forkInfo.square,
        attackerSquare: forkInfo.square,
        targetSquares: forkInfo.targets.map(t => t.square),
        description: `Active Fork: ${forkInfo.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[forkInfo.type]} on ${forkInfo.square} simultaneously attacks ${tNames}.`
      };
      forksAndSkewers.push(item);
      motifs.push(item);
    }
  }

  // Layers 8, 9, 10: Candidate Moves, PV Arrows, Predicted Opponent Replies
  const candidateArrows = [];
  const pvArrows = [];
  const predictedReplyArrows = [];

  if (engineResult) {
    const candidates = engineResult.candidates || [];
    for (let i = 0; i < Math.min(candidates.length, 3); i++) {
      const c = candidates[i];
      if (c && c.from && c.to) {
        candidateArrows.push({
          rank: i + 1,
          from: c.from,
          to: c.to,
          san: c.san,
          scoreWhiteCp: c.scoreWhiteCp,
          epistemicType: engineResult.depth >= 3 ? 'candidate_line' : 'uncertainty'
        });
      }
    }

    const pvLan = engineResult.pvLan || [];
    const pvSan = engineResult.pv || [];
    if (pvLan.length >= 1 && pvLan[0].length >= 4) {
      pvArrows.push({
        step: 1,
        from: pvLan[0].slice(0, 2),
        to: pvLan[0].slice(2, 4),
        san: pvSan[0] || '',
        epistemicType: engineResult.depth >= 3 ? 'candidate_line' : 'uncertainty'
      });
    }
    if (pvLan.length >= 2 && pvLan[1].length >= 4) {
      predictedReplyArrows.push({
        step: 2,
        from: pvLan[1].slice(0, 2),
        to: pvLan[1].slice(2, 4),
        san: pvSan[1] || '',
        epistemicType: 'prediction'
      });
    }
  }

  return {
    attackMap,
    defendedPieces,
    hangingPieces,
    overloadedDefenders,
    vulnerablePieces,
    pinsAndDiscovered,
    forksAndSkewers,
    motifs,
    kingSafety,
    candidateArrows,
    pvArrows,
    predictedReplyArrows,
    analysisDepth: engineResult?.depth ?? 0,
    isShallowUncertainty: !engineResult || (engineResult.depth ?? 0) < 3
  };
}

/**
 * Layer 11 (Layer F): Pre-Move / Last-Move Tactical Blunder & Refutation Analyser
 * Evaluates a candidate human move to warn if it allows immediate mate, loses
 * significant material, or walks into a forcing check/capture.
 */
export function evaluateBeforeMoveWarning(game, candidateMoveObj, engineInstance) {
  const testGame = new ChessGame(game.fen());
  const legalBefore = testGame.moves({ verbose: true });
  if (legalBefore.length <= 1) return null;

  const baselineRes = engineInstance.search(testGame.fen(), {
    difficulty: 'ClubPlayer',
    maxDepth: 3,
    timeLimitMs: 140,
    nodeLimit: 3500
  });

  const moverColor = testGame.turn();
  const moved = testGame.move(candidateMoveObj);
  if (!moved) return null;

  const replyRes = engineInstance.search(testGame.fen(), {
    difficulty: 'ClubPlayer',
    maxDepth: 3,
    timeLimitMs: 140,
    nodeLimit: 3500
  });

  const bestScoreForMover = baselineRes.scoreSideToMoveCp;
  const scoreAfterPlayedForMover = -replyRes.scoreSideToMoveCp;
  const cpDrop = bestScoreForMover - scoreAfterPlayedForMover;

  if (replyRes.mateIn && replyRes.mateIn.movesForSideToMove > 0) {
    return {
      severity: 'critical',
      epistemicType: 'candidate_line',
      searchDepth: replyRes.depth,
      title: 'Critical Tactical Warning — Allows Forced Checkmate',
      message: `Playing ${moved.san} allows ${moverColor === 'w' ? 'Black' : 'White'} to force checkmate in ${replyRes.mateIn.movesForSideToMove} move(s) starting with ${replyRes.bestMoveSan}.`,
      refutationLine: replyRes.pv || [replyRes.bestMoveSan],
      recommendedMove: baselineRes.bestMoveSan,
      from: moved.from,
      to: moved.to,
      cpDrop
    };
  }

  if (cpDrop >= 145 && moved.san !== baselineRes.bestMoveSan) {
    const reasonText =
      replyRes.bestMoveSan && replyRes.bestMoveSan.includes('x')
        ? `allows a material-winning capture (${replyRes.bestMoveSan})`
        : replyRes.bestMoveSan && replyRes.bestMoveSan.includes('+')
        ? `exposes your King to a forcing check (${replyRes.bestMoveSan})`
        : `concedes ${(cpDrop / 100).toFixed(2)} pawns of tactical advantage after ${replyRes.bestMoveSan}`;

    return {
      severity: cpDrop >= 240 ? 'high' : 'medium',
      epistemicType: replyRes.depth >= 3 ? 'candidate_line' : 'uncertainty',
      searchDepth: replyRes.depth,
      title: cpDrop >= 240 ? 'Blunder Warning' : 'Tactical Inaccuracy Warning',
      message: `Playing ${moved.san} ${reasonText}. Cathedral Engine recommends ${baselineRes.bestMoveSan} instead.`,
      refutationLine: replyRes.pv || [replyRes.bestMoveSan],
      recommendedMove: baselineRes.bestMoveSan,
      from: moved.from,
      to: moved.to,
      cpDrop
    };
  }

  return null;
}
