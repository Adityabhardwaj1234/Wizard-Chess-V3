/**
 * Shareable Game URL & PGN/FEN Payload Encoding
 * Encodes and decodes validated game and position payloads in the URL fragment
 * (#cathedral=... or #fen=...) without requiring a remote backend or user account.
 * Never truncates moves silently; enforces safe URL size limits with PGN fallback.
 */

import { ChessGame, validateFen, DEFAULT_FEN } from '../game/ChessGame.js';

export const MAX_PAYLOAD_CHARS = 4096;
export const SAFE_URL_CHAR_LIMIT = 2000;

function sanitizeText(str, maxLen = 240) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

/**
 * Encodes a game into a URL hash string (`https://...#cathedral=...`).
 * Also attaches metadata via `encodeGameLinkDetailed` for callers that want size-limit warnings.
 */
export function encodeGameToUrlHash({ pgn, startFen, title, notes }) {
  const payload = {
    v: 1,
    p: pgn || '',
    f: startFen && startFen !== DEFAULT_FEN ? startFen : undefined,
    t: title ? sanitizeText(title, 80) : undefined,
    n: notes ? sanitizeText(notes, 240) : undefined
  };
  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.href.split('#')[0]
      : 'https://wizards-chess.local/';
  return `${baseUrl}#cathedral=${encoded}`;
}

/**
 * Encodes a game and verifies whether the resulting link fits within safe browser URL limits.
 * Never truncates moves.
 */
export function buildSafeSharePayload({ pgn, startFen, fen, title, notes }) {
  const url = encodeGameToUrlHash({ pgn, startFen, title, notes });
  const fitsInUrl = url.length <= SAFE_URL_CHAR_LIMIT;
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.href.split('#')[0]
      : 'https://wizards-chess.local/';
  const positionUrl = `${baseUrl}#fen=${encodeURIComponent(fen || DEFAULT_FEN)}`;

  return {
    url: fitsInUrl ? url : null,
    fullUrl: url,
    positionUrl,
    fitsInUrl,
    charLength: url.length,
    limit: SAFE_URL_CHAR_LIMIT,
    fallbackReason: fitsInUrl
      ? null
      : `This game's encoded URL is ${url.length} characters (safe limit: ${SAFE_URL_CHAR_LIMIT}). Copy the PGN text or download the .pgn file so no moves are truncated.`
  };
}

export function decodeGameFromUrlHash(hashString) {
  if (!hashString || typeof hashString !== 'string') return null;
  if (hashString.length > MAX_PAYLOAD_CHARS + 128) return null;
  const cleaned = hashString.replace(/^#/, '');
  const params = new URLSearchParams(cleaned);

  // Check standalone position link (`#fen=...`)
  const fenParam = params.get('fen');
  if (fenParam && !params.get('cathedral')) {
    const decodedFen = decodeURIComponent(fenParam).trim();
    const vf = validateFen(decodedFen);
    if (!vf.valid) return null;
    const posGame = new ChessGame(decodedFen);
    return {
      pgn: posGame.pgn(),
      fen: posGame.fen(),
      startFen: decodedFen,
      moves: [],
      title: 'Shared Position',
      notes: ''
    };
  }

  const token = params.get('cathedral');
  if (!token || token.length > MAX_PAYLOAD_CHARS) return null;

  try {
    const json = decodeURIComponent(escape(atob(token)));
    if (json.length > MAX_PAYLOAD_CHARS * 2) return null;
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;

    if (data.f) {
      const vf = validateFen(data.f);
      if (!vf.valid) return null;
    }

    const testGame = new ChessGame(data.f || DEFAULT_FEN);
    if (data.p && typeof data.p === 'string' && data.p.trim().length > 0) {
      const ok = testGame.load_pgn(data.p);
      if (!ok) return null;
    }

    return {
      pgn: testGame.pgn(),
      fen: testGame.fen(),
      startFen: data.f || DEFAULT_FEN,
      moves: testGame.history({ verbose: true }),
      title: sanitizeText(data.t || 'Shared Cathedral Match', 80),
      notes: sanitizeText(data.n || '', 240)
    };
  } catch (_e) {
    return null;
  }
}
