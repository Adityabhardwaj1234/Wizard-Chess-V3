# Wizard's Chess: Production Edition

> *Precision 2D Chess Platform · 12-Tier Calibrated Cathedral Engine · 11-Layer X-Ray Intelligence · Headless Self-Play Training Lab*

A lightweight, zero-backend production chess platform built with Next.js (App Router + Turbopack), React 18, TypeScript, and an authoritative zero-dependency ES module chess engine. Every feature—move generation, 12-tier search, progressive hints, 11-layer X-Ray tactical overlays, move-by-move game review, headless parameter evolution, IndexedDB persistence, and URL-hash sharing—executes locally in the browser.

---

## Quick Start

```bash
npm install
npm run dev      # Turbopack development server on http://localhost:3000
npm test         # 20 automated rules, perft, promotion, 12-tier engine, X-Ray, and learning tests
npm run build    # Production build
npm start        # Serve production build
```

---

## Key Production Features

### 1. Pure 2D Board, Original SVG Piece Artwork & Four Themes
- **Obsolete 3D Renderer Removed**: Three.js and WebGL dependencies have been completely removed in favour of a responsive 8×8 HTML/CSS/SVG board (`CathedralBoard.tsx`) and original 2D vector chess piece artwork (`PieceSvg.tsx`).
- **Four Coherent Board Themes**:
  - **Classic Green** (Default): Tournament green (`#769656`) and warm cream (`#eeeed2`).
  - **Tournament Slate**: Championship blue-grey (`#5b738b`) and crisp off-white (`#dee3e6`).
  - **Woodland**: Walnut (`#b58863`) and maple (`#f0d9b5`).
  - **High Contrast**: Accessible high-contrast slate (`#334155`) and white (`#f8fafc`).
- **Accessibility & Input**: Mouse click-to-move, pointer/touch drag-to-move (`touch-action: none` preventing accidental mobile scroll), full keyboard arrow-key + Enter/Space/Escape navigation, color-blind shape/symbol indicators, Light/Dark interface modes, and reduced-motion support.
- **Separate Sorted Capture Trays**: Live White and Black capture trays sorted by piece value (`Q > R > B > N > P`) with net material advantage badges (`+3`), updated across captures, undo, redo, and historical replay.

### 2. Authoritative Rules & Atomic Pawn Promotion
- **Single Rules Authority (`src/game/ChessGame.js`)**: Complete orthodox FIDE legality including check evasions, pinned pieces, kingside/queenside castling, en passant, promotion/underpromotion, threefold repetition (64-bit Zobrist hash stack), fifty-move rule, insufficient material, undo/redo, Perft, and FEN/PGN round-tripping.
- **Pawn Promotion Freeze Fixed**: Entering a promotion square (`rank 8` for White, `rank 1` for Black) via click, drag, or keyboard enters an atomic `pendingPromotion` lock before mutating the board—preventing premature turn advancement or intervening engine moves until Queen, Rook, Bishop, or Knight is chosen (or cancelled via `Escape`).

### 3. 12-Tier Calibrated Difficulty Ladder & Local ELO Rating
- **12 Distinct Tiers (`src/engine/CathedralEngine.js`)**:
  1. `FirstSteps` (~650 Est. Local) — Depth 1, no quiescence, 130cp evaluation noise
  2. `Beginner` (~850 Est. Local) — Depth 1, 65cp evaluation noise
  3. `Learner` (~1050 Est. Local) — Depth 2, 40cp evaluation noise
  4. `ClubRookie` (~1220 Est. Local) — Depth 2 + quiescence capture search, 20cp noise
  5. `ClubPlayer` (~1400 Est. Local) — Depth 3 + quiescence, 10cp noise
  6. `ClubAdvanced` (~1560 Est. Local) — Depth 4 + transposition table & killers
  7. `Competitor` (~1720 Est. Local) — Depth 5 + PVS, SEE, LMR, zero weakening
  8. `Advanced` (~1860 Est. Local) — Depth 6, 95k node budget
  9. `Expert` (~2000 Est. Local) — Depth 7, Null-Move Pruning & Aspiration Windows
  10. `Master` (~2120 Est. Local) — Depth 8, 320k node budget
  11. `GrandmasterChallenge` (~2220 Est. Local) — Depth 9, 520k node budget
  12. `CathedralApex` (~2300 Est. Local) — Depth 10, 850k node budget (maximum available browser JS configuration)
  - Plus **Experimental** (plays using the 24-weight vector evolved in the Training Lab).
- **Local Player Rating**: Updates after completed unassisted games against calibrated engine tiers, explicitly labelled as an estimated local rating rather than an official FIDE or Chess.com rating.

### 4. 5-Tier Progressive Hints, 11-Layer X-Ray & Post-Game Review
- **5-Tier Progressive Hints**: Step progressively through Strategic Goal (Tier 1), Tactical Alert (Tier 2), Origin Square (Tier 3), Candidate Move (Tier 4), and Principal Continuation & Explanation (Tier 5).
- **11-Layer X-Ray System**: Separately toggleable overlays for Attacked Squares, Defended Pieces, Hanging Pieces (SEE), Pins & Discovered Batteries, Forks & Skewers, Overloaded Defenders, King Threats, Candidate Moves, PV Arrows, Predicted Opponent Replies, and Pre-Move Blunder Warnings—with explicit epistemic labels (*Current Fact*, *Candidate Line*, *Prediction*, *Uncertainty*).
- **Move-by-Move Replay & Review**: Navigate any historical ply (`⏮`, `◀`, `▶ Replay`, `▶`, `⏭`), inspect the SVG Evaluation Graph, and review Best, Excellent, Good, Inaccuracy, Mistake, Blunder, ACPL, and Accuracy %.

### 5. Headless Training Lab & Local Persistence
- **Seeded SPSA / Evolutionary Parameter Tuning (`src/learning/learningEngine.js`)**: Perturbs the 24-parameter evaluation vector using a seeded SplitMix32 PRNG, gates candidates against an 8-position mandatory tactical regression suite, and runs colour-balanced matches across 16 opening roots in parallel Web Workers.
- **IndexedDB + Serverless Sharing**: Saves games and training state locally in IndexedDB (`wizards_chess_production_db`) and `localStorage`, with PGN/FEN import/export and safe URL-fragment sharing (`#cathedral=…` and `#fen=…`).

---

## License & Attribution

- **Application, Cathedral Engine, 2D SVG Chess Piece Set (`src/components/PieceSvg.tsx`), X-Ray Engine, and Training Lab**: Original implementation, released under the **MIT License**.
- **Next.js & React**: MIT License.