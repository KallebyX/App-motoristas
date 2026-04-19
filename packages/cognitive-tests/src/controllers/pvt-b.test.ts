import { describe, expect, it, vi } from 'vitest';
import { createPvtController, type PvtEvent } from './pvt-b.js';

const baseConfig = {
  block: 'pvt_b' as const,
  totalDurationMs: 5_000,
  minIsiMs: 1_000,
  maxIsiMs: 2_000,
  stimulusTimeoutMs: 800,
  lapseThresholdMs: 500,
  falseStartWindowMs: 100,
  randomSeed: 42,
};

// Advance tick clock until first stimulus appears, then return timestamp.
function runUntilStimulus(
  c: ReturnType<typeof createPvtController>,
  events: PvtEvent[],
  maxMs = 4_000,
): number {
  for (let t = 0; t < maxMs; t += 16) {
    c.tick(t);
    const stim = events.find((e) => e.type === 'stimulus');
    if (stim) return (stim as Extract<PvtEvent, { type: 'stimulus' }>).shownAtMs;
  }
  throw new Error('no stimulus within maxMs');
}

describe('PVT controller', () => {
  it('emits stimulus, classifies a fast tap as a valid trial', () => {
    const c = createPvtController(baseConfig);
    const events: PvtEvent[] = [];
    c.subscribe((e) => events.push(e));

    c.start(0);
    const shownAt = runUntilStimulus(c, events);

    c.onTap(shownAt + 250);
    const response = events.find((e) => e.type === 'response');
    expect(response).toBeDefined();
    const trial = (response as Extract<PvtEvent, { type: 'response' }>).trial;
    expect(trial.rtMs).toBe(250);
    expect(trial.isLapse).toBe(false);
    expect(trial.isFalseStart).toBe(false);
  });

  it('flags slow response as a lapse', () => {
    const c = createPvtController(baseConfig);
    const events: PvtEvent[] = [];
    c.subscribe((e) => events.push(e));

    c.start(0);
    const shownAt = runUntilStimulus(c, events);

    c.onTap(shownAt + 600);
    const response = events.find((e) => e.type === 'response');
    expect(response).toBeDefined();
    const trial = (response as Extract<PvtEvent, { type: 'response' }>).trial;
    expect(trial.isLapse).toBe(true);
  });

  it('records a miss when stimulus timeout elapses without response', () => {
    const c = createPvtController(baseConfig);
    const events: PvtEvent[] = [];
    c.subscribe((e) => events.push(e));

    c.start(0);
    for (let t = 0; t < 4_500; t += 16) c.tick(t);
    expect(events.some((e) => e.type === 'miss')).toBe(true);
  });

  it('classifies tap before stimulus as false start', () => {
    const c = createPvtController(baseConfig);
    const events: PvtEvent[] = [];
    c.subscribe((e) => events.push(e));

    c.start(0);
    c.tick(100); // awaiting first stimulus
    c.onTap(500); // definitely before stimulus (min ISI = 1000)
    expect(events.some((e) => e.type === 'false_start')).toBe(true);
  });

  it('finishes at totalDurationMs and emits complete event', () => {
    const c = createPvtController(baseConfig);
    const complete = vi.fn();
    c.subscribe((e) => {
      if (e.type === 'complete') complete(e.result);
    });

    c.start(0);
    for (let t = 0; t < 6_000; t += 16) c.tick(t);
    expect(complete).toHaveBeenCalledOnce();
    const result = complete.mock.calls[0]![0];
    expect(result.block).toBe('pvt_b');
    expect(result.trials.length).toBeGreaterThan(0);
    expect(c.isRunning()).toBe(false);
  });

  it('is deterministic with a fixed seed', () => {
    const runA = runAndCollect();
    const runB = runAndCollect();
    expect(runA).toEqual(runB);
  });
});

function runAndCollect(): number[] {
  const c = createPvtController({ ...baseConfig, randomSeed: 123 });
  const stimuli: number[] = [];
  c.subscribe((e) => {
    if (e.type === 'stimulus') stimuli.push(e.shownAtMs);
  });
  c.start(0);
  for (let t = 0; t < 6_000; t += 16) c.tick(t);
  return stimuli;
}
