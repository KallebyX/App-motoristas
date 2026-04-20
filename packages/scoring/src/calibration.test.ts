import { describe, expect, it } from 'vitest';
import type {
  BlockResult,
  SessionSubmission,
  Trial,
} from '@app-motoristas/shared-types';
import { calibrateCutoffs, computeBaseline, simulateSessions } from './calibration.js';

function trial(rtMs: number | null, isFalseStart = false): Trial {
  return {
    stimulusAtMs: 0,
    responseAtMs: rtMs,
    rtMs,
    isLapse: rtMs != null && rtMs > 500,
    isFalseStart,
  };
}

function block(rts: (number | null)[], kind: BlockResult['block'] = 'pvt_b'): BlockResult {
  return {
    block: kind,
    startedAt: '2026-04-20T00:00:00.000Z',
    endedAt: '2026-04-20T00:00:30.000Z',
    trials: rts.map((r) => trial(r)),
  };
}

function submission(
  opts: { id?: string; rts?: number[]; kss?: number; sp?: number } = {},
): SessionSubmission {
  const rts = opts.rts ?? [250, 260, 270, 280, 290, 300];
  return {
    sessionId: opts.id ?? '00000000-0000-0000-0000-000000000001',
    driverId: '00000000-0000-0000-0000-000000000002',
    startedAt: '2026-04-20T05:00:00.000Z',
    completedAt: '2026-04-20T05:01:15.000Z',
    deviceFingerprint: 'device-abc12345',
    appVersion: '0.1.0',
    geo: { lat: -23.55, lng: -46.63 },
    livenessVideoRef: null,
    livenessMatchScore: null,
    blocks: [block(rts)],
    subjective: { kss: opts.kss ?? 3, samnPerelli: opts.sp ?? 2 },
  };
}

describe('computeBaseline', () => {
  it('aggregates median/lapse/cv across a population', () => {
    const blocks: BlockResult[] = [
      block([250, 260, 270, 280, 290, 300]),
      block([270, 290, 310, 330, 350, 370]),
      block([220, 240, 260, 280, 300, 320]),
    ];
    const result = computeBaseline(blocks);
    expect(result.sampleSize).toBe(3);
    expect(result.medianRtMs.mean).toBeGreaterThan(260);
    expect(result.medianRtMs.mean).toBeLessThan(320);
    expect(result.medianRtMs.sd).toBeGreaterThan(0);
    expect(result.percentiles.medianRtMs.p50).toBeGreaterThanOrEqual(
      result.percentiles.medianRtMs.p25,
    );
    expect(result.percentiles.medianRtMs.p95).toBeGreaterThanOrEqual(
      result.percentiles.medianRtMs.p75,
    );
  });

  it('throws on empty input', () => {
    expect(() => computeBaseline([])).toThrow();
  });
});

describe('simulateSessions', () => {
  it('classifies fast sessions as green and slow as red', () => {
    const fast = submission({ id: '00000000-0000-0000-0000-00000000000a', rts: [240, 250, 260, 270] });
    const slow = submission({
      id: '00000000-0000-0000-0000-00000000000b',
      rts: [480, 500, 520, 540, 560, 600],
      kss: 7,
      sp: 5,
    });
    const out = simulateSessions([fast, slow]);
    expect(out[0]!.trafficLight).toBe('green');
    expect(out[1]!.trafficLight).toBe('red');
  });

  it('flags hard-red on high lapse rate regardless of cutoffs', () => {
    const many_lapses = submission({
      id: '00000000-0000-0000-0000-00000000000c',
      rts: [520, 560, 600, 250, 260, 270, 280, 290, 300, 600],
    });
    const out = simulateSessions([many_lapses], undefined, { greenMin: 1, yellowMin: 0 });
    expect(out[0]!.trafficLight).toBe('red');
    expect(out[0]!.hardRed).toBe(true);
  });
});

describe('calibrateCutoffs', () => {
  it('finds cutoffs that approximate the target red rate', () => {
    // Generate a mixed population: 60% fast, 30% medium, 10% slow.
    const pop: SessionSubmission[] = [];
    for (let i = 0; i < 60; i++) {
      pop.push(
        submission({
          id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          rts: [240 + i % 20, 250, 260, 270, 280, 290],
        }),
      );
    }
    for (let i = 60; i < 90; i++) {
      pop.push(
        submission({
          id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          rts: [320, 340, 360, 380, 390, 400],
        }),
      );
    }
    for (let i = 90; i < 100; i++) {
      pop.push(
        submission({
          id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          rts: [420, 440, 460, 480, 490, 500],
          kss: 6,
          sp: 4,
        }),
      );
    }
    const result = calibrateCutoffs(pop, { targetRedRate: 0.1 });
    expect(result.greenMin).toBeGreaterThanOrEqual(result.yellowMin);
    expect(result.measuredRedRate).toBeLessThanOrEqual(0.25);
    expect(result.measuredGreenRate + result.measuredYellowRate + result.measuredRedRate + result.hardRedRate).toBeCloseTo(1, 1);
  });
});
