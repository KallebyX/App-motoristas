import type { BlockResult, TestBlock, Trial } from '@app-motoristas/shared-types';

// PVT-B controller: framework-agnostic state machine for a brief PVT.
// The UI layer (mobile or web) calls `tick(nowMs)` on every animation frame,
// `onTap(nowMs)` on every user response, and receives events via listener.
// Timing precision: callers should pass monotonic timestamps (performance.now()
// or reanimated worklet timestamps). We never read the clock internally.

export interface PvtConfig {
  block: TestBlock; // supports pvt_b, vigilance, etc.
  totalDurationMs: number; // e.g. 30_000
  minIsiMs: number; // inter-stimulus interval min (2_000)
  maxIsiMs: number; // inter-stimulus interval max (6_000)
  stimulusTimeoutMs: number; // classify as miss after this (e.g. 1_500)
  lapseThresholdMs: number; // RT > this = lapse (500)
  falseStartWindowMs: number; // tap before stimulus = false start (within 100ms after prev response)
  randomSeed?: number;
}

export type PvtEvent =
  | { type: 'awaiting'; nextStimulusAtMs: number }
  | { type: 'stimulus'; shownAtMs: number }
  | { type: 'response'; trial: Trial }
  | { type: 'miss'; trial: Trial }
  | { type: 'false_start'; trial: Trial }
  | { type: 'complete'; result: BlockResult };

export interface PvtController {
  start(nowMs: number): void;
  tick(nowMs: number): void;
  onTap(nowMs: number): void;
  subscribe(listener: (event: PvtEvent) => void): () => void;
  isRunning(): boolean;
  isStimulusVisible(): boolean;
  getPartialResult(): BlockResult;
}

export function createPvtController(config: PvtConfig): PvtController {
  const listeners = new Set<(e: PvtEvent) => void>();
  const random = mulberry32(config.randomSeed ?? Date.now() >>> 0);

  let running = false;
  let startedAtMs = 0;
  let startedAtIso = '';
  let nextStimulusAtMs = 0;
  let stimulusShownAtMs: number | null = null;
  let lastResponseAtMs = 0;
  const trials: Trial[] = [];

  function emit(event: PvtEvent): void {
    for (const l of listeners) l(event);
  }

  function scheduleNext(nowMs: number): void {
    const isi = config.minIsiMs + random() * (config.maxIsiMs - config.minIsiMs);
    nextStimulusAtMs = nowMs + isi;
    stimulusShownAtMs = null;
    emit({ type: 'awaiting', nextStimulusAtMs });
  }

  function finish(nowMs: number): void {
    running = false;
    const result: BlockResult = {
      block: config.block,
      startedAt: startedAtIso,
      endedAt: new Date(Date.now() - (nowMs - startedAtMs) + (nowMs - startedAtMs)).toISOString(),
      trials: [...trials],
    };
    emit({ type: 'complete', result });
  }

  return {
    start(nowMs) {
      running = true;
      startedAtMs = nowMs;
      startedAtIso = new Date().toISOString();
      trials.length = 0;
      lastResponseAtMs = nowMs;
      scheduleNext(nowMs);
    },

    tick(nowMs) {
      if (!running) return;
      if (nowMs - startedAtMs >= config.totalDurationMs) {
        if (stimulusShownAtMs != null) {
          const trial: Trial = {
            stimulusAtMs: stimulusShownAtMs,
            responseAtMs: null,
            rtMs: null,
            isLapse: true,
            isFalseStart: false,
          };
          trials.push(trial);
          emit({ type: 'miss', trial });
        }
        finish(nowMs);
        return;
      }
      if (stimulusShownAtMs == null && nowMs >= nextStimulusAtMs) {
        stimulusShownAtMs = nowMs;
        emit({ type: 'stimulus', shownAtMs: nowMs });
        return;
      }
      if (stimulusShownAtMs != null && nowMs - stimulusShownAtMs >= config.stimulusTimeoutMs) {
        const trial: Trial = {
          stimulusAtMs: stimulusShownAtMs,
          responseAtMs: null,
          rtMs: null,
          isLapse: true,
          isFalseStart: false,
        };
        trials.push(trial);
        emit({ type: 'miss', trial });
        lastResponseAtMs = nowMs;
        scheduleNext(nowMs);
      }
    },

    onTap(nowMs) {
      if (!running) return;
      if (stimulusShownAtMs == null) {
        // Tapped before stimulus — false start.
        if (nowMs - lastResponseAtMs < config.falseStartWindowMs) {
          // Ignore double-taps within debounce window.
          return;
        }
        const trial: Trial = {
          stimulusAtMs: nextStimulusAtMs,
          responseAtMs: nowMs,
          rtMs: null,
          isLapse: false,
          isFalseStart: true,
        };
        trials.push(trial);
        emit({ type: 'false_start', trial });
        lastResponseAtMs = nowMs;
        scheduleNext(nowMs);
        return;
      }
      const rt = nowMs - stimulusShownAtMs;
      const trial: Trial = {
        stimulusAtMs: stimulusShownAtMs,
        responseAtMs: nowMs,
        rtMs: rt,
        isLapse: rt > config.lapseThresholdMs,
        isFalseStart: false,
      };
      trials.push(trial);
      emit({ type: 'response', trial });
      lastResponseAtMs = nowMs;
      scheduleNext(nowMs);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    isRunning() {
      return running;
    },

    isStimulusVisible() {
      return stimulusShownAtMs != null;
    },

    getPartialResult() {
      return {
        block: config.block,
        startedAt: startedAtIso,
        endedAt: new Date().toISOString(),
        trials: [...trials],
      };
    },
  };
}

// Tiny deterministic PRNG so tests are reproducible.
// Source: https://stackoverflow.com/a/47593316 (public domain).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
