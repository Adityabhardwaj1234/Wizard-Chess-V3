/**
 * Engine Provider & Worker Client
 *
 * Wraps `src/workers/engine.worker.js` behind a clean EngineClient interface so searches
 * run in a background Web Worker off the main UI thread. Includes stale-request rejection,
 * cancellation tokens, and a main-thread fallback if Worker creation is blocked.
 */

export type PlayerColor = 'w' | 'b';

export interface EngineMateDistance {
  movesForSideToMove: number;
  movesForWhite: number;
  plies: number;
}

export interface EngineCandidate {
  san: string;
  lan: string;
  from: string;
  to: string;
  promotion?: string;
  scoreWhiteCp: number;
  scoreSideToMoveCp: number;
  mateIn: EngineMateDistance | null;
  pv: string[];
}

export interface EngineProgress {
  engineMode: string;
  depth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
  bestMoveSan: string;
  bestMoveLan: string;
  scoreSideToMoveCp: number;
  scoreWhiteCp: number;
  mateIn: EngineMateDistance | null;
  pv: string[];
  candidates: EngineCandidate[];
}

export interface EngineResult {
  engineMode: string;
  presetId?: string;
  tier?: number;
  estimatedRating?: number;
  bestMove: { from: string; to: string; promotion?: string; san: string; lan: string } | null;
  bestMoveSan: string | null;
  bestMoveLan: string | null;
  scoreSideToMoveCp: number;
  scoreWhiteCp: number;
  mateIn: EngineMateDistance | null;
  depth: number;
  nodes: number;
  qNodes: number;
  nps: number;
  elapsedMs: number;
  pv: string[];
  pvLan: string[];
  candidates: EngineCandidate[];
  stopReason: string;
  bookMove?: boolean;
  explanation: unknown;
}

export interface EngineSearchOptions {
  difficulty?: string;
  maxDepth?: number;
  timeLimitMs?: number;
  nodeLimit?: number;
  multiPv?: number;
  useOpeningBook?: boolean;
  hashHistory?: string[];
  evalParams?: Record<string, number> | null;
}

export interface EngineHandlers {
  onProgress?: (progress: EngineProgress) => void;
  onResult?: (result: EngineResult) => void;
  onError?: (message: string) => void;
}

export interface EngineClient {
  readonly mode: 'worker' | 'main-thread';
  readonly providerName: string;
  search(fen: string, options: EngineSearchOptions, handlers: EngineHandlers): void;
  requestStop(): void;
  dispose(): void;
}

let requestCounter = 0;

function createWorkerClient(worker: Worker): EngineClient {
  let activeRequestId: number | null = null;
  let activeFen: string | null = null;
  let handlers: EngineHandlers | null = null;

  const clearPending = (): EngineHandlers | null => {
    const pending = handlers;
    handlers = null;
    activeRequestId = null;
    activeFen = null;
    return pending;
  };

  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data as
      | { type: string; requestId?: number; fen?: string; progress?: EngineProgress; result?: EngineResult; error?: string }
      | undefined;
    if (!msg || typeof msg.type !== 'string') return;
    if (activeRequestId === null || msg.requestId !== activeRequestId) return;
    if (msg.fen && activeFen && msg.fen !== activeFen) return;

    if (msg.type === 'PROGRESS') {
      handlers?.onProgress?.(msg.progress as EngineProgress);
    } else if (msg.type === 'RESULT') {
      clearPending()?.onResult?.(msg.result as EngineResult);
    } else if (msg.type === 'ERROR') {
      clearPending()?.onError?.(String(msg.error ?? 'Engine search failed'));
    }
  };

  worker.onerror = () => {
    clearPending()?.onError?.('Engine worker encountered an unexpected error');
  };

  return {
    mode: 'worker',
    providerName: 'Cathedral 12-Tier Worker Engine',
    search(fen, options, nextHandlers) {
      if (activeRequestId !== null) worker.postMessage({ type: 'STOP' });
      activeRequestId = ++requestCounter;
      activeFen = fen;
      handlers = nextHandlers;
      worker.postMessage({
        type: 'SEARCH',
        requestId: activeRequestId,
        fen,
        options: {
          difficulty: options.difficulty,
          maxDepth: options.maxDepth,
          timeLimitMs: options.timeLimitMs,
          nodeLimit: options.nodeLimit,
          multiPv: options.multiPv,
          useOpeningBook: options.useOpeningBook,
          evalParams: options.evalParams ?? null,
          hashHistory: options.hashHistory
        }
      });
    },
    requestStop() {
      if (activeRequestId !== null) {
        worker.postMessage({ type: 'STOP' });
        clearPending();
      }
    },
    dispose() {
      clearPending();
      worker.terminate();
    }
  };
}

interface EngineInstance {
  search(fen: string, options: Record<string, unknown>): EngineResult;
  requestStop(): void;
}

function createMainThreadClient(): EngineClient {
  let enginePromise: Promise<EngineInstance> | null = null;
  let activeRequestId = 0;

  const getEngine = async (): Promise<EngineInstance> => {
    if (!enginePromise) {
      enginePromise = import('../engine/CathedralEngine.js').then(mod => new mod.CathedralEngine() as unknown as EngineInstance);
    }
    return enginePromise;
  };

  return {
    mode: 'main-thread',
    providerName: 'Cathedral 12-Tier Engine (Main Thread Fallback)',
    search(fen, options, handlers) {
      const requestId = ++requestCounter;
      activeRequestId = requestId;
      void Promise.resolve().then(async () => {
        try {
          const engine = await getEngine();
          if (activeRequestId !== requestId) return;
          const result = engine.search(fen, {
            difficulty: options.difficulty,
            maxDepth: options.maxDepth,
            timeLimitMs: options.timeLimitMs,
            nodeLimit: options.nodeLimit,
            multiPv: options.multiPv,
            useOpeningBook: options.useOpeningBook,
            evalParams: options.evalParams ?? null,
            hashHistory: options.hashHistory,
            onProgress: (p: EngineProgress) => {
              if (activeRequestId === requestId) handlers.onProgress?.(p);
            }
          });
          if (activeRequestId === requestId) handlers.onResult?.(result);
        } catch (err) {
          if (activeRequestId === requestId) {
            handlers.onError?.(err instanceof Error ? err.message : 'Engine search failed');
          }
        }
      });
    },
    requestStop() {
      activeRequestId = ++requestCounter;
    },
    dispose() {
      activeRequestId = ++requestCounter;
      enginePromise = null;
    }
  };
}

export function createEngineClient(): EngineClient {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return createMainThreadClient();
  }
  try {
    const worker = new Worker(new URL('../workers/engine.worker.js', import.meta.url));
    return createWorkerClient(worker);
  } catch (_err) {
    return createMainThreadClient();
  }
}