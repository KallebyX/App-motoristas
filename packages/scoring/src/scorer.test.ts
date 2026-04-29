import { describe, expect, it } from 'vitest';
import type { BlockResult, SessionSubmission, Trial } from '@app-motoristas/shared-types';
import { scoreSession } from './scorer.js';

function makeTrial(rtMs: number | null, opts: Partial<Trial> = {}): Trial {
  return {
    stimulusAtMs: 0,
    responseAtMs: rtMs == null ? null : rtMs,
    rtMs,
    isLapse: rtMs != null && rtMs > 500,
    isFalseStart: false,
    ...opts,
  };
}

function makeBlock(rts: (number | null)[], block: BlockResult['block'] = 'pvt_b'): BlockResult {
  return {
    block,
    startedAt: '2026-04-19T12:00:00.000Z',
    endedAt: '2026-04-19T12:00:30.000Z',
    trials: rts.map((rt) => makeTrial(rt)),
  };
}

function makeSubmission(overrides: Partial<SessionSubmission> = {}): SessionSubmission {
  return {
    sessionId: '00000000-0000-0000-0000-000000000001',
    driverId: '00000000-0000-0000-0000-000000000002',
    startedAt: '2026-04-19T12:00:00.000Z',
    completedAt: '2026-04-19T12:01:15.000Z',
    deviceFingerprint: 'device-abc123',
    appVersion: '0.1.0',
    geo: { lat: -23.55, lng: -46.63 },
    livenessVideoRef: 'liveness-videos/session-1.mp4',
    livenessMatchScore: 97,
    blocks: [makeBlock([250, 260, 270, 280, 290, 300])],
    subjective: { kss: 3, samnPerelli: 2, hoursSlept: 8 },
    ...overrides,
  };
}

const permissivePolicy = { yellow: 'warn', red: 'warn' } as const;
const strictPolicy = { yellow: 'warn', red: 'block' } as const;

describe('scoreSession — happy path (green)', () => {
  it('gives green for fast, consistent RTs and alert subjective state', () => {
    const out = scoreSession({ submission: makeSubmission(), policy: strictPolicy });
    expect(out.trafficLight).toBe('green');
    expect(out.blocked).toBe(false);
    expect(out.hardRedReasons).toEqual([]);
    expect(out.finalScore).toBeGreaterThanOrEqual(75);
  });
});

describe('scoreSession — yellow (moderate)', () => {
  it('returns yellow when RTs are mediocre and subjective is borderline', () => {
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock([330, 340, 355, 360, 380, 370])],
        subjective: { kss: 6, samnPerelli: 4 },
      }),
      policy: strictPolicy,
    });
    expect(out.trafficLight).toBe('yellow');
    expect(out.blocked).toBe(false);
  });

  it('blocks yellow when policy sets yellow: block', () => {
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock([330, 340, 355, 360, 380, 370])],
        subjective: { kss: 6, samnPerelli: 4 },
      }),
      policy: { yellow: 'block', red: 'block' },
    });
    expect(out.trafficLight).toBe('yellow');
    expect(out.blocked).toBe(true);
  });
});

describe('scoreSession — red (low score, soft)', () => {
  it('returns red when combined score falls below yellow cutoff', () => {
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock([420, 450, 470, 490, 480, 460])],
        subjective: { kss: 7, samnPerelli: 5 },
      }),
      policy: strictPolicy,
    });
    expect(out.trafficLight).toBe('red');
    expect(out.blocked).toBe(true);
  });
});

describe('scoreSession — hard red by lapses', () => {
  it('forces red when lapse rate > 20 percent even if score would be yellow', () => {
    // 4/10 lapses = 40% — way above 20% threshold.
    const rts = [250, 260, 270, 280, 290, 300, 520, 540, 560, 600];
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock(rts)],
        subjective: { kss: 2, samnPerelli: 2 },
      }),
      policy: strictPolicy,
    });
    expect(out.trafficLight).toBe('red');
    expect(out.blocked).toBe(true);
    expect(out.hardRedReasons.some((r) => r.startsWith('lapse_rate_exceeded'))).toBe(true);
  });
});

describe('scoreSession — hard red by KSS', () => {
  it('forces red when KSS >= 8 regardless of fast RTs', () => {
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock([220, 230, 240, 250])],
        subjective: { kss: 9, samnPerelli: 3 },
      }),
      policy: strictPolicy,
    });
    expect(out.trafficLight).toBe('red');
    expect(out.hardRedReasons).toContain('kss_critical:9');
  });
});

describe('scoreSession — hard red by Samn-Perelli', () => {
  it('forces red when Samn-Perelli >= 6', () => {
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock([220, 230, 240, 250])],
        subjective: { kss: 4, samnPerelli: 7 },
      }),
      policy: strictPolicy,
    });
    expect(out.trafficLight).toBe('red');
    expect(out.hardRedReasons).toContain('samn_perelli_critical:7');
  });
});

describe('scoreSession — permissive policy never blocks', () => {
  it('does not set blocked=true when policy is warn-only', () => {
    const out = scoreSession({
      submission: makeSubmission({
        blocks: [makeBlock([420, 450, 470, 490, 480, 460])],
        subjective: { kss: 7, samnPerelli: 5 },
      }),
      policy: permissivePolicy,
    });
    expect(out.trafficLight).toBe('red');
    expect(out.blocked).toBe(false);
  });
});

describe('scoreSession — metrics sanity', () => {
  it('computes median, lapse rate and CV per block', () => {
    const out = scoreSession({
      submission: makeSubmission({ blocks: [makeBlock([200, 300, 400, 500, 600])] }),
      policy: strictPolicy,
    });
    const m = out.blockMetrics['pvt_b'];
    expect(m).toBeDefined();
    expect(m!.medianRtMs).toBe(400);
    expect(m!.lapseRate).toBeCloseTo(0.2, 5);
    expect(m!.cvRt).toBeGreaterThan(0);
  });

  it('counts false starts without crashing', () => {
    const block: BlockResult = {
      block: 'pvt_b',
      startedAt: '2026-04-19T12:00:00.000Z',
      endedAt: '2026-04-19T12:00:30.000Z',
      trials: [
        makeTrial(250),
        { stimulusAtMs: 0, responseAtMs: 50, rtMs: null, isLapse: false, isFalseStart: true },
        makeTrial(280),
      ],
    };
    const out = scoreSession({
      submission: makeSubmission({ blocks: [block] }),
      policy: strictPolicy,
    });
    expect(out.blockMetrics['pvt_b']!.falseStartRate).toBeCloseTo(1 / 3, 5);
  });
});

describe('scoreSession — block with zero valid trials', () => {
  it('penalizes (not rewards) a block where every trial is a false start', () => {
    const block: BlockResult = {
      block: 'pvt_b',
      startedAt: '2026-04-19T12:00:00.000Z',
      endedAt: '2026-04-19T12:00:30.000Z',
      trials: Array.from({ length: 5 }, () => ({
        stimulusAtMs: 0,
        responseAtMs: 50,
        rtMs: null,
        isLapse: false,
        isFalseStart: true,
      })),
    };
    const out = scoreSession({
      submission: makeSubmission({ blocks: [block] }),
      policy: strictPolicy,
    });
    expect(out.trafficLight).toBe('red');
    expect(out.blockMetrics['pvt_b']!.zScore).toBe(-4);
  });
});

describe('scoreSession — output contract', () => {
  it('always includes algorithm version and numeric scores', () => {
    const out = scoreSession({ submission: makeSubmission(), policy: strictPolicy });
    expect(out.algorithmVersion).toBe('v1');
    expect(Number.isFinite(out.objectiveScore)).toBe(true);
    expect(Number.isFinite(out.subjectiveScore)).toBe(true);
    expect(Number.isFinite(out.finalScore)).toBe(true);
    expect(out.finalScore).toBeGreaterThanOrEqual(0);
    expect(out.finalScore).toBeLessThanOrEqual(100);
  });
});
